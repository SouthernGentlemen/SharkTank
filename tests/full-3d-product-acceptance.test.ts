import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOT_AI_BUDGET,
  COMBAT,
  FRENZY_RULES,
  PREY_BUDGET,
  ROOM_SCHEMA_VERSION,
  applyAction,
  createRoom,
  isFrenzy,
  spawnBots,
  step,
  type RoomState,
  type Snake,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  toNetState,
} from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  DEFAULT_KEYBINDS,
} from "../vendor/ModuleReact3Fiber/src/client/settings/SettingsContext.js";
import {
  cameraLookFromPointer,
  desktopAxesForPressed,
} from "../vendor/ModuleReact3Fiber/src/client/game/desktopControls.js";
import {
  beginStickPointer,
  canUseAbilityPointer,
  makeTwinStickState,
  moveStickPointer,
  touchAxesForState,
  touchLayoutForFlightSide,
} from "../vendor/ModuleReact3Fiber/src/client/game/mobileControls.js";
import {
  resolveClientPerformanceProfile,
  resolveRenderDpr,
} from "../vendor/ModuleReact3Fiber/src/client/game/performance.js";
import {
  resolveOceanEnvironmentQuality,
} from "../vendor/ModuleReact3Fiber/src/client/game/oceanArena.js";
import {
  resolveSceneQuality,
} from "../vendor/ModuleReact3Fiber/src/client/game/sceneMath.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: RoomState, id: string): Snake {
  applyAction(state, { type: "join", playerId: id, name: id });
  return state.snakes[id];
}

function place(shark: Snake, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
  const point = { x, y, z };
  shark.path = [{ ...point }];
  shark.segments = [{ ...point }];
  shark.yaw = shark.targetYaw = yaw;
  shark.pitch = shark.targetPitch = pitch;
}

