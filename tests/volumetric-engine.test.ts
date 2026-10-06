import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROOM_SCHEMA_VERSION,
  applyAction,
  createRoom,
  forwardFromYawPitch,
  MAX_PITCH,
  normalizeYaw,
  spawnBots,
  step,
  type Action,
  type Shark,
} from "../src/engine/index.js";
import { toNetState } from "../src/protocol/index.js";

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

function join(state: ReturnType<typeof createRoom>, id: string): Shark {
  applyAction(state, { type: "join", playerId: id, name: id });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
}

describe("volumetric authoritative engine", () => {
  it("uses schema 11, X/Y/Z state, bounded volume spawns and no authoritative roll", () => {
    const state = createRoom({ seed: "volume-shape" });
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(toNetState(state)).not.toHaveProperty("schemaVersion");
    expect(state.ocean.surfaceY).toBeGreaterThan(state.ocean.seabedY);
    expect(state.food.some((food) => Math.abs(food.y) > 0.1)).toBe(true);
    expect(state.food.every((food) => insideOcean(food, state.ocean))).toBe(true);

    const sharks = ["a", "b", "c", "d"].map((id) => join(state, id));
    expect(new Set(sharks.map((shark) => shark.position.y.toFixed(4))).size).toBeGreaterThan(1);
    expect(sharks.every((shark) => Number.isFinite(shark.yaw) && Number.isFinite(shark.pitch))).toBe(true);
    expect("roll" in sharks[0]).toBe(false);
  });

  it("moves vertically from pitch while preserving the ST-111 yaw convention", () => {
    const state = createRoom({ seed: "pitch-motion", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [];
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    shark.invulnTick = 0;
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;

    const forward = forwardFromYawPitch(0, Math.PI / 6);
    expect(forward.x).toBeGreaterThan(0);
    expect(forward.y).toBeGreaterThan(0);
    expect(forward.z).toBeCloseTo(0);

    applyAction(state, { type: "setOrientation", playerId: shark.id, yaw: 0, pitch: Math.PI / 6 });
    step(state);
    const climbedY = shark.position.y;
    expect(climbedY).toBeGreaterThan(0);

    applyAction(state, { type: "setOrientation", playerId: shark.id, yaw: 0, pitch: -Math.PI / 6 });
    for (let i = 0; i < 5; i += 1) step(state);
    expect(shark.position.y).toBeLessThan(climbedY);
  });

  it("enforces radial death plus surface and seabed clamps", () => {
    const state = createRoom({ seed: "bounds", oceanRadius: 20, seabedY: -4, surfaceY: 4 });
    state.food = [];
    const shark = join(state, "bounds");
    shark.invulnTick = 0;

    place(shark, 0, 3.9, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = Math.PI / 3;
    step(state);
    expect(shark.alive).toBe(true);
    expect(shark.position.y).toBeLessThanOrEqual(state.ocean.surfaceY);
    expect(shark.pitch).toBe(0);

    place(shark, 0, -3.9, 0);
    shark.pitch = shark.targetPitch = -Math.PI / 3;
    step(state);
    expect(shark.position.y).toBeGreaterThanOrEqual(state.ocean.seabedY);
    expect(shark.pitch).toBe(0);

    place(shark, state.ocean.radius - 0.1, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    step(state);
    expect(shark.alive).toBe(false);
  });

  it("uses vertical separation for prey and shark collision geometry", () => {
    const state = createRoom({ seed: "vertical-collision", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [];
    const eater = join(state, "eater");
    const rival = join(state, "rival");
    eater.invulnTick = rival.invulnTick = 0;
    eater.length = 30;
    rival.length = 10;
    eater.yaw = eater.targetYaw = rival.yaw = rival.targetYaw = 0;
    eater.pitch = eater.targetPitch = rival.pitch = rival.targetPitch = 0;
    place(eater, 0, -5, 0);
    place(rival, 20, 5, 0);

    state.food = [{ id: "high", kind: "reef", x: eater.position.x + 0.556, y: 5, z: 0, value: 2, r: 0.4, yaw: 0, pitch: 0, school: 1 }];
    step(state);
    expect(state.food.some((food) => food.id === "high")).toBe(true);
    expect(rival.alive).toBe(true);

    const head = eater.position;
    state.food = [{ id: "same-depth", kind: "reef", x: head.x + 0.556, y: head.y, z: head.z, value: 2, r: 0.4, yaw: 0, pitch: 0, school: 1 }];
    step(state);
    expect(state.food.some((food) => food.id === "same-depth")).toBe(false);

    place(eater, 10, -5, 0);
    place(rival, 10, 5, 0);
    eater.yaw = eater.targetYaw = rival.yaw = rival.targetYaw = 0;
    step(state);
    expect(rival.alive).toBe(true);

    place(eater, 20, 0, 0);
    place(rival, 20, 0, 0);
    eater.yaw = eater.targetYaw = rival.yaw = rival.targetYaw = 0;
    step(state);
    expect(rival.alive).toBe(true);
  });

  it("normalizes yaw, clamps pitch and rejects non-finite authoritative orientation", () => {
    const state = createRoom({ seed: "finite-input" });
    const shark = join(state, "p");

    applyAction(state, { type: "setOrientation", playerId: "p", yaw: Math.PI * 5, pitch: 99 });
    expect(shark.targetYaw).toBe(normalizeYaw(Math.PI * 5));
    expect(shark.targetPitch).toBe(MAX_PITCH);

    const before = { yaw: shark.targetYaw, pitch: shark.targetPitch };
    applyAction(state, { type: "setOrientation", playerId: "p", yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY } as Action);
    expect({ yaw: shark.targetYaw, pitch: shark.targetPitch }).toEqual(before);
  });

  it("serializes complete 3D state and remains seeded deterministic", () => {
    const left = createRoom({ id: "same", seed: "volumetric-replay" });
    const right = createRoom({ id: "same", seed: "volumetric-replay" });
    spawnBots(left, 3);
    spawnBots(right, 3);
    const actions: Array<{ tick: number; action: Action }> = [
      { tick: 0, action: { type: "join", playerId: "p", name: "Pilot" } },
      { tick: 1, action: { type: "setOrientation", playerId: "p", yaw: 0.75, pitch: 0.3 } },
      { tick: 2, action: { type: "setBoost", playerId: "p", on: true } },
    ];
    for (let tick = 0; tick < 8; tick += 1) {
      for (const entry of actions.filter((entry) => entry.tick === tick)) {
        applyAction(left, entry.action);
        applyAction(right, entry.action);
      }
      step(left);
      step(right);
    }
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));

    const net = toNetState(left);
    expect(net).not.toHaveProperty("schemaVersion");
    expect(net.seabedY).toBe(left.ocean.seabedY);
    expect(net.surfaceY).toBe(left.ocean.surfaceY);
    expect(net.sharks.every((shark) => Number.isFinite(shark.position.y))).toBe(true);
    expect(net.food.every((food) => Number.isFinite(food[3]))).toBe(true);
  });

  it("keeps authoritative modules framework-agnostic and free of planar actor distance helpers", () => {
    const roomSource = readFileSync(new URL("../src/engine/room.ts", import.meta.url), "utf8");
    const geometrySource = readFileSync(new URL("../src/engine/geometry3d.ts", import.meta.url), "utf8");
    const typesSource = readFileSync(new URL("../src/engine/types.ts", import.meta.url), "utf8");
    for (const source of [roomSource, geometrySource, typesSource]) {
      expect(source).not.toContain('from "three"');
      expect(source).not.toContain("@react-three");
      expect(source).not.toContain("document.");
      expect(source).not.toContain("window.");
    }
    expect(roomSource).not.toContain("Math.hypot");
    expect(typesSource).not.toContain("Vec2");
    expect(typesSource).not.toContain("heading:");
    expect(typesSource).not.toContain("roll:");
  });
});
