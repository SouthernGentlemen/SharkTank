import { toClientSnake, toClientState } from "../src/game/net/clientState.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PITCH,
  PREY_BUDGET,
  applyAction,
  createRoom,
  normalizeYaw,
  type Snake,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  clientInputToAction,
  parseRealtimeClientMessage,
  parseRealtimeServerMessage,
  toNetState,
  withRealtimeProtocol,
} from "../src/protocol/index.js";
import { LocalPredictor } from "../src/game/game/prediction.js";
import { interpolateOrientedPose } from "../src/game/game/sceneMath.js";

function join(state: ReturnType<typeof createRoom>, id: string): Snake {
  applyAction(state, { type: "join", playerId: id, name: id });
  return state.snakes[id];
}

function place(shark: Snake, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe("ST-122 realtime combat protocol", () => {
  it("accepts bounded yaw+pitch intent, target-free bites, and rejects stale schema", () => {
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

    const bite = parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "bite", targetId: "client-chosen-victim" },
    });
    expect(bite).toEqual({
      ok: true,
      message: { v: REALTIME_PROTOCOL_VERSION, t: "input", action: { type: "bite" } },
    });
    if (!bite.ok || bite.message.t !== "input") throw new Error("bite parse failed");
    expect(clientInputToAction(bite.message.action, "attacker")).toEqual({ type: "bite", playerId: "attacker" });

    expect(parseRealtimeClientMessage({
      v: 9,
      t: "input",
      action: { type: "bite" },
    })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: { type: "setOrientation", yaw: Number.NaN, pitch: 0 },
    })).toEqual({ ok: false, reason: "malformed" });
  });

  it("requires realtime protocol 11 on both directions", () => {
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    const state = toNetState(createRoom({ seed: "server-marker" }));
    const current = withRealtimeProtocol({ t: "state" as const, state });
    expect(parseRealtimeServerMessage(current).ok).toBe(true);
    expect(parseRealtimeServerMessage({ t: "state", state })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeServerMessage({ ...current, v: 9 })).toEqual({ ok: false, reason: "stale-schema" });
  });

  it("quantizes complete schema-11 X/Y/Z combat state without ranged projectile state", () => {
    const state = createRoom({ seed: "wire-roundtrip" });
    state.food = [{ id: "food", kind: "reef", x: 1.234, y: -2.345, z: 3.456, value: 3, r: 0.456, yaw: 1.23456, pitch: -0.23456, school: 2 }];
    const shark = join(state, "pilot");
    place(shark, 10.1234, -4.5678, 2.3456);
    shark.yaw = 1.23456;
    shark.pitch = -0.45678;
    shark.health = 66;
    shark.biteCooldownTick = 99;
    state.explosions = [{
      id: "bite-hit",
      x: -1.23456,
      y: 2.34567,
      z: -3.45678,
      tick: 8,
      skin: "cyan",
      kind: "bite",
    }];

    const net = toNetState(state);
    expect(net.schemaVersion).toBe(11);
    expect(net.snakes.find((item) => item.id === shark.id)?.segments[0]).toEqual({ x: 10.12, y: -4.57, z: 2.35 });
    expect(net.snakes.find((item) => item.id === shark.id)).toMatchObject({
      yaw: 1.235,
      pitch: -0.457,
      health: 66,
      biteCooldownTick: 99,
    });
    expect(net.food[0]).toEqual({ id: "food", kind: "reef", x: 1.2, y: -2.3, z: 3.5, value: 3, r: 0.46, yaw: 1.235, pitch: -0.235 });
    expect(net.explosions[0]).toMatchObject({ x: -1.23, y: 2.35, z: -3.46, kind: "bite" });
    expect(JSON.stringify(net).toLowerCase()).not.toContain("rocket");
    expect(JSON.parse(JSON.stringify(net))).toEqual(net);
  });

  it("parses attributed combat deaths", () => {
    const parsed = parseRealtimeServerMessage(withRealtimeProtocol({
      t: "died" as const,
      by: "Hunter",
      action: "bite" as const,
      tick: 144,
      score: 19,
      respawnInMs: 1000,
    }));
    expect(parsed.ok).toBe(true);
    expect(parseRealtimeServerMessage(withRealtimeProtocol({
      t: "died" as const,
      by: "Hunter",
      action: "laser" as never,
      tick: 144,
      score: 19,
      respawnInMs: 1000,
    }))).toEqual({ ok: false, reason: "malformed" });
  });

  it("preserves protocol 11 while adapting living and dead sharks to single positions", () => {
    const state = createRoom({ seed: "single-position-adapter" });
    const shark = join(state, "you");
    place(shark, 10.123, -4.567, 2.345);
    const wire = toNetState(state);
    expect(wire.snakes[0]).toMatchObject({
      segments: [{ x: 10.12, y: -4.57, z: 2.35 }], boosting: false, chargeTicks: 0,
    });
    const client = toClientState(wire).snakes[0];
    expect(client.position).toEqual(wire.snakes[0].segments[0]);
    expect(client).not.toHaveProperty("segments");
    expect(client).not.toHaveProperty("boosting");
    expect(client).not.toHaveProperty("chargeTicks");
    shark.alive = false;
    const deadWire = toNetState(state);
    expect(deadWire.snakes[0].segments).toEqual([]);
    expect(toClientState(deadWire).snakes[0].position).toBeUndefined();
    expect(new LocalPredictor().step(toClientSnake(deadWire.snakes[0]), {
      targetYaw: 0, targetPitch: 0, boosting: false,
    }, 1 / 60, 0)).toBeNull();
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
    predictor.step(toClientSnake(auth!), { targetYaw: 0, targetPitch: 0, boosting: false }, 0.016, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    const climbed = predictor.step(toClientSnake(auth!), { targetYaw: Math.PI / 3, targetPitch: Math.PI / 5, boosting: false }, 0.05, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    expect(climbed).not.toBeNull();
    expect(climbed!.position.x).toBeGreaterThan(0);
    expect(climbed!.position.y).toBeGreaterThan(0);
    expect(Math.abs(climbed!.position.z)).toBeGreaterThan(0);

    const correctedAuth = {
      ...auth!,
      segments: [{ x: climbed!.position.x + 2, y: climbed!.position.y + 1, z: climbed!.position.z - 2 }],
      yaw: climbed!.yaw,
      pitch: climbed!.pitch,
    };
    const corrected = predictor.step(toClientSnake(correctedAuth), {
      targetYaw: climbed!.yaw,
      targetPitch: -Math.PI / 5,
      boosting: false,
    }, 0.05, 0, {
      seabedY: -20, surfaceY: 20, tick: 1, frenzyUntilTick: 0,
    });
    expect(corrected).not.toBeNull();
    expect(corrected!.position.x).toBeGreaterThan(climbed!.position.x);
    expect(corrected!.position.z).toBeLessThan(climbed!.position.z);
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

  it("keeps a deterministic representative full-room snapshot under the explicit byte budget", () => {
    const state = createRoom({ id: "budget-room", seed: "snapshot-budget", oceanRadius: 82, seabedY: -12, surfaceY: 12 });
    state.food = Array.from({ length: PREY_BUDGET.max }, (_, i) => ({
      id: `prey-${i}`,
      kind: i % 9 === 0 ? "reef" as const : "bait" as const,
      x: ((i * 17) % 160) / 1.37 - 58,
      y: ((i * 13) % 220) / 10.7 - 10,
      z: ((i * 19) % 160) / 1.41 - 56,
      value: i % 9 === 0 ? 2 : 1,
      r: i % 9 === 0 ? 0.58 : 0.42,
      yaw: normalizeYaw(i * 0.21731),
      pitch: -0.45 + (i % 18) * 0.05,
      school: i % PREY_BUDGET.schools,
    }));
    state.snakes = {};
    for (let i = 0; i < 32; i += 1) {
      const shark = join(state, `shark-${i.toString().padStart(2, "0")}`);
      place(shark, i * 1.234567 - 18, (i % 20) * 0.987654 - 9, i * -1.13579 + 17);
      shark.yaw = normalizeYaw(i * 0.379123);
      shark.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, -0.8 + i * 0.051234));
      shark.length = 10 + i * 0.731;
      shark.score = i * 11;
      shark.health = 35 + (i % 66);
      shark.biteCooldownTick = 2_000 + i;
    }
    state.explosions = Array.from({ length: 32 }, (_, i) => ({
      id: `burst-${i}`,
      x: i * -0.7654321,
      y: i * 0.1234567 - 2,
      z: i * 1.3456789,
      tick: 1_900 + i,
      skin: "magenta",
      kind: i % 3 === 0 ? "bite" as const : i % 3 === 1 ? "shark" as const : "frenzy" as const,
    }));
    state.tick = 1_950;
    state.frenzyUntilTick = 2_100;

    const net = toNetState(state);
    const message = withRealtimeProtocol({ t: "state" as const, state: net });
    const afterBytes = bytes(message);
    const preQuantization = withRealtimeProtocol({
      t: "state" as const,
      state: { ...net, food: state.food, explosions: state.explosions },
    });
    const preQuantizationBytes = bytes(preQuantization);

    const planar = JSON.parse(JSON.stringify(message)) as {
      state: {
        snakes: Array<{ segments: Array<{ y?: number }>; pitch?: number }>;
        food: Array<{ y?: number; pitch?: number }>;
        explosions: Array<{ y?: number }>;
      };
    };
    for (const item of planar.state.snakes) {
      for (const segment of item.segments) delete segment.y;
      delete item.pitch;
    }
    for (const item of planar.state.food) {
      delete item.y;
      delete item.pitch;
    }
    for (const item of planar.state.explosions) delete item.y;
    const planarBytes = bytes(planar);

    const MAX_FULL_ROOM_BYTES = 60_000;
    const MAX_3D_OVERHEAD_BYTES = 10_000;
    console.info(`ST-122 snapshot bytes: ${afterBytes}; pre-quantization: ${preQuantizationBytes}; planar-equivalent: ${planarBytes}; budget: ${MAX_FULL_ROOM_BYTES}`);
    expect(afterBytes).toBeLessThanOrEqual(MAX_FULL_ROOM_BYTES);
    expect(afterBytes).toBeLessThanOrEqual(preQuantizationBytes);
    expect(afterBytes - planarBytes).toBeLessThanOrEqual(MAX_3D_OVERHEAD_BYTES);
  });

  it("keeps the Durable Object on schema-aware target-free input parsing", () => {
    const source = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    const protocolSource = readFileSync(new URL("../src/protocol/index.ts", import.meta.url), "utf8");
    expect(source).toContain("parseRealtimeClientMessage(parsed)");
    expect(source).toContain("clientInputToAction(msg.action, session.id)");
    expect(source).toContain("realtime schema mismatch");
    expect(source).toContain("withRealtimeProtocol(msg)");
    expect(protocolSource).not.toContain("targetId");
    expect(protocolSource.toLowerCase()).not.toContain("rocket");
  });
});
