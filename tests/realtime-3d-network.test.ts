import { toClientShark, toClientState } from "../src/game/net/clientState.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PITCH,
  MOVE,
  TICKS_PER_SECOND,
  PREY_BUDGET,
  applyAction,
  step,
  glidePitch,
  createRoom,
  normalizeYaw,
  type Shark,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  clientInputToAction,
  parseRealtimeClientMessage,
  parseRealtimeServerMessage,
  toNetState,
  decodeState,
  decodePrey,
  encodePrey,
  preyWireId,
  PREY_SPECIES,
  withRealtimeProtocol,
} from "../src/protocol/index.js";
import { LocalPredictor } from "../src/game/game/prediction.js";
import { interpolateOrientedPose } from "../src/game/game/sceneMath.js";

function join(state: ReturnType<typeof createRoom>, id: string): Shark {
  applyAction(state, { type: "join", playerId: id, name: id });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
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

  it("requires realtime protocol 12 on both directions", () => {
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    const state = toNetState(createRoom({ seed: "server-marker" }));
    const current = withRealtimeProtocol({ t: "state" as const, state });
    expect(parseRealtimeServerMessage(current).ok).toBe(true);
    expect(parseRealtimeServerMessage({ t: "state", state })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeServerMessage({ ...current, v: 9 })).toEqual({ ok: false, reason: "stale-schema" });
  });

  it("quantizes complete protocol-12 X/Y/Z combat state without ranged projectile state", () => {
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
    expect(net).not.toHaveProperty("schemaVersion");
    expect(net.sharks.find((item) => item.id === shark.id)?.position).toEqual({ x: 10.12, y: -4.57, z: 2.35 });
    expect(net.sharks.find((item) => item.id === shark.id)).toMatchObject({
      yaw: 1.235,
      pitch: -0.457,
      health: 66,
      biteCooldownTick: 99,
    });
    expect(decodePrey(net.food[0])).toMatchObject({ id: preyWireId("food"), species: "yellow-tang", kind: "reef", x: 1.2, y: -2.3, z: 3.5, value: 2, r: 0.58, yaw: 1.23, pitch: -0.23 });
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

  it("preserves protocol 12 while adapting living and dead sharks to single positions", () => {
    const state = createRoom({ seed: "single-position-adapter" });
    const shark = join(state, "you");
    place(shark, 10.123, -4.567, 2.345);
    const wire = toNetState(state);
    expect(wire.sharks[0]).toMatchObject({
      position: { x: 10.12, y: -4.57, z: 2.35 },
    });
    const adapted = toClientState(decodeState(wire));
    expect(adapted).not.toHaveProperty("snakes");
    expect(state).not.toHaveProperty("snakes");
    expect(wire).not.toHaveProperty("snakes");
    const client = adapted.sharks[0];
    expect(client.position).toEqual(wire.sharks[0].position);
    expect(client).not.toHaveProperty("segments");
    expect(client).not.toHaveProperty("boosting");
    expect(client).not.toHaveProperty("chargeTicks");
    shark.alive = false;
    const deadWire = toNetState(state);
    expect(deadWire.sharks[0].position).toEqual(wire.sharks[0].position);
    expect(toClientState(decodeState(deadWire)).sharks[0].alive).toBe(false);
    expect(new LocalPredictor().step(toClientShark(deadWire.sharks[0]), {
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
    const auth = toNetState(state).sharks.find((item) => item.id === shark.id);
    expect(auth).toBeDefined();

    const predictor = new LocalPredictor();
    predictor.step(toClientShark(auth!), { targetYaw: 0, targetPitch: 0, boosting: false }, 0.016, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    const climbed = predictor.step(toClientShark(auth!), { targetYaw: Math.PI / 3, targetPitch: Math.PI / 5, boosting: false }, 0.05, 0, {
      seabedY: -20, surfaceY: 20, tick: 0, frenzyUntilTick: 0,
    });
    expect(climbed).not.toBeNull();
    expect(climbed!.position.x).toBeGreaterThan(0);
    expect(climbed!.position.y).toBeGreaterThan(0);
    expect(Math.abs(climbed!.position.z)).toBeGreaterThan(0);

    const correctedAuth = {
      ...auth!,
      position: { x: climbed!.position.x + 2, y: climbed!.position.y + 1, z: climbed!.position.z - 2 },
      yaw: climbed!.yaw,
      pitch: climbed!.pitch,
    };
    const corrected = predictor.step(toClientShark(correctedAuth), {
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

  it("predicts a ready dash on the press frame and bounds rejected movement", () => {
    const state = createRoom({ seed: "dash-prediction" });
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const auth = toClientShark(toNetState(state).sharks.find((s) => s.id === shark.id)!);
    const world = { seabedY: -20, surfaceY: 20, tick: state.tick, frenzyUntilTick: 0 };
    const input = { targetYaw: 0, targetPitch: 0, boosting: false };
    const dash = new LocalPredictor();
    const base = new LocalPredictor();
    dash.step(auth, input, 0, 0, world, 0);
    base.step(auth, input, 0, 0, world, 0);
    const pressed = dash.step(auth, input, 0.016, 0, world, 16, 16)!;
    const normal = base.step(auth, input, 0.016, 0, world, 16)!;
    expect(pressed.position.x).toBeGreaterThan(normal.position.x);
    let previous = pressed.position.x;
    for (let now = 32; now <= 320; now += 16) {
      const result = dash.step(auth, input, 0.016, 0, world, now, 16)!;
      expect(Math.abs(result.position.x - previous)).toBeLessThan(1);
      expect(result.position.x).toBeLessThan(8);
      previous = result.position.x;
    }
    const settled = new LocalPredictor();
    settled.step({ ...auth, position: { x: previous, y: 0, z: 0 } }, input, 0, 0, world, 320);
    const after = dash.step(auth, input, 0.016, 0, world, 336, 16)!;
    expect(after).toEqual(settled.step(auth, input, 0.016, 0, world, 336));
  });

  it("honors cooldown, authoritative dash confirmation and prediction reset", () => {
    const state = createRoom({ seed: "dash-confirmation" });
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const auth = toClientShark(toNetState(state).sharks.find((s) => s.id === shark.id)!);
    const world = { seabedY: -20, surfaceY: 20, tick: state.tick, frenzyUntilTick: 0 };
    const input = { targetYaw: 0, targetPitch: 0, boosting: false };
    const predictor = new LocalPredictor();
    const baseline = new LocalPredictor();
    predictor.step(auth, input, 0, 0, world, 0);
    baseline.step(auth, input, 0, 0, world, 0);
    expect(predictor.step({ ...auth, dashCooldownTick: world.tick + 10 }, input, 0.016, 0, world, 16, 16))
      .toEqual(baseline.step(auth, input, 0.016, 0, world, 16));
    predictor.step(auth, input, 0.016, 0, world, 32, 32);
    const confirmed = { ...auth, lungeTicks: 6, dashCooldownTick: world.tick + 40 };
    const confirmedBase = new LocalPredictor();
    const seeded = predictor.step(confirmed, input, 0.016, 0, world, 64, 32)!;
    confirmedBase.step({ ...confirmed, position: seeded.position }, input, 0, 0, world, 64);
    const a = predictor.step({ ...confirmed, position: seeded.position }, input, 0.016, 0, world, 80, 32)!;
    const b = confirmedBase.step({ ...confirmed, position: seeded.position }, input, 0.016, 0, world, 80)!;
    expect(a).toEqual(b);
    predictor.reset();
    expect(predictor.step(auth, input, 0.016, 0, world, 96, 32)?.position).toEqual(auth.position);
  });

  it("blends 6-unit and 12-unit corrections without frame-sized local jumps", () => {
    const state = createRoom({ seed: "visual-correction" });
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const auth = toClientShark(toNetState(state).sharks.find((s) => s.id === shark.id)!);
    const input = { targetYaw: 0, targetPitch: 0, boosting: false };
    for (const error of [6, 12]) {
      const predictor = new LocalPredictor();
      predictor.step(auth, input, 0, 0);
      const corrected = { ...auth, position: { x: 0, y: error, z: 0 } };
      predictor.step(corrected, input, 0, 0);
      let previous = predictor.renderPosition();
      expect(previous).toEqual(auth.position);
      for (let frame = 1; frame <= 120; frame += 1) {
        corrected.position.x += MOVE.BASE_SPEED * TICKS_PER_SECOND / 60;
        predictor.step(corrected, input, 1 / 60, 0);
        const rendered = predictor.renderPosition();
        expect(Math.hypot(rendered.x - previous.x, rendered.y - previous.y, rendered.z - previous.z), `error ${error}, frame ${frame}`).toBeLessThan(error === 6 ? 1 : 1.3);
        previous = rendered;
      }
      expect(previous.y).toBeCloseTo(error, 1);
      expect(corrected.position.y).toBe(error);
    }
  });

  it("clears local visual corrections on death, reconnect, identity changes and tick regression", () => {
    const state = createRoom({ seed: "visual-reset" });
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0);
    const auth = toClientShark(toNetState(state).sharks.find((s) => s.id === shark.id)!);
    const input = { targetYaw: auth.yaw, targetPitch: auth.pitch, boosting: false };
    const world = { seabedY: -20, surfaceY: 20, tick: 10, frenzyUntilTick: 0 };
    for (const reset of ["death", "reconnect", "identity", "tick", "large"] as const) {
      const predictor = new LocalPredictor();
      predictor.step(auth, input, 0, 0, world);
      const corrected = { ...auth, position: { x: 0, y: 10, z: 0 } };
      predictor.step(corrected, input, 0, 0, world);
      expect(predictor.renderPosition().y).toBe(0);
      if (reset === "death") predictor.step({ ...corrected, alive: false }, input, 0, 0, world);
      if (reset === "reconnect") predictor.step(null, input, 0, 0, world);
      const next = { ...corrected, id: reset === "identity" ? "new-pilot" : auth.id,
        position: { x: 0, y: reset === "large" ? 30 : 10, z: 0 } };
      predictor.step(next, input, 0, 0, { ...world, tick: reset === "tick" ? 0 : 10 });
      expect(predictor.renderPosition()).toEqual(next.position);
    }
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
    state.sharks = {};
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

    const MAX_FULL_ROOM_BYTES = 25_000;
    console.info(`ST-240 snapshot bytes: ${afterBytes}; budget: ${MAX_FULL_ROOM_BYTES}`);
    expect(afterBytes).toBeLessThanOrEqual(MAX_FULL_ROOM_BYTES);
    expect(afterBytes).toBeLessThan(preQuantizationBytes);

  });

  it("packs a full 32-shark room with ambient prey within 16 KB", () => {
    const state = createRoom({ seed: "full-room-protocol-12" });
    for (let i = 0; i < 32; i++) join(state, `player-${i}`);
    expect(state.food).toHaveLength(PREY_BUDGET.ambient);
    const wire = withRealtimeProtocol({ t: "welcome" as const, youId: "player-0", roomId: "room-1", state: toNetState(state) });
    expect(bytes(wire)).toBeLessThanOrEqual(16_000);
    const parsed = parseRealtimeServerMessage(JSON.parse(JSON.stringify(wire)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.message.t !== "welcome") throw new Error("welcome parse failed");
    expect(parsed.message.state).toEqual(decodeState(wire.state));
    expect(new Set(parsed.message.state.food.map((prey) => prey.id)).size).toBe(state.food.length);
    expect(parseRealtimeServerMessage({ ...wire, v: 11 })).toEqual({ ok: false, reason: "stale-schema" });
    expect(parseRealtimeClientMessage({ v: 11, t: "hello", name: "Old", skin: "cyan" })).toEqual({ ok: false, reason: "stale-schema" });
  });

  it("round-trips every reserved species and rejects malformed tuples", () => {
    for (let code = 0; code < PREY_SPECIES.length; code++) {
      expect(decodePrey(["abc", code, 1, -2, 3, 0.5, -0.2]).species).toBe(PREY_SPECIES[code]);
    }
    const state = createRoom({ seed: "variants" });
    for (const [kind, value, code] of [["chum", 3, 8], ["chum", 5, 9], ["carcass", 1, 10], ["carcass", 2, 11]] as const) {
      const prey = { ...state.food[0], kind, value };
      expect(encodePrey(prey)[1]).toBe(code);
      expect(decodePrey(encodePrey(prey))).toMatchObject({ kind, value });
    }
    for (const tuple of [["abc", 16, 0, 0, 0, 0, 0], ["abc", 0, NaN, 0, 0, 0, 0], ["abc", 0], {}]) {
      const wire = { ...toNetState(state), food: [tuple] };
      expect(parseRealtimeServerMessage(withRealtimeProtocol({ t: "state", state: wire }))).toEqual({ ok: false, reason: "malformed" });
    }
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


describe("ST-241 session prey visibility", () => {
  it("uses each living viewer's 3D radius and the centre while dead, without mutating authority", () => {
    const room = createRoom({ seed: "visibility" });
    const a = join(room, "a"), b = join(room, "b");
    place(a, 60, 0, 0); place(b, -60, 0, 0);
    const template = room.food[0];
    room.food = [
      { ...template, id: "a-only", x: 80, y: 0, z: 0 },
      { ...template, id: "b-only", x: -80, y: 0, z: 0 },
      { ...template, id: "edge", x: 60, y: 72, z: 0 },
      { ...template, id: "outside", x: 60, y: 72.1, z: 0 },
      { ...template, id: "centre", x: 0, y: 0, z: 0 },
    ];
    const before = JSON.stringify(room);
    const full = toNetState(room), visible = toNetState(room, "a");
    expect(visible.food.map((p) => p[0])).toEqual(["a-only", "edge", "centre"].map(preyWireId));
    expect(toNetState(room, "b").food.map((p) => p[0])).toEqual(["b-only", "centre"].map(preyWireId));
    expect({ ...visible, food: full.food }).toEqual(full);
    expect(JSON.stringify(room)).toBe(before);
    a.alive = false;
    expect(toNetState(room, "a").food.map((p) => p[0])).toEqual([preyWireId("centre")]);
    expect(toNetState(room, "missing").food).toEqual(toNetState(room, "a").food);
    const worker = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    expect(worker.match(/toNetState\(this.room, session.id\)/g)).toHaveLength(2);
  });
});


describe("ST-245 depth gliding", () => {
  it("limits only outward pitch in the three-unit band", () => {
    const ocean = { seabedY: -12, surfaceY: 12 };
    expect(glidePitch(Math.PI / 4, 0, ocean)).toBe(Math.PI / 4);
    expect(glidePitch(MAX_PITCH, 10.5, ocean)).toBeCloseTo(MAX_PITCH / 2);
    expect(glidePitch(-MAX_PITCH, -10.5, ocean)).toBeCloseTo(-MAX_PITCH / 2);
    expect(glidePitch(Math.PI / 4, 12, ocean)).toBe(0);
    expect(glidePitch(-Math.PI / 4, 12, ocean)).toBe(-Math.PI / 4);
    expect(glidePitch(Math.PI / 4, -12, ocean)).toBe(Math.PI / 4);
  });

  it.each([1, -1])("smoothly levels a 45 degree swim with Room/prediction parity (%s)", (sign) => {
    const room = createRoom({ seed: "depth-glide", oceanRadius: 1000 });
    room.food = [];
    const shark = join(room, "pilot");
    place(shark, 0, sign * 9, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = sign * Math.PI / 4;
    const input = { targetYaw: 0, targetPitch: shark.targetPitch, boosting: false };
    const predictor = new LocalPredictor();
    const world = { ...room.ocean, tick: room.tick, frenzyUntilTick: 0 };
    predictor.step(toClientShark({ ...toNetState(room).sharks[0], position: { ...shark.position } }), input, 0, 0, world);
    let previous = Math.abs(shark.pitch);
    for (let tick = 0; tick < 80; tick++) {
      const auth = { ...toNetState(room).sharks[0], position: { ...shark.position }, pitch: shark.pitch };
      step(room);
      // Extrapolate the pre-step snapshot by the exact authoritative step so reconciliation is neutral.
      const predicted = predictor.step(toClientShark({ ...auth, pitch: shark.pitch }), input, 1 / TICKS_PER_SECOND, 1 / TICKS_PER_SECOND, { ...world, tick: room.tick })!;
      expect(predicted.pitch).toBeCloseTo(shark.pitch, 10);
      expect(predicted.position.y).toBeCloseTo(shark.position.y, 10);
      expect(Math.abs(shark.pitch)).toBeLessThanOrEqual(previous);
      expect(previous - Math.abs(shark.pitch)).toBeLessThan(0.21);
      expect(shark.position.y).toBeGreaterThan(room.ocean.seabedY);
      expect(shark.position.y).toBeLessThan(room.ocean.surfaceY);
      previous = Math.abs(shark.pitch);
    }
    expect(previous).toBeLessThan(0.001);
    expect(shark.alive).toBe(true);
  });
});
