import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMBAT,
  FRENZY_RULES,
  ROOM_SCHEMA_VERSION,
  applyAction,
  createRoom,
  isFrenzy,
  step,
  type Action,
  type Prey,
  type RoomState,
  type Snake,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  clientInputToAction,
  parseRealtimeClientMessage,
  parseRealtimeServerMessage,
  toNetState,
  withRealtimeProtocol,
  type NetState,
} from "../src/protocol/index.js";
import { isFreshAudioEvent } from "../src/game/audio/spatialAudio.js";
import {
  beginStickPointer,
  canUseAbilityPointer,
  endStickPointer,
  makeTwinStickState,
  moveStickPointer,
  releaseAllTouchInput,
  touchAxesForState,
  touchLayoutForFlightSide,
  touchNeedsLandscape,
} from "../src/game/game/mobileControls.js";
import { LocalPredictor } from "../src/game/game/prediction.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(path, import.meta.url));

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

function welcomeState(state: RoomState, youId: string): NetState {
  const parsed = parseRealtimeServerMessage(withRealtimeProtocol({
    t: "welcome",
    youId,
    roomId: state.id,
    state: toNetState(state),
  }));
  if (!parsed.ok || parsed.message.t !== "welcome") throw new Error("welcome fixture did not validate");
  return parsed.message.state;
}

