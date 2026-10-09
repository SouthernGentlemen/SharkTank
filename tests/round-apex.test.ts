import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOT_AI_BUDGET,
  COMBAT,
  FRENZY_RULES,
  PREY_BUDGET,
  PREY_SPECS,
  ROOM_SCHEMA_VERSION,
  ROUND_RULES,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  isFrenzy,
  spawnBots,
  step,
  type Prey,
  type Shark,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  parseRealtimeClientMessage,
  parseRealtimeServerMessage,
  toNetState,
  withRealtimeProtocol,
} from "../src/protocol/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
  shark.yaw = shark.targetYaw = 0;
  shark.pitch = shark.targetPitch = 0;
}

function farPrey(count: number): Prey[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `round-far-${i}`,
    kind: "carcass",
    x: 54 + (i % 7),
    y: -9 + (i % 19),
    z: -22 + (i % 41),
    value: PREY_SPECS.carcass.value,
    r: PREY_SPECS.carcass.r,
    yaw: 0,
    pitch: 0,
    school: -1,
  }));
}

describe("ST-124 authoritative round and Apex loop", () => {
  it("advances active -> Apex -> result -> next round with deterministic reset truth", () => {
    const state = createRoom({ id: "round-loop", seed: "st-124-loop" });
    const alpha = join(state, "alpha");
    const beta = join(state, "beta");
    alpha.score = 50;
    alpha.length = 22;
    beta.score = 9;
    place(alpha, -20, -4, 0);
    place(beta, 20, 4, 0);

    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    expect(ROUND_RULES).toMatchObject({
      activeTicks: TICKS_PER_SECOND * 5 * 60,
      apexTicks: TICKS_PER_SECOND * 45,
      resultTicks: TICKS_PER_SECOND * 10,
    });
    expect(state.round).toMatchObject({ number: 1, phase: "active", startTick: 0 });

    state.tick = state.round.apexStartTick - 1;
    step(state);
    expect(state.round.phase).toBe("apex");
    expect(state.round.apexId).toBe("alpha");

    const apexWire = toNetState(state);
    expect(apexWire.round).toEqual(state.round);
    expect(parseRealtimeServerMessage(withRealtimeProtocol({ t: "state" as const, state: apexWire })).ok).toBe(true);
    expect(toNetState(state).round).toEqual(state.round);

    const lateApex = join(state, "late-apex");
    expect(lateApex.alive).toBe(true);
    expect(toNetState(state).round.phase).toBe("apex");

    state.tick = state.round.endTick - FRENZY_RULES.durationTicks - 1;
    step(state);
    expect(isFrenzy(state)).toBe(true);
    expect(state.frenzyUntilTick).toBe(state.round.endTick);
    expect(state.food.filter((prey) => prey.kind === "chum")).toHaveLength(FRENZY_RULES.chumCount);

    state.tick = state.round.endTick - 1;
    step(state);
    expect(state.round.phase).toBe("result");
    expect(state.round.result?.winner?.id).toBe("alpha");
    expect(state.frenzyUntilTick).toBe(0);
    expect(state.food.some((prey) => prey.kind === "chum")).toBe(false);

    expect(toNetState(state).round.phase).toBe("result");
    expect(toNetState(state).round.result?.winner?.id).toBe("alpha");

    const frozen = JSON.stringify({
      sharks: state.sharks,
      food: state.food,
      explosions: state.explosions,
      frenzyUntilTick: state.frenzyUntilTick,
      result: state.round.result,
    });
    applyAction(state, { type: "setOrientation", playerId: "alpha", yaw: 2, pitch: 0.4 });
    applyAction(state, { type: "setBoost", playerId: "alpha", on: true });
    applyAction(state, { type: "bite", playerId: "alpha" });
    step(state);
    expect(JSON.stringify({
      sharks: state.sharks,
      food: state.food,
      explosions: state.explosions,
      frenzyUntilTick: state.frenzyUntilTick,
      result: state.round.result,
    })).toBe(frozen);

    const lateResult = join(state, "late-result");
    expect(lateResult.alive).toBe(false);
    expect(lateResult.respawnTick).toBe(state.round.resultEndTick);

    state.tick = state.round.resultEndTick - 1;
    step(state);
    expect(state.round).toMatchObject({ number: 2, phase: "active", startTick: state.tick });
    expect(state.round.result).toBeNull();
    expect(state.frenzyUntilTick).toBe(0);
    expect(Object.values(state.sharks).every((shark) => shark.alive && shark.score === 0 && shark.health === COMBAT.maxHealth)).toBe(true);
    expect(state.food).toHaveLength(PREY_BUDGET.ambient);
  });


  it("uses stable score/id ranking, bounded Apex advantage and an authoritative elimination bounty", () => {
    const state = createRoom({ seed: "st-124-apex" });
    state.food = [];
    const apex = join(state, "alpha");
    const hunter = join(state, "hunter");
    apex.score = 100;
    hunter.score = 20;
    place(apex, 0, -5, 0);
    place(hunter, 0, 5, 0);
    state.round.phase = "apex";
    state.round.apexId = apex.id;
    state.tick = 100;

    const beforeApex = { ...apex.position };
    const beforeHunter = { ...hunter.position };
    step(state);
    const apexTravel = Math.hypot(
      apex.position.x - beforeApex.x,
      apex.position.y - beforeApex.y,
      apex.position.z - beforeApex.z,
    );
    const hunterTravel = Math.hypot(
      hunter.position.x - beforeHunter.x,
      hunter.position.y - beforeHunter.y,
      hunter.position.z - beforeHunter.z,
    );
    expect(apexTravel).toBeGreaterThan(hunterTravel);

    place(hunter, 0, 0, 0);
    place(apex, 2, 0, 0);
    apex.health = 1;
    apex.invulnTick = 0;
    hunter.invulnTick = 0;
    hunter.biteCooldownTick = 0;
    state.round.apexId = apex.id;
    const scoreBefore = hunter.score;
    const lengthBefore = hunter.length;
    const scoreReward = Math.min(60, Math.max(5, Math.round(apex.score * 0.25)));
    const growthReward = Math.min(8, Math.max(0.5, apex.length * 0.25));
    applyAction(state, { type: "bite", playerId: hunter.id });
    expect(apex.alive).toBe(false);
    expect(hunter.score - scoreBefore).toBe(ROUND_RULES.apexKillBonusScore + scoreReward);
    expect(hunter.length - lengthBefore).toBeCloseTo(ROUND_RULES.apexKillBonusGrowth + growthReward);

    const tie = createRoom({ seed: "st-124-tie" });
    const zulu = join(tie, "zulu");
    const alphaTie = join(tie, "alpha");
    zulu.score = alphaTie.score = 77;
    tie.tick = tie.round.endTick - 1;
    step(tie);
    expect(tie.round.result?.winner?.id).toBe("alpha");
  });

  it("makes bots pursue only a devourable marked Apex and rejects client-authored round authority", () => {
    const state = createRoom({ seed: "st-124-bot" });
    state.food = [];
    const target = join(state, "apex-target");
    const bot = join(state, "bot-test", true);
    bot.length = target.length * COMBAT.devourLengthRatio;
    target.score = 90;
    place(target, 0, 0, 8);
    place(bot, 0, 0, 0);
    target.invulnTick = 0;
    state.round.phase = "apex";
    state.round.apexId = target.id;
    state.tick = 100;
    step(state);
    expect(bot.targetYaw).toBeGreaterThan(0.5);
    expect(bot.targetYaw).toBeLessThan(1.7);

    for (const action of [
      { type: "setRound", number: 99 },
      { type: "setApex", playerId: "bot-test" },
      { type: "claimRoundReward", score: 999999 },
    ]) {
      expect(parseRealtimeClientMessage({
        v: REALTIME_PROTOCOL_VERSION,
        t: "input",
        action,
      })).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("keeps round/Apex wire growth and authoritative tick work bounded", () => {
    const state = createRoom({ id: "round-budget", seed: "st-124-budget" });
    state.food = farPrey(PREY_BUDGET.max);
    spawnBots(state, BOT_AI_BUDGET.targetPopulation);
    state.round.phase = "apex";
    state.round.apexId = "bot-0";
    state.tick = 200;

    const roundBytes = new TextEncoder().encode(JSON.stringify(toNetState(state).round)).byteLength;
    expect(roundBytes).toBeLessThanOrEqual(320);

    for (let i = 0; i < 8; i += 1) step(state);
    const ticks = 60;
    const started = performance.now();
    for (let i = 0; i < ticks; i += 1) step(state);
    const averageTickMs = (performance.now() - started) / ticks;
    expect(averageTickMs).toBeLessThan(1000 / TICKS_PER_SECOND);
  });

  it("keeps Apex/result state visible without motion, audio, or expensive presentation", () => {
    const actor = read("../src/game/game/ActorLayer.tsx");
    const board = read("../src/game/ui/Leaderboard.tsx");
    const screen = read("../src/game/ui/GameScreen.tsx");
    const theme = read("../src/game/ui/theme.css");
    const roomDo = read("../src/worker/room-do.ts");
    const worker = read("../src/worker/index.ts");
    const app = read("../src/game/App.tsx");
    const settings = read("../src/game/settings/SettingsContext.tsx");

    expect((actor.match(/octahedronGeometry/g) ?? [])).toHaveLength(1);
    expect(actor).toContain("reducedMotion ? 0");
    expect(board).toContain("game-leaderboard__apex");
    expect(screen).toContain("Ready for next round");
    expect(screen).toContain("roundUi?.phase !== \"result\"");
    const hud = read("../src/game/ui/Hud.tsx");
    expect(hud).toContain('stats.roundPhase === "apex" &&');
    expect(hud).toContain('APEX {formatRoundClock(stats.roundSeconds)}');
    expect(theme).toContain(".hud-status-chip--apex");
    expect(roomDo).not.toContain("profile-result");
    expect(worker).not.toContain('export { Lobby }');
    expect(worker).not.toContain("x-profile-id");
    expect(app).toContain("onAuthoritativeResult={recordBest}");
    expect(settings).toContain('const STORAGE_KEY = "sharktank.player.v1"');
  });
});
