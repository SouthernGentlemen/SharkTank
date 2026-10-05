import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREY_BUDGET,
  PREY_KINDS,
  PREY_SPECS,
  ROOM_SCHEMA_VERSION,
  applyAction,
  createRoom,
  isInsideOceanVolume,
  step,
  type Prey,
  type Snake,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION, toNetState } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  PREY_SILHOUETTE,
  preyVisualFor,
  resolvePreyAnimation,
  resolvePreyPresentationQuality,
} from "../vendor/ModuleReact3Fiber/src/client/game/preyPresentation.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Snake {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.snakes[id];
}

function place(shark: Snake, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.path = [{ ...point }];
  shark.segments = [{ ...point }];
}

function prey(overrides: Partial<Prey> & Pick<Prey, "id" | "kind" | "x" | "y" | "z">): Prey {
  const spec = PREY_SPECS[overrides.kind];
  return {
    value: spec.value,
    r: spec.r,
    yaw: 0,
    pitch: 0,
    school: overrides.kind === "carcass" ? -1 : 0,
    ...overrides,
  };
}

describe("ST-120 authoritative fish and prey schools", () => {
  it("uses a compact typed taxonomy, multiple depths, and an explicit bounded room budget", () => {
    expect(PREY_KINDS).toEqual(["bait", "reef", "chum", "carcass"]);
    expect(PREY_BUDGET).toMatchObject({ ambient: 200, spawnPerTick: 4, max: 360, frenzyChum: 40, schools: 12 });
    expect(PREY_BUDGET.ambient).toBeLessThan(PREY_BUDGET.max);

    const state = createRoom({ seed: "typed-prey" });
    expect(state.food).toHaveLength(PREY_BUDGET.ambient);
    expect(new Set(state.food.map((actor) => actor.kind))).toEqual(new Set(["bait", "reef"]));
    expect(new Set(state.food.map((actor) => Math.round(actor.y))).size).toBeGreaterThan(4);
    for (const actor of state.food) {
      expect(PREY_KINDS).toContain(actor.kind);
      expect(Number.isFinite(actor.yaw) && Number.isFinite(actor.pitch)).toBe(true);
      expect(Number.isInteger(actor.school)).toBe(true);
      expect(isInsideOceanVolume(actor, state.ocean, PREY_BUDGET.boundaryMargin - 0.01)).toBe(true);
    }
  });

  it("moves prey deterministically through X/Y/Z while keeping every actor inside the ocean volume", () => {
    const first = createRoom({ seed: "school-motion" });
    const second = createRoom({ seed: "school-motion" });
    const before = new Map(first.food.map((actor) => [actor.id, { x: actor.x, y: actor.y, z: actor.z }]));

    for (let i = 0; i < 120; i += 1) {
      step(first);
      step(second);
    }

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
    expect(first.food.some((actor) => {
      const old = before.get(actor.id);
      return old && Math.hypot(actor.x - old.x, actor.y - old.y, actor.z - old.z) > 1;
    })).toBe(true);
    expect(first.food.every((actor) => isInsideOceanVolume(actor, first.ocean, PREY_BUDGET.boundaryMargin - 0.01))).toBe(true);
  });

  it("keeps consumption, score and growth authoritative in the engine", () => {
    const state = createRoom({ seed: "authoritative-eat", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [prey({ id: "meal", kind: "bait", x: 0.72, y: 0, z: 0, school: -1 })];
    const shark = join(state, "eater");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    shark.invulnTick = 0;
    const beforeLength = shark.length;

    step(state);

    expect(state.food.some((actor) => actor.id === "meal")).toBe(false);
    expect(shark.score).toBe(1);
    expect(shark.length).toBeGreaterThan(beforeLength);

    const renderer = read("../vendor/ModuleReact3Fiber/src/client/game/PreyLayer.tsx");
    expect(renderer).not.toContain("score +=");
    expect(renderer).not.toContain("length +=");
    expect(renderer).not.toContain("distance3(");
    expect(renderer).not.toContain("applyAction(");
  });

  it("converts shark death/leave drops into authoritative carcass pieces rather than anonymous pellets", () => {
    const state = createRoom({ seed: "carcass-drop" });
    const shark = join(state, "departing");
    place(shark, 4, 2, -3);
    const ambientIds = new Set(state.food.map((actor) => actor.id));

    applyAction(state, { type: "leave", playerId: shark.id });

    const drops = state.food.filter((actor) => !ambientIds.has(actor.id));
    // ST-122 deliberately reduces corpse density so one early kill cannot seed a runaway growth loop.
    expect(drops.length).toBeGreaterThanOrEqual(14);
    expect(drops.length).toBeLessThanOrEqual(28);
    expect(drops.every((actor) => actor.kind === "carcass" && actor.school === -1)).toBe(true);
    expect(drops.every((actor) => isInsideOceanVolume(actor, state.ocean))).toBe(true);
  });

  it("keeps authoritative volumetric prey consumable by the bot planner", () => {
    const state = createRoom({ seed: "bot-prey", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [
      prey({ id: "upper-reef", kind: "reef", x: 8, y: 6, z: 0, school: -1 }),
      ...Array.from({ length: PREY_BUDGET.ambient - 1 }, (_, i) => (
        prey({ id: `far-${i}`, kind: "carcass", x: 70, y: 0, z: (i % 11) - 5, school: -1 })
      )),
    ];
    const bot = join(state, "bot-compat", true);
    place(bot, 0, 0, 0);
    bot.yaw = bot.targetYaw = 0;
    bot.pitch = bot.targetPitch = 0;

    step(state);

    expect(bot.targetPitch).toBeGreaterThan(0);
    const engine = read("../vendor/ModuleReact3Fiber/src/engine/room.ts");
    expect(engine).toContain("choosePreyTarget");
    expect(engine).toContain("yawPitchToward(head, targetPoint)");
  });

  it("renders recognizable procedural fish and distinct chum/carcass drops through bounded instancing", () => {
    expect(PREY_SILHOUETTE).toEqual(["body", "head", "tail"]);
    expect(preyVisualFor("bait", 1, 0.42).mode).toBe("fish");
    expect(preyVisualFor("reef", 2, 0.58).bodyHeight).toBeGreaterThan(preyVisualFor("bait", 1, 0.42).bodyHeight);
    expect(preyVisualFor("chum", 5, 0.95).mode).toBe("drop");
    expect(preyVisualFor("carcass", 2, 0.72).mode).toBe("drop");

    const renderer = read("../vendor/ModuleReact3Fiber/src/client/game/PreyLayer.tsx");
    expect(renderer).toContain("THREE.InstancedMesh");
    expect(renderer).toContain("<sphereGeometry");
    expect(renderer).toContain("<coneGeometry");
    expect(renderer).toContain("<dodecahedronGeometry");
    expect(renderer).toContain("interpolateOrientedPose(prior, actor");
    expect(renderer).toContain("resolvePreyAnimation");
    expect(renderer).toContain("settings.a11y.motion");
    expect(renderer).toContain("PREY_BUDGET.max");
    expect(renderer).not.toContain("icosahedronGeometry");
    expect(renderer).not.toContain("http://");
    expect(renderer).not.toContain("https://");
    expect(renderer).not.toContain("fetch(");
  });

  it("keeps swimming animation presentation-only, reduced-motion-safe and recognizable on low quality", () => {
    const full = resolvePreyAnimation({ tick: 42.5, id: "fish-1", speed: 4, reducedMotion: false });
    expect(resolvePreyAnimation({ tick: 42.5, id: "fish-1", speed: 4, reducedMotion: false })).toEqual(full);
    expect(Math.abs(full.tailYaw)).toBeGreaterThan(0);
    expect(resolvePreyAnimation({ tick: 42.5, id: "fish-1", speed: 4, reducedMotion: true })).toEqual({ bodyYaw: 0, tailYaw: 0 });

    const low = resolvePreyPresentationQuality("low");
    const high = resolvePreyPresentationQuality("high");
    expect(low.radialSegments).toBeGreaterThanOrEqual(6);
    expect(low.radialSegments).toBeLessThan(high.radialSegments);
    expect(PREY_SILHOUETTE).toHaveLength(3);
  });

  it("ships only compact authoritative prey fields and keeps browser presentation out of Worker imports", () => {
    const state = createRoom({ seed: "wire-prey" });
    const net = toNetState(state);
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    expect(net.food).toHaveLength(PREY_BUDGET.ambient);
    expect(net.food[0]).toMatchObject({
      id: state.food[0].id,
      kind: state.food[0].kind,
      value: state.food[0].value,
    });
    expect("school" in net.food[0]).toBe(false);

    const worker = read("../src/worker/index.ts");
    const roomDo = read("../src/worker/room-do.ts");
    expect(worker).not.toContain("@react-three/fiber");
    expect(worker).not.toContain('from "three"');
    expect(roomDo).not.toContain("@react-three/fiber");
    expect(roomDo).not.toContain('from "three"');

    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    const wrangler = read("../wrangler.jsonc");
    expect(packageJson.version).toBe("2.0.1");
    expect(wrangler).toContain('"tag": "v1"');
    expect(wrangler).toContain('"class_name": "Room"');
    expect(wrangler).not.toContain('"class_name": "Lobby"');
  });
});