describe("ST-129 full-3D authority acceptance wall", () => {
  it("keeps the authoritative XYZ action stream deterministic through Frenzy, Apex, result and round reset", () => {
    const state = createRoom({ id: "st-129-authority", seed: "st-129-full-3d-authority" });
    const act = (action: Action) => applyAction(state, action);

    act({ type: "join", playerId: "pilot", name: "Pilot", skin: "cyan" });
    act({ type: "setOrientation", playerId: "pilot", yaw: 0.65, pitch: 0.28 });
    act({ type: "setBoost", playerId: "pilot", on: true });

    let sawFrenzy = false;
    let sawApex = false;
    let sawResult = false;
    const firstRoundResetTick = state.round.resultEndTick;

    while (state.tick < firstRoundResetTick) {
      if (state.tick === 200) act({ type: "setOrientation", playerId: "pilot", yaw: -1.15, pitch: -0.32 });
      if (state.tick === 400) act({ type: "setBoost", playerId: "pilot", on: true });
      if (state.tick === 600) act({ type: "bite", playerId: "pilot" });
      step(state);
      sawFrenzy ||= isFrenzy(state);
      sawApex ||= state.round.phase === "apex";
      sawResult ||= state.round.phase === "result";
    }

    expect(sawFrenzy).toBe(true);
    expect(sawApex).toBe(true);
    expect(sawResult).toBe(true);
    expect(state.round).toMatchObject({ number: 2, phase: "active", startTick: firstRoundResetTick });
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(toNetState(state).schemaVersion).toBe(11);
    expect(Object.values(state.snakes).every((shark) =>
      shark.path.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))
      && Number.isFinite(shark.yaw)
      && Number.isFinite(shark.pitch)
    )).toBe(true);
    expect(state.food.every((prey) =>
      Number.isFinite(prey.x) && Number.isFinite(prey.y) && Number.isFinite(prey.z)
    )).toBe(true);
  });

  it("keeps prey, burst, bite, scoring, death, respawn and boundary death server-owned and deterministic", () => {
    const run = () => {
      const state = createRoom({ id: "st-129-core", seed: "st-129-core" });
      const attacker = join(state, "attacker");
      attacker.invulnTick = 0;
      place(attacker, 0, 0, 0);

      const prey: Prey = {
        id: "fixture-prey",
        kind: "carcass",
        x: 0,
        y: 0,
        z: 0,
        value: 5,
        r: 8,
        yaw: 0,
        pitch: 0,
        school: -1,
      };
      state.food = [prey];
      const scoreBeforePrey = attacker.score;
      step(state);
      expect(attacker.score).toBeGreaterThan(scoreBeforePrey);
      expect(state.food.some((item) => item.id === prey.id)).toBe(false);

      applyAction(state, { type: "setBoost", playerId: attacker.id, on: true });
      expect(attacker.lungeTicks).toBeGreaterThan(0);
      expect(attacker.dashCooldownTick).toBeGreaterThan(state.tick);

      const victim = join(state, "victim");
      place(attacker, 0, 0, 0, 0, 0);
      place(victim, 2, 0, 0, 0, 0);
      attacker.invulnTick = 0;
      attacker.biteCooldownTick = 0;
      victim.invulnTick = 0;
      victim.health = 1;
      const scoreBeforeKill = attacker.score;

      applyAction(state, { type: "bite", playerId: attacker.id });
      expect(victim.alive).toBe(false);
      expect(victim.lastDeath).toMatchObject({ killerId: attacker.id, victimId: victim.id, action: "bite" });
      expect(attacker.score).toBeGreaterThan(scoreBeforeKill);
      expect(victim.respawnTick).toBeGreaterThan(state.tick);
      expect(state.food.some((item) => item.kind === "carcass")).toBe(true);

      const respawnTick = victim.respawnTick;
      while (state.tick < respawnTick) step(state);
      applyAction(state, { type: "respawn", playerId: victim.id });
      const respawned = state.snakes[victim.id];
      expect(respawned.alive).toBe(true);
      expect(respawned.health).toBe(COMBAT.maxHealth);
      expect(respawned.segments[0]).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      });

      const boundary = join(state, "boundary");
      boundary.invulnTick = 0;
      place(boundary, state.ocean.radius - 0.1, 0, 0, 0, 0);
      step(state);
      expect(boundary.alive).toBe(false);
      expect(boundary.lastDeath?.action).toBe("boundary");

      return JSON.stringify({
        tick: state.tick,
        attacker: state.snakes.attacker,
        victim: state.snakes.victim,
        boundary: state.snakes.boundary,
        food: state.food,
        rngState: state.rngState,
      });
    };

    expect(run()).toBe(run());
  });

  it("rejects malformed or stale 3D input and binds accepted intent to the server session identity", () => {
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);

    for (const action of [
      { type: "setOrientation", yaw: Number.NaN, pitch: 0 },
      { type: "setOrientation", yaw: 0, pitch: Number.POSITIVE_INFINITY },
      { type: "setOrientation", yaw: 0 },
      { type: "setOrientation", yaw: "0", pitch: 0 },
    ]) {
      expect(parseRealtimeClientMessage({
        v: REALTIME_PROTOCOL_VERSION,
        t: "input",
        action,
      })).toEqual({ ok: false, reason: "malformed" });
    }

    expect(parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION - 1,
      t: "input",
      action: { type: "bite" },
    })).toEqual({ ok: false, reason: "stale-schema" });

    const parsed = parseRealtimeClientMessage({
      v: REALTIME_PROTOCOL_VERSION,
      t: "input",
      action: {
        type: "setOrientation",
        yaw: Math.PI * 5,
        pitch: 99,
        playerId: "spoofed-player",
        x: 999,
        y: 999,
        z: 999,
      },
    });
    if (!parsed.ok || parsed.message.t !== "input") throw new Error("valid orientation fixture failed");
    expect(clientInputToAction(parsed.message.action, "server-session")).toEqual({
      type: "setOrientation",
      playerId: "server-session",
      yaw: expect.any(Number),
      pitch: expect.any(Number),
    });

    const state = toNetState(createRoom({ seed: "stale-server" }));
    expect(parseRealtimeServerMessage({ t: "state", v: REALTIME_PROTOCOL_VERSION - 1, state }))
      .toEqual({ ok: false, reason: "stale-schema" });
  });

  it("reconciles local XYZ prediction to authoritative orientation and hard server corrections", () => {
    const state = createRoom({ id: "prediction", seed: "prediction" });
    const shark = join(state, "pilot");
    place(shark, 0, 0, 0, 0, 0);
    const auth = toNetState(state).snakes.find((item) => item.id === shark.id);
    if (!auth) throw new Error("missing authoritative shark");

    const predictor = new LocalPredictor();
    const input = {
      targetYaw: 0.8,
      targetPitch: 0.35,
      boosting: false,
      cameraLookYaw: 0,
      cameraLookPitch: 0,
    };
    const world = {
      seabedY: state.ocean.seabedY,
      surfaceY: state.ocean.surfaceY,
      tick: state.tick,
      frenzyUntilTick: state.frenzyUntilTick,
    };

    const seeded = predictor.step(auth, input, 1 / 60, 0, world);
    expect(seeded).not.toBeNull();
    const predicted = predictor.step(auth, input, 1 / 30, 0.1, world);
    expect(predicted).not.toBeNull();
    expect(predicted!.head.y).not.toBe(auth.segments[0].y);

    const corrected = {
      ...auth,
      yaw: -1.2,
      pitch: -0.25,
      segments: auth.segments.map((point) => ({
        x: point.x + 20,
        y: point.y + 6,
        z: point.z - 14,
      })),
    };
    const snapped = predictor.step(corrected, input, 1 / 60, 0, world);
    expect(snapped).not.toBeNull();
    expect(snapped!.head).toEqual(corrected.segments[0]);
    expect(snapped!.yaw).toBe(corrected.yaw);
    expect(snapped!.pitch).toBe(corrected.pitch);
  });

  it("welcomes authoritative active, death, respawn, Frenzy, Apex, result and late-join state from live memory", () => {
    const state = createRoom({ id: "reconnect-room", seed: "reconnect-room" });
    const pilot = join(state, "pilot");

    expect(welcomeState(state, pilot.id)).toMatchObject({
      schemaVersion: 11,
      tick: state.tick,
      round: { phase: "active" },
    });

    pilot.invulnTick = 0;
    place(pilot, state.ocean.radius - 0.1, 0, 0, 0, 0);
    step(state);
    expect(pilot.alive).toBe(false);
    expect(welcomeState(state, pilot.id).snakes.find((item) => item.id === pilot.id)?.alive).toBe(false);

    const respawnTick = pilot.respawnTick;
    while (state.tick < respawnTick) step(state);
    applyAction(state, { type: "respawn", playerId: pilot.id });
    expect(welcomeState(state, pilot.id).snakes.find((item) => item.id === pilot.id)?.alive).toBe(true);

    while (state.tick < FRENZY_RULES.periodTicks) step(state);
    expect(isFrenzy(state)).toBe(true);
    const frenzyWelcome = welcomeState(state, pilot.id);
    expect(frenzyWelcome.frenzyUntilTick).toBe(state.frenzyUntilTick);
    expect(frenzyWelcome.frenzyUntilTick).toBeGreaterThan(frenzyWelcome.tick);

    while (state.tick < state.round.apexStartTick) step(state);
    expect(state.round.phase).toBe("apex");
    expect(welcomeState(state, pilot.id).round).toEqual(toNetState(state).round);

    while (state.tick < state.round.endTick) step(state);
    expect(state.round.phase).toBe("result");
    applyAction(state, { type: "join", playerId: "late", name: "Late" });
    expect(state.snakes.late.alive).toBe(false);
    const resultWelcome = welcomeState(state, "late");
    expect(resultWelcome.round.phase).toBe("result");
    expect(resultWelcome.snakes.find((item) => item.id === "late")?.alive).toBe(false);

    const resetTick = state.round.resultEndTick;
    while (state.tick < resetTick) step(state);
    expect(state.round).toMatchObject({ number: 2, phase: "active" });
    expect(state.snakes.late.alive).toBe(true);
    expect(welcomeState(state, "late").round.phase).toBe("active");
  });

  it("resets reconnect interpolation and transient audio boundaries instead of mixing old and recovered timelines", () => {
    const socketSource = read("../src/game/net/useRoomSocket.ts");
    const audioSource = read("../src/game/audio/useGameAudio.ts");
    const roomSource = read("../src/worker/room-do.ts");

    expect(socketSource).toContain("Auto-reconnects with backoff.");
    expect(socketSource).toContain("bufferRef.current = [];");
    expect(socketSource).toContain("timelineOriginRef.current = null;");
    expect(socketSource).toContain("setDeath(null);");
    expect(socketSource).toContain("if (buf.length && state.tick < buf[buf.length - 1].state.tick)");
    expect(socketSource).toContain('setStatus("incompatible")');
    expect(socketSource).toContain("connectionAfterClose(event.code, event.reason, failedAttempts)");
    expect(socketSource).toContain('setTimeout(() => connect(transition.status === "full"), transition.retryInMs)');

    expect(audioSource).toContain("lastTick.current = null;");
    expect(audioSource).toContain("lastFood.current.clear();");
    expect(audioSource).toContain("seenExplosions.current.clear();");
    expect(audioSource).toContain("isFreshAudioEvent(burst.tick, state.tick)");
    expect(isFreshAudioEvent(100, 103, 4)).toBe(true);
    expect(isFreshAudioEvent(100, 105, 4)).toBe(false);
    expect(isFreshAudioEvent(110, 105, 4)).toBe(false);

    expect(roomSource).toContain("this.ctx.storage.deleteAll()");
    expect(roomSource).toContain("server.accept()");
    expect(roomSource).toContain('server.addEventListener("message"');
    expect(roomSource).not.toContain("this.ctx.getWebSockets()");
    expect(roomSource).not.toContain("serializeAttachment");
    expect(roomSource).not.toContain("deserializeAttachment");
    expect(roomSource).not.toContain("this.persist()");
    expect(roomSource).not.toContain("storage.get");
    expect(roomSource).not.toContain("storage.put");
    expect(exists("../src/worker/room-state-schema.ts")).toBe(false);
  });

  it("keeps simultaneous twin sticks plus ability input independent across cancellation and mirrored layouts", () => {
    const touch = makeTwinStickState();
    expect(beginStickPointer(touch, "flight", 101)).toBe(true);
    expect(beginStickPointer(touch, "look", 202)).toBe(true);
    expect(canUseAbilityPointer(touch, 101)).toBe(false);
    expect(canUseAbilityPointer(touch, 202)).toBe(false);
    expect(canUseAbilityPointer(touch, 303)).toBe(true);

    expect(moveStickPointer(touch, "flight", 101, 50, -35)).not.toBeNull();
    expect(moveStickPointer(touch, "look", 202, -40, 25)).not.toBeNull();
    const axes = touchAxesForState(touch);
    expect(axes.yaw).toBeGreaterThan(0);
    expect(axes.pitch).toBeGreaterThan(0);
    expect(axes.lookYaw).toBeLessThan(0);
    expect(axes.lookPitch).toBeGreaterThan(0);

    expect(endStickPointer(touch, "flight", 101)).toBe(true);
    expect(touch.look.pointerId).toBe(202);
    releaseAllTouchInput(touch);
    expect(touch).toEqual({
      flight: { pointerId: null, x: 0, y: 0 },
      look: { pointerId: null, x: 0, y: 0 },
    });

    expect(touchLayoutForFlightSide("left")).toEqual({ flight: "left", look: "right", actions: "right" });
    expect(touchLayoutForFlightSide("right")).toEqual({ flight: "right", look: "left", actions: "left" });
    expect(touchNeedsLandscape(844, 390)).toBe(false);
    expect(touchNeedsLandscape(390, 844)).toBe(true);

    const controls = read("../src/game/ui/TouchControls.tsx");
    const screen = read("../src/game/ui/GameScreen.tsx");
    const css = read("../src/game/ui/theme.css");
    expect(controls).toContain("setPointerCapture(e.pointerId)");
    expect(controls).toContain("onPointerCancel={end}");
    expect(controls).toContain("onLostPointerCapture={end}");
    expect(controls).toContain('window.addEventListener("orientationchange", release)');
    expect(screen).toContain("canUseAbilityPointer(touchInputRef.current, e.pointerId)");
    expect(screen).toContain("onPointerCancel={pointerEnd}");
    expect(screen).toContain("onLostPointerCapture={pointerEnd}");
    for (const inset of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`env(safe-area-inset-${inset}`);
    }
  });

  it("smoke-proves the live client remains R3F/WebGL-only without claiming jsdom renders WebGL", () => {
    const gameScreen = read("../src/game/ui/GameScreen.tsx");
    const viewport = read("../src/game/game/GameViewport.tsx");
    const scene = read("../src/game/game/Scene.tsx");
    const accessibility = read("../docs/ACCESSIBILITY.md");

    expect(gameScreen).toContain("<GameViewport");
    expect(viewport).toContain('import { Canvas } from "@react-three/fiber";');
    expect(viewport).toContain("<Canvas");
    expect(viewport).toContain("<Scene");
    expect(scene).toContain("<WorldEnvironment");
    expect(scene).toContain("<ActorLayer");
    expect(scene).toContain("<PreyLayer");
    expect(scene).toContain("<FxLayer");
    expect(exists("../src/game/game/GameCanvas.tsx")).toBe(false);
    expect(viewport).not.toContain('getContext("2d"');
    expect(gameScreen).not.toContain('getContext("2d"');
    expect(accessibility).toContain("does not currently include a real-browser automation harness");
    expect(accessibility).toContain("simultaneous dual-stick plus ability pointers on hardware");
  });
});
