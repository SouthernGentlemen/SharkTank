import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PITCH,
  applyAction,
  createRoom,
  normalizeYaw,
  type Snake,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  parseRealtimeClientMessage,
  parseRealtimeServerMessage,
  toNetState,
  withRealtimeProtocol,
} from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import { LocalPredictor } from "../vendor/ModuleReact3Fiber/src/client/game/prediction.js";
import { interpolateOrientedPose } from "../vendor/ModuleReact3Fiber/src/client/game/sceneMath.js";

function join(state: ReturnType<typeof createRoom>, id: string): Snake {
  applyAction(state, { type: "join", playerId: id, name: id });
  return state.snakes[id];
}

function place(shark: Snake, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.path = [{ ...point }];
  shark.segments = [{ ...point }];
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("ST-114 realtime 3D protocol", () => {
  it("accepts bounded yaw+pitch intent and distinguishes stale schema from malformed input", () => {
    const valid = parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setOrientation", yaw: Math.PI * 5, pitch: 99 },
    });
    expect(valid).toEqual({
      ok: true,
      message: {
        v: REALTIME_PROTOCOL_VERSION,
        t: "input",
        action: { type: "setOrientation", yaw: normalizeYaw(Math.PI * 5), pitch: MAX_PITCH },
      },
    });

    expect(parseRealtimeClientMessage({
      v: 7,
      t: "input",
      action: { type: "setOrientation", yaw: 0, pitch: 0 },
    })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeClientMessage({
      t: "input",
      action: { type: "setOrientation", yaw: 0, pitch: 0 },
    })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setOrientation", yaw: Number.NaN, pitch: 0 },
    })).toEqual({ ok: false, reason: "malformed" });
    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setOrientation", yaw: 0, pitch: Number.POSITIVE_INFINITY },
    })).toEqual({ ok: false, reason: "malformed" });
    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setOrientation", yaw: 0 },
    })).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires the same marker on server messages so a mixed deployment fails visibly", () => {
    const state = toNetState(createRoom({ seed: "server-marker" }));
    const current = withRealtimeProtocol({ t: "state" as const, state });
    expect(parseRealtimeServerMessage(current).ok).toBe(true);
    expect(parseRealtimeServerMessage({ t: "state", state })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeServerMessage({ ...current, v: 7 })).toEqual({ ok: false, reason: "stale-schema" });
  });

  it("quantizes complete schema-8 X/Y/Z state for sharks, prey, projectiles and explosions", () => {
    const state = createRoom({ seed: "wire-roundtrip" });
    state.food = [{ id: "food", x: 1.234, y: -2.345, z: 3.456, value: 3, r: 0.456 }];
    const shark = join(state, "pilot");
    place(shark, 10.1234, -4.5678, 2.3456);
    shark.yaw = 1.23456;
    shark.pitch = -0.45678;
    state.rockets = [{
      id: "rocket",
      ownerId: shark.id,
      x: 2.34567,
      y: -3.45678,
      z: 4.56789,
      yaw: 3.14159,
      pitch: -0.98765,
      expiresTick: 99,
    }];
    state.explosions = [{
      id: "burst",
      x: -1.23456,
      y: 2.34567,
      z: -3.45678,
      tick: 8,
      skin: "cyan",
      kind: "rocket",
    }];

    const net = toNetState(state);
    expect(net.schemaVersion).toBe(8);
    expect(net.snakes.find((item) => item.id === shark.id)?.segments[0]).toEqual({ x: 10.12, y: -4.57, z: 2.35 });
    expect(net.snakes.find((item) => item.id === shark.id)).toMatchObject({ yaw: 1.235, pitch: -0.457 });
    expect(net.food[0]).toEqual({ x: 1.2, y: -2.3, z: 3.5, value: 3, r: 0.46 });
    expect(net.rockets[0]).toMatchObject({ x: 2.35, y: -3.46, z: 4.57, yaw: 3.142, pitch: -0.988 });
    expect(net.explosions[0]).toMatchObject({ x: -1.23, y: 2.35, z: -3.46 });
    expect(JSON.parse(JSON.stringify(net))).toEqual(net);
  });

  it("predicts climb/dive and yaw movement, then reconciles authoritative X/Y/Z correction", () => {
    const state = createRoom({ seed: "prediction", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [];
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const auth = toNetState(state).snakes.find((item) => item.id === shark.id);
    expect(auth).toBeDefined();

    const predictor = new LocalPredictor();
    predictor.step(auth, { targetYaw: 0, targetPitch: 0, boosting: false }, 0.016, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    const climbed = predictor.step(auth, { targetYaw: Math.PI / 3, targetPitch: Math.PI / 5, boosting: false }, 0.05, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    expect(climbed).not.toBeNull();
    expect(climbed!.head.x).toBeGreaterThan(0);
    expect(climbed!.head.y).toBeGreaterThan(0);
    expect(Math.abs(climbed!.head.z)).toBeGreaterThan(0);
    expect(climbed!.yaw).not.toBe(0);
    expect(climbed!.pitch).toBeGreaterThan(0);

    const correctedAuth = {
      ...auth!,
      segments: [{ x: climbed!.head.x + 2, y: climbed!.head.y + 1, z: climbed!.head.z - 2 }],
      yaw: climbed!.yaw,
      pitch: climbed!.pitch,
    };
    const corrected = predictor.step(correctedAuth, {
      targetYaw: climbed!.yaw,
      targetPitch: -Math.PI / 5,
      boosting: false,
    }, 0.05, 0, {
      seabedY: -20, surfaceY: 20, tick: 1, frenzyUntilTick: 0,
    });
    expect(corrected).not.toBeNull();
    expect(corrected!.head.x).toBeGreaterThan(climbed!.head.x);
    expect(corrected!.head.z).toBeLessThan(climbed!.head.z);
    expect(corrected!.pitch).toBeLessThan(climbed!.pitch);
  });

  it("interpolates remote X/Y/Z and pitch while taking the shortest yaw path across ±π", () => {
    const mid = interpolateOrientedPose(
      { x: -4, y: -8, z: 2, yaw: Math.PI - 0.1, pitch: -0.4 },
      { x: 6, y: 4, z: 10, yaw: -Math.PI + 0.1, pitch: 0.6 },
      0.5,
    );
    expect(mid).toMatchObject({ x: 1, y: -2, z: 6 });
    expect(mid.pitch).toBeCloseTo(0.1);
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3);
  });

  it("keeps a deterministic representative full-room snapshot under an explicit byte budget", () => {
    const state = createRoom({ id: "budget-room", seed: "snapshot-budget", oceanRadius: 82, seabedY: -12, surfaceY: 12 });
    state.food = Array.from({ length: 620 }, (_, i) => ({
      id: `food-${i}`,
      x: ((i * 17) % 160) / 1.37 - 58,
      y: ((i * 13) % 220) / 10.7 - 10,
      z: ((i * 19) % 160) / 1.41 - 56,
      value: i % 5 === 0 ? 3 : 1,
      r: i % 5 === 0 ? 0.72 : 0.45,
    }));
    state.snakes = {};
    for (let i = 0; i < 32; i += 1) {
      const shark = join(state, `shark-${i.toString().padStart(2, "0")}`);
      place(shark, i * 1.234567 - 18, (i % 20) * 0.987654 - 9, i * -1.13579 + 17);
      shark.yaw = normalizeYaw(i * 0.379123);
      shark.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, -0.8 + i * 0.051234));
      shark.length = 10 + i * 0.731;
      shark.score = i * 11;
    }
    state.rockets = Array.from({ length: 32 }, (_, i) => ({
      id: `rocket-${i}`,
      ownerId: `shark-${i.toString().padStart(2, "0")}`,
      x: i * 1.234567,
      y: i * -0.234567,
      z: i * 0.987654,
      yaw: normalizeYaw(i * 0.543219),
      pitch: -0.7 + i * 0.031415,
      expiresTick: 2_000 + i,
    }));
    state.explosions = Array.from({ length: 32 }, (_, i) => ({
      id: `burst-${i}`,
      x: i * -0.7654321,
      y: i * 0.1234567 - 2,
      z: i * 1.3456789,
      tick: 1_900 + i,
      skin: "magenta",
      kind: i % 2 ? "rocket" as const : "shark" as const,
    }));
    state.tick = 1_950;
    state.frenzyUntilTick = 2_100;

    const net = toNetState(state);
    const message = withRealtimeProtocol({ t: "state" as const, state: net });
    const afterBytes = bytes(message);
    const preQuantization = withRealtimeProtocol({
      t: "state" as const,
      state: { ...net, rockets: state.rockets, explosions: state.explosions },
    });
    const preQuantizationBytes = bytes(preQuantization);

    const planar = JSON.parse(JSON.stringify(message)) as {
      state: {
        snakes: Array<{ segments: Array<{ y?: number }>; pitch?: number }>;
        food: Array<{ y?: number }>;
        rockets: Array<{ y?: number; pitch?: number }>;
        explosions: Array<{ y?: number }>;
      };
    };
    for (const item of planar.state.snakes) {
      for (const segment of item.segments) delete segment.y;
      delete item.pitch;
    }
    for (const item of planar.state.food) delete item.y;
    for (const item of planar.state.rockets) {
      delete item.y;
      delete item.pitch;
    }
    for (const item of planar.state.explosions) delete item.y;
    const planarBytes = bytes(planar);

    const MAX_FULL_ROOM_BYTES = 56_000;
    const MAX_3D_OVERHEAD_BYTES = 10_000;
    console.info(`ST-114 snapshot bytes: ${afterBytes}; pre-quantization: ${preQuantizationBytes}; planar-equivalent: ${planarBytes}; budget: ${MAX_FULL_ROOM_BYTES}`);
    expect(afterBytes).toBeLessThanOrEqual(MAX_FULL_ROOM_BYTES);
    expect(afterBytes).toBeLessThanOrEqual(preQuantizationBytes);
    expect(afterBytes - planarBytes).toBeLessThanOrEqual(MAX_3D_OVERHEAD_BYTES);
  });

  it("wires the Durable Object to schema-aware parsing and removes the planar input protocol", () => {
    const source = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    const protocolSource = readFileSync(new URL("../vendor/ModuleReact3Fiber/src/protocol/index.ts", import.meta.url), "utf8");
    expect(source).toContain("parseRealtimeClientMessage(parsed)");
    expect(source).toContain("clientInputToAction(msg.action, session.id)");
    expect(source).toContain("realtime schema mismatch");
    expect(source).toContain("withRealtimeProtocol(msg)");
    expect(source).not.toContain("setHeading");
    expect(protocolSource).not.toContain("LegacyPlanarHeadingAction");
    expect(protocolSource).not.toContain("legacyPlanarHeadingToOrientation");
  });
});
