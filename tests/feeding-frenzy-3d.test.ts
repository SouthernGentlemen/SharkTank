import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOT_AI_BUDGET,
  FRENZY_RULES,
  PREY_BUDGET,
  PREY_SPECS,
  ROOM_SCHEMA_VERSION,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  frenzyTiming,
  frenzyVolumeFor,
  isFrenzy,
  spawnBots,
  step,
  type Prey,
  type Shark,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  parseRealtimeClientMessage,
  toNetState,
} from "../src/protocol/index.js";
import { resolveOceanEnvironmentQuality } from "../src/game/game/oceanArena.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function insideOcean(
  point: { x: number; y: number; z: number },
  ocean: { radius: number; seabedY: number; surfaceY: number },
  margin = 0,
): boolean {
  const radius = Math.max(0, ocean.radius - margin);
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && point.x * point.x + point.z * point.z <= radius * radius
    && point.y >= ocean.seabedY + margin
    && point.y <= ocean.surfaceY - margin;
}

function insideFrenzy(
  point: { x: number; y: number; z: number },
  ocean: { radius: number; seabedY: number; surfaceY: number },
  margin = 0,
): boolean {
  const volume = frenzyVolumeFor(ocean);
  const radius = Math.max(0, volume.radius + margin);
  return point.x * point.x + point.z * point.z <= radius * radius
    && Math.abs(point.y - volume.center.y) <= volume.halfHeight + margin;
}

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
}

function farPrey(count: number): Prey[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `far-${i}`,
    kind: "carcass",
    x: 62 + (i % 5),
    y: -8 + (i % 17),
    z: -16 + (i % 33),
    value: PREY_SPECS.carcass.value,
    r: PREY_SPECS.carcass.r,
    yaw: 0,
    pitch: 0,
    school: -1,
  }));
}

function triggerFrenzy(state: ReturnType<typeof createRoom>): Prey[] {
  state.tick = FRENZY_RULES.periodTicks - 1;
  step(state);
  return state.food.filter((actor) => actor.kind === "chum");
}