describe("ST-131 full-3D product acceptance", () => {
  it("covers menu straight to game plus death, respawn, result and next-round authority", () => {
    const app = read("../vendor/ModuleReact3Fiber/src/client/App.tsx");
    const screen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
    const death = read("../vendor/ModuleReact3Fiber/src/client/ui/DeathOverlay.tsx");

    expect(app).toContain('type Screen = "menu" | "customize" | "settings" | "game"');
    expect(app).toContain('const SHARKTANK_ROOM = { id: "room-1", name: "SharkTank" } as const;');
    expect(app).toContain("onPlay={play}");
    expect(app).not.toContain("<Lobby");
    expect(app).not.toContain("API.tank");
    expect(app).toContain('setScreen("game")');
    expect(app).toContain("<GameScreen");
    expect(app).toContain('onQuit={() => setScreen("menu")}');
    expect(screen).toContain("Tank full — you'll join when a spot opens");
    expect(screen).toContain("Can't reach the tank");
    expect(screen).toContain("<DeathOverlay");
    expect(screen).toContain('roundUi?.phase === "result"');
    expect(screen).toContain("Ready for next round");
    expect(death).toContain("Respawn");

    const state = createRoom({ id: "st-131-lifecycle", seed: "st-131-lifecycle" });
    const pilot = join(state, "pilot");
    pilot.invulnTick = 0;
    place(pilot, state.ocean.radius - 0.1, 0, 0);
    step(state);
    expect(pilot.alive).toBe(false);
    expect(pilot.lastDeath?.action).toBe("boundary");

    while (state.tick < pilot.respawnTick) step(state);
    applyAction(state, { type: "respawn", playerId: pilot.id });
    expect(state.snakes[pilot.id].alive).toBe(true);
    expect(state.snakes[pilot.id].health).toBe(COMBAT.maxHealth);

    state.tick = state.round.apexStartTick - 1;
    step(state);
    expect(state.round.phase).toBe("apex");
    state.tick = state.round.endTick - 1;
    step(state);
    expect(state.round.phase).toBe("result");
    state.tick = state.round.resultEndTick - 1;
    step(state);
    expect(state.round).toMatchObject({ number: 2, phase: "active" });
  });

  it("serves only room-1 as SharkTank with eight human seats and twenty-four bots", () => {
    const worker = read("../src/worker/index.ts");
    const lobby = read("../src/worker/lobby-do.ts");
    const room = read("../src/worker/room-do.ts");
    const presentation = read("../src/worker/presentation.ts");
    const gameDocument = read("../src/client/game-document.tsx");

    expect(worker).toContain('const ROOM_ID = "room-1", ROOM_NAME = "SharkTank";');
    expect(worker).toContain("const ALLOWED_ROOMS = new Set([ROOM_ID]);");
    expect(lobby).toContain('const CATALOG = [{ id: "room-1", name: "SharkTank" }] as const;');
    for (const retiredRoom of ["room-2", "room-3", "room-4"]) {
      expect(lobby).not.toContain(`id: "${retiredRoom}"`);
      expect(presentation).not.toContain(`"${retiredRoom}"`);
    }
    expect(room).toContain('const ROOM_NAME = "SharkTank";');
    expect(room).toContain("CAPACITY = 8, BOT_COUNT = SHARK_CAPACITY - CAPACITY");
    expect(room).not.toContain('return new Response("room full", { status: 503');
    expect(room).toContain('if (this.full()) return this.close(ws, 1013, "room full");');
    expect(presentation).toContain('const AUDIT_ROOMS = ["room-1"];');
    expect(presentation).toContain('{ "room-1": "SharkTank" }');
    expect(gameDocument).toContain("Swim a shark in SharkTank");
  });

  it("accepts desktop keyboard, optional mouse look and independent mobile dual-stick intent", () => {
    const desktop = desktopAxesForPressed(
      new Set([
        DEFAULT_KEYBINDS.pitchUp,
        DEFAULT_KEYBINDS.yawRight,
        DEFAULT_KEYBINDS.lookLeft,
        DEFAULT_KEYBINDS.lookUp,
      ]),
      DEFAULT_KEYBINDS,
    );
    expect(desktop).toEqual({ yaw: 1, pitch: 1, lookYaw: -1, lookPitch: -1 });

    const pointer = cameraLookFromPointer(180, -90, 1280, 720);
    expect(pointer).not.toBeNull();
    expect(Math.abs(pointer?.yaw ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(pointer?.pitch ?? 0)).toBeGreaterThan(0);

    const touch = makeTwinStickState();
    expect(beginStickPointer(touch, "flight", 11)).toBe(true);
    expect(beginStickPointer(touch, "look", 22)).toBe(true);
    expect(moveStickPointer(touch, "flight", 11, 42, -35)).not.toBeNull();
    expect(moveStickPointer(touch, "look", 22, -33, 28)).not.toBeNull();
    const axes = touchAxesForState(touch);
    expect(axes.yaw).toBeGreaterThan(0);
    expect(axes.pitch).toBeGreaterThan(0);
    expect(axes.lookYaw).toBeLessThan(0);
    expect(axes.lookPitch).toBeGreaterThan(0);
    expect(canUseAbilityPointer(touch, 33)).toBe(true);
    expect(canUseAbilityPointer(touch, 11)).toBe(false);
    expect(touchLayoutForFlightSide("left")).toEqual({ flight: "left", look: "right", actions: "right" });
    expect(touchLayoutForFlightSide("right")).toEqual({ flight: "right", look: "left", actions: "left" });
  });

  it("keeps low, medium and high graphics plus accessibility modes presentation-only", () => {
    const settings = read("../vendor/ModuleReact3Fiber/src/client/ui/Settings.tsx");
    const gameScreen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
    const viewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");
    const theme = read("../vendor/ModuleReact3Fiber/src/client/ui/theme.css");

    const qualities = ["low", "medium", "high"] as const;
    const profiles = qualities.map((quality) => ({
      scene: resolveSceneQuality(quality),
      environment: resolveOceanEnvironmentQuality(quality),
      performance: resolveClientPerformanceProfile(quality),
      touchDpr: resolveRenderDpr(quality, true, 3),
    }));
    expect(profiles[0].environment.particulateBudget).toBeLessThan(profiles[1].environment.particulateBudget);
    expect(profiles[1].environment.particulateBudget).toBeLessThan(profiles[2].environment.particulateBudget);
    expect(profiles[0].performance.preyUpdateHz).toBeLessThan(profiles[2].performance.preyUpdateHz);
    expect(profiles[0].touchDpr).toBeLessThan(profiles[2].touchDpr);

    expect(settings).toContain('options={[{ v: "low", l: "Low" }, { v: "medium", l: "Medium" }, { v: "high", l: "High" }]}');
    expect(settings).toContain('label="Contrast"');
    expect(settings).toContain('{ v: "high", l: "High" }');
    expect(settings).toContain('label="Motion"');
    expect(settings).toContain('{ v: "reduced", l: "Reduced" }');
    expect(settings).toContain('label="Captions for audio cues"');
    expect(settings).toContain('label="Show shark name labels"');
    expect(gameScreen).toContain('settings.a11y.motion === "reduced"');
    expect(gameScreen).toContain("settings.a11y.colorblindLabels && <SnakeLabels");
    expect(gameScreen).toContain("settings.audio.captions && <Captions");
    expect(theme).toContain(':root[data-contrast="high"]');
    expect(viewport).toContain("settings.graphics.quality");
    expect(viewport).toContain("<Canvas");
    expect(viewport).not.toContain("CanvasRenderingContext2D");
  });

  it("sustains a maximum tracked-shark room through a complete authoritative Feeding Frenzy", () => {
    const state = createRoom({ id: "st-131-full-room", seed: "st-131-full-room" });
    join(state, "pilot");
    spawnBots(state, BOT_AI_BUDGET.maxTrackedSharks - 1);
    expect(Object.keys(state.snakes)).toHaveLength(BOT_AI_BUDGET.maxTrackedSharks);
    expect(Object.values(state.snakes).filter((shark) => shark.isBot)).toHaveLength(BOT_AI_BUDGET.maxTrackedSharks - 1);
    expect(state.food).toHaveLength(PREY_BUDGET.ambient);

    state.tick = FRENZY_RULES.periodTicks - 1;
    step(state);
    expect(isFrenzy(state)).toBe(true);
    expect(state.food.some((prey) => prey.kind === "chum")).toBe(true);

    let frenzyTicks = 0;
    let peakPrey = state.food.length;
    for (let index = 0; index < FRENZY_RULES.durationTicks; index += 1) {
      if (isFrenzy(state)) frenzyTicks += 1;
      peakPrey = Math.max(peakPrey, state.food.length);
      expect(state.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
      step(state);
    }

    expect(frenzyTicks).toBe(FRENZY_RULES.durationTicks);
    expect(peakPrey).toBeGreaterThanOrEqual(PREY_BUDGET.ambient);
    expect(isFrenzy(state)).toBe(false);
    expect(state.food.some((prey) => prey.kind === "chum")).toBe(false);
    expect(Object.keys(state.snakes)).toHaveLength(BOT_AI_BUDGET.maxTrackedSharks);

    const net = toNetState(state);
    expect(net.snakes).toHaveLength(BOT_AI_BUDGET.maxTrackedSharks);
    expect(net.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
    expect(net.snakes.every((shark) => shark.segments.every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    ))).toBe(true);
  });

  it("keeps support surfaces and release/provider compatibility boundaries inside the existing acceptance gates", () => {
    const localAcceptance = read("../scripts/local-worker-acceptance.mjs");
    const publicIa = read("../scripts/check-public-ia.mjs");
    const wrangler = read("../wrangler.jsonc");
    const ci = read("../.github/workflows/ci.yml");
    const tagRelease = read("../.github/workflows/tag-release.yml");
    const release = read("../.github/workflows/release.yml");
    const deploy = read("../.github/workflows/deploy.yml");
    const plan = read("../implementation_plan.md");
    const manual = read("../docs/PRODUCT-ACCEPTANCE.md");
    const pkg = JSON.parse(read("../package.json")) as { version: string };
    const github = JSON.parse(read("../config/github-repository-settings.json")) as {
      mergeMethods: { mergeCommit: boolean; squash: boolean; rebase: boolean };
      deleteBranchOnMerge: boolean;
      requiredStatusChecks: string[];
      rulesets: Array<{ name: string; bypassActors: unknown[] }>;
    };

    expect(localAcceptance).toContain('runNodeScript("./check-public-ia.mjs"');
    expect(localAcceptance).toContain('runNodeScript("./check-evidence.mjs"');
    expect(localAcceptance).toContain('"CLOUDFLARE_API_TOKEN"');
    expect(publicIa).toContain('const canonical = ["/", "/evidence/", "/play/"];');
    expect(publicIa).toContain('const adminDenied = await request("/admin/");');
    expect(publicIa).toContain("authenticated /admin/ expected 200");
    expect(publicIa).toContain("await verifyRoomWebSocket()");
    for (const path of ["/api/health", "/api/tank", "/api/profile"]) expect(publicIa).toContain(path);

    expect(wrangler).toContain('"name": "ROOM"');
    expect(wrangler).toContain('"class_name": "Room"');
    expect(wrangler).toContain('"name": "LOBBY"');
    expect(wrangler).toContain('"class_name": "Lobby"');
    expect(wrangler).toContain('"tag": "v1"');
    expect(ci).toContain("run: npm run check");
    expect(ci).toContain("run: npm run audit:dependencies");
    expect(tagRelease).toContain("workflow_run:");
    expect(tagRelease).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(release).toContain("needs: publish-release");
    expect(release).toContain("uses: ./.github/workflows/deploy.yml");
    expect(deploy).toContain("workflow_call:");
    expect(deploy).toContain("environment: production");

    expect(github.mergeMethods).toEqual({ mergeCommit: false, squash: true, rebase: false });
    expect(github.deleteBranchOnMerge).toBe(true);
    expect(github.requiredStatusChecks).toEqual(["verify"]);
    expect(github.rulesets.find((rule) => rule.name === "main-protection")?.bypassActors).toEqual([]);
    expect(github.rulesets.find((rule) => rule.name === "release-tag-immutability")?.bypassActors).toEqual([]);

    expect(pkg.version).toBe("2.0.0");
    expect(pkg.releaseRevision).toBe(1);
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    expect(plan).not.toContain("### ST-131");
    expect(plan).not.toContain("### ST-132");
    expect(plan).toContain("The queue is empty. Select no implementation task.");

    for (const phrase of [
      "A manual-only row is not a pass until somebody actually performs it",
      "Real-browser desktop acceptance",
      "Accessibility and visual acceptance",
      "Physical touch acceptance",
      "Support-surface acceptance",
      "NOT RUN",
      "Never use production credentials to satisfy ST-131",
    ]) expect(manual).toContain(phrase);
  });
});