describe("ST-123 3D server-wide Feeding Frenzy", () => {
  it("schedules start/end deterministically and exposes enough server truth for late joins", () => {
    const first = createRoom({ id: "frenzy", seed: "st-123-timing" });
    const second = createRoom({ id: "frenzy", seed: "st-123-timing" });

    triggerFrenzy(first);
    triggerFrenzy(second);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(FRENZY_RULES.periodTicks).toBe(TICKS_PER_SECOND * 75);
    expect(FRENZY_RULES.durationTicks).toBe(TICKS_PER_SECOND * 20);
    expect(frenzyTiming(first)).toEqual({
      active: true,
      startTick: FRENZY_RULES.periodTicks,
      endTick: FRENZY_RULES.periodTicks + FRENZY_RULES.durationTicks,
      remainingTicks: FRENZY_RULES.durationTicks,
    });

    const lateJoin = toNetState(first);
    expect(frenzyTiming(lateJoin)).toEqual(frenzyTiming(first));
    expect(lateJoin.frenzyUntilTick).toBe(first.frenzyUntilTick);

  });

  it("places authoritative chum through a bounded 3D central volume rather than one plane", () => {
    const state = createRoom({ seed: "st-123-volume", oceanRadius: 82, seabedY: -18, surfaceY: 14 });
    const chum = triggerFrenzy(state);
    const volume = frenzyVolumeFor(state.ocean);

    expect(chum).toHaveLength(FRENZY_RULES.chumCount);
    expect(volume.radius).toBeCloseTo(state.ocean.radius * FRENZY_RULES.volumeRadiusShare);
    expect(volume.halfHeight).toBeGreaterThan(5);
    expect(chum.every((actor) => insideOcean(actor, state.ocean))).toBe(true);
    expect(chum.every((actor) => insideFrenzy(actor, state.ocean, 0.2))).toBe(true);
    expect(new Set(chum.map((actor) => Math.round(actor.y))).size).toBeGreaterThan(8);
    expect(Math.min(...chum.map((actor) => actor.y))).toBeLessThan(volume.center.y - volume.halfHeight * 0.55);
    expect(Math.max(...chum.map((actor) => actor.y))).toBeGreaterThan(volume.center.y + volume.halfHeight * 0.55);
  });

  it("owns bounded gameplay modifiers and event cleanup on the server", () => {
    expect(FRENZY_RULES).toMatchObject({
      speedMultiplier: 1.16,
      dashCooldownMultiplier: 0.5,
      baseChumValue: 3,
      bonusChumValue: 5,
      bonusChumEvery: 3,
    });

    const active = createRoom({ seed: "st-123-active" });
    active.tick = 100;
    active.frenzyUntilTick = 300;
    const activeShark = join(active, "active");
    applyAction(active, { type: "setBoost", playerId: activeShark.id, on: true });

    const normal = createRoom({ seed: "st-123-normal" });
    normal.tick = 100;
    const normalShark = join(normal, "normal");
    applyAction(normal, { type: "setBoost", playerId: normalShark.id, on: true });
    expect(activeShark.dashCooldownTick - active.tick).toBe(
      (normalShark.dashCooldownTick - normal.tick) * FRENZY_RULES.dashCooldownMultiplier,
    );

    const state = createRoom({ seed: "st-123-cleanup" });
    const chum = triggerFrenzy(state);
    expect(chum.filter((actor) => actor.value === FRENZY_RULES.bonusChumValue)).toHaveLength(Math.ceil(FRENZY_RULES.chumCount / 3));
    for (let i = 0; i < FRENZY_RULES.durationTicks; i += 1) step(state);
    expect(isFrenzy(state)).toBe(false);
    expect(state.frenzyUntilTick).toBe(0);
    expect(state.food.some((actor) => actor.kind === "chum")).toBe(false);
    expect(state.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
  });

  it("rejects client-authored frenzy timing while preserving schema/protocol 12", () => {
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setFrenzy", untilTick: 999999 },
    })).toEqual({ ok: false, reason: "malformed" });

    const net = toNetState(createRoom({ seed: "st-123-wire" }));
    expect(Object.keys(net).sort()).toEqual([
      "arenaRadius",
      "explosions",
      "food",
      "frenzyUntilTick",
      "round",
      "seabedY",
      "sharks",
      "surfaceY",
      "tick",
    ]);
  });

  it("drives bots into the frenzy through depth with ordinary 3D steering", () => {
    for (const startY of [-17, 17]) {
      const state = createRoom({ seed: `st-123-bot-${startY}`, oceanRadius: 100, seabedY: -20, surfaceY: 20 });
      state.tick = 100;
      state.frenzyUntilTick = 500;
      state.food = [{
        id: "frenzy-chum",
        kind: "chum",
        x: 8,
        y: -startY * 0.45,
        z: 0,
        value: FRENZY_RULES.bonusChumValue,
        r: PREY_SPECS.chum.r,
        yaw: 0,
        pitch: 0,
        school: 0,
      }, ...farPrey(PREY_BUDGET.ambient - 1)];

      const bot = join(state, "frenzy-bot", true);
      place(bot, 44, startY, 0);
      bot.yaw = bot.targetYaw = Math.PI;
      bot.pitch = bot.targetPitch = 0;
      step(state);
      expect(Math.sign(bot.targetPitch)).toBe(startY < 0 ? 1 : -1);

      for (let i = 0; i < 85; i += 1) step(state);
      expect(insideFrenzy(bot.position, state.ocean, 2)).toBe(true);
    }

    const engine = read("../src/engine/room.ts");
    expect(engine).toContain("yawPitchToward(head, targetPoint)");
    expect(engine).toContain('applyAction(state, { type: "setBoost", playerId: s.id, on: true })');
    expect(engine).not.toContain("teleportBot");
  });

  it("keeps the active event inside the 20 Hz authoritative simulation budget", () => {
    const state = createRoom({ id: "frenzy-budget", seed: "st-123-budget" });
    state.tick = 100;
    state.frenzyUntilTick = 100 + FRENZY_RULES.durationTicks;
    state.food = farPrey(PREY_BUDGET.max);
    spawnBots(state, BOT_AI_BUDGET.targetPopulation);

    for (let i = 0; i < 8; i += 1) step(state);
    const ticks = 60;
    const started = performance.now();
    for (let i = 0; i < ticks; i += 1) step(state);
    const averageTickMs = (performance.now() - started) / ticks;
    const budgetMs = 1000 / TICKS_PER_SECOND;
    console.info(`ST-123 frenzy 24-bot / max-prey average tick: ${averageTickMs.toFixed(3)}ms; budget: ${budgetMs.toFixed(1)}ms`);
    expect(averageTickMs).toBeLessThan(budgetMs);
  });

  it("keeps start/end presentation legible without sound, motion, or high-cost graphics", () => {
    const low = resolveOceanEnvironmentQuality("low");
    const high = resolveOceanEnvironmentQuality("high");
    expect(low.frenzyRingCount).toBeLessThan(high.frenzyRingCount);
    expect(low.frenzyRingCount).toBeGreaterThan(0);

    const world = read("../src/game/game/WorldEnvironment.tsx");
    const screen = read("../src/game/ui/GameScreen.tsx");
    const audio = read("../src/game/audio/useGameAudio.ts");
    const hud = read("../src/game/ui/Hud.tsx");
    const audioManager = read("../src/game/audio/AudioManager.ts");
    const theme = read("../src/game/ui/theme.css");

    expect(world).toContain("frenzyVolumeFor");
    expect(world).toContain("frenzyOn && !reducedMotion");
    expect(world).toContain("environmentQuality.frenzyRingCount");
    expect(hud).toContain("Central water column");
    expect(hud).toContain("Feeding frenzy ended.");
    expect(screen).toContain('settings.a11y.motion === "reduced"');
    expect(audio).toContain('cue.current("frenzyStart")');
    expect(audio).toContain('"frenzyEnd"');
    expect(audioManager).toContain('frenzyStart: "Feeding Frenzy started"');
    expect(hud).toContain("FRENZY {stats.frenzySeconds}s");
    expect(hud).toContain("FRENZY ENDED");
    expect(theme).toMatch(/\.game-hud \{[^}]*pointer-events:none/);
    expect(theme).not.toContain("frenzy-pulse");
  });
});
