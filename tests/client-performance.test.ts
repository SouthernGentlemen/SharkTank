import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  PREY_BUDGET,
  ROOM_SCHEMA_VERSION,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  normalizeYaw,
  step,
  type Snake,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  toNetState,
  withRealtimeProtocol,
} from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  CLIENT_PERFORMANCE_BUDGETS,
  cadenceDue,
  estimateBaselineSceneRenderCost,
  estimateSceneRenderCost,
  resolveClientPerformanceProfile,
  resolveRenderDpr,
} from "../vendor/ModuleReact3Fiber/src/client/game/performance.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: ReturnType<typeof createRoom>, id: string): Snake {
  applyAction(state, { type: "join", playerId: id, name: id, isBot: true });
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

function populateRepresentativeRoom() {
  const state = createRoom({
    id: "st-127-budget",
    seed: "st-127-budget",
    oceanRadius: 82,
    seabedY: -12,
    surfaceY: 12,
  });
  state.food = Array.from({ length: CLIENT_PERFORMANCE_BUDGETS.maxPrey }, (_, index) => ({
    id: `prey-${index}`,
    kind: index % 9 === 0 ? "reef" as const : "bait" as const,
    x: ((index * 17) % 160) / 1.37 - 58,
    y: ((index * 13) % 220) / 10.7 - 10,
    z: ((index * 19) % 160) / 1.41 - 56,
    value: index % 9 === 0 ? 2 : 1,
    r: index % 9 === 0 ? 0.58 : 0.42,
    yaw: normalizeYaw(index * 0.21731),
    pitch: -0.45 + (index % 18) * 0.05,
    school: index % PREY_BUDGET.schools,
  }));
  state.snakes = {};
  for (let index = 0; index < CLIENT_PERFORMANCE_BUDGETS.maxSharks; index += 1) {
    const shark = join(state, `shark-${index.toString().padStart(2, "0")}`);
    place(shark, index * 1.23 - 18, (index % 20) * 0.91 - 9, index * -1.11 + 17);
    shark.yaw = shark.targetYaw = normalizeYaw(index * 0.379123);
    shark.pitch = shark.targetPitch = Math.max(-0.8, Math.min(0.8, -0.7 + index * 0.043));
    shark.length = 10 + index * 0.731;
    shark.score = index * 11;
  }
  state.explosions = Array.from({ length: 32 }, (_, index) => ({
    id: `burst-${index}`,
    x: index * -0.765,
    y: index * 0.123 - 2,
    z: index * 1.345,
    tick: 0,
    skin: "magenta",
    kind: index % 3 === 0 ? "bite" as const : index % 3 === 1 ? "shark" as const : "frenzy" as const,
  }));
  return state;
}

describe("ST-127 3D client performance contracts", () => {
  it("caps DPR and presentation cadence deterministically by quality without a renderer fallback", () => {
    const low = resolveClientPerformanceProfile("low");
    const medium = resolveClientPerformanceProfile("medium");
    const high = resolveClientPerformanceProfile("high");

    expect(low.preyUpdateHz).toBe(30);
    expect(low.environmentUpdateHz).toBeLessThan(medium.environmentUpdateHz);
    expect(medium.environmentUpdateHz).toBeLessThan(high.environmentUpdateHz);
    expect(low.labelUpdateHz).toBeLessThan(high.labelUpdateHz);
    expect(resolveRenderDpr("low", true, 3)).toBe(1);
    expect(resolveRenderDpr("medium", true, 3)).toBe(1.25);
    expect(resolveRenderDpr("high", true, 3)).toBe(1.5);
    expect(resolveRenderDpr("high", false, 3)).toBe(2);
    expect(cadenceDue(-Infinity, 0, low.preyUpdateMs)).toBe(true);
    expect(cadenceDue(0, low.preyUpdateMs / 2, low.preyUpdateMs)).toBe(false);
    expect(cadenceDue(0, low.preyUpdateMs, low.preyUpdateMs)).toBe(true);

    const viewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");
    expect(viewport).toContain("<Canvas");
    expect(viewport).toContain("resolveRenderDpr");
    expect(viewport).not.toContain("CanvasRenderingContext2D");
    expect(viewport).not.toContain("getContext(\"2d\")");
  });

  it("reduces the maximum scene mesh/material inventory by batching repeated environment props", () => {
    const baselineHigh = estimateBaselineSceneRenderCost("high");
    const hardenedHigh = estimateSceneRenderCost("high");
    expect(baselineHigh).toEqual({ drawCalls: 74, geometries: 74, materials: 74 });
    expect(hardenedHigh).toEqual({ drawCalls: 55, geometries: 55, materials: 55 });
    expect(hardenedHigh.drawCalls).toBeLessThan(baselineHigh.drawCalls);

    for (const quality of ["low", "medium", "high"] as const) {
      const before = estimateBaselineSceneRenderCost(quality);
      const after = estimateSceneRenderCost(quality);
      expect(after.drawCalls).toBeLessThan(before.drawCalls);
      expect(after.geometries).toBe(after.drawCalls);
      expect(after.materials).toBe(after.drawCalls);
    }

    const world = read("../vendor/ModuleReact3Fiber/src/client/game/WorldEnvironment.tsx");
    const prey = read("../vendor/ModuleReact3Fiber/src/client/game/PreyLayer.tsx");
    expect(world).toContain("boundaryMarkerRef");
    expect(world).toContain("reefBaseRef");
    expect(world).toContain("lightShaftRef");
    expect(world).not.toContain("castShadow");
    expect(prey).toContain("THREE.InstancedMesh");
    expect(prey).toContain("PREY_BUDGET.max");
  });

  it("keeps full authoritative actor counts while measuring snapshot bytes and message rate", () => {
    const state = populateRepresentativeRoom();
    const message = withRealtimeProtocol({ t: "state" as const, state: toNetState(state) });
    const snapshotBytes = bytes(message);
    const measuredBytesPerSecond = snapshotBytes * CLIENT_PERFORMANCE_BUDGETS.networkSnapshotHz;

    expect(message.state.snakes).toHaveLength(CLIENT_PERFORMANCE_BUDGETS.maxSharks);
    expect(message.state.food).toHaveLength(CLIENT_PERFORMANCE_BUDGETS.maxPrey);
    expect(snapshotBytes).toBeLessThanOrEqual(CLIENT_PERFORMANCE_BUDGETS.maxSnapshotBytes);
    expect(measuredBytesPerSecond).toBeLessThanOrEqual(CLIENT_PERFORMANCE_BUDGETS.maxSnapshotBytesPerSecond);

    const roomDo = read("../src/worker/room-do.ts");
    expect(roomDo).toContain("STATE_BROADCAST_EVERY = 2");
    expect(CLIENT_PERFORMANCE_BUDGETS.networkSnapshotHz).toBe(10);
    console.info(
      `ST-127 network fixture: ${snapshotBytes} bytes/snapshot × ${CLIENT_PERFORMANCE_BUDGETS.networkSnapshotHz} snapshots/s = ${measuredBytesPerSecond} bytes/s max representative stream`,
    );
  });

  it("records representative deterministic room and transform fixture cost without brittle timing gates", () => {
    const state = populateRepresentativeRoom();
    const startTick = state.tick;
    const roomStarted = performance.now();
    for (let index = 0; index < TICKS_PER_SECOND; index += 1) step(state);
    const roomElapsed = performance.now() - roomStarted;
    expect(state.tick).toBe(startTick + TICKS_PER_SECOND);
    expect(state.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);

    const object = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    let checksum = 0;
    const transformStarted = performance.now();
    for (let frame = 0; frame < 60; frame += 1) {
      for (let actor = 0; actor < 32; actor += 1) {
        object.position.set(actor * 0.3, (actor % 8) * 0.2, -actor * 0.25);
        object.rotation.set(frame * 0.001, actor * 0.01, frame * 0.002);
        object.updateMatrix();
        matrix.copy(object.matrix);
        checksum += matrix.elements[12];
      }
      for (let prey = 0; prey < PREY_BUDGET.max; prey += 1) {
        object.position.set(prey * 0.01, (prey % 20) * 0.03, -prey * 0.008);
        object.updateMatrix();
        checksum += object.matrix.elements[13];
      }
    }
    const transformElapsed = performance.now() - transformStarted;
    expect(Number.isFinite(checksum)).toBe(true);
    console.info(
      `ST-127 CPU fixtures (informational, not FPS gates): 1s deterministic room=${roomElapsed.toFixed(2)}ms; 60×(32 sharks + ${PREY_BUDGET.max} prey) transforms=${transformElapsed.toFixed(2)}ms`,
    );
  });

  it("throttles non-critical presentation work while preserving authority and accessibility boundaries", () => {
    const actor = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
    const prey = read("../vendor/ModuleReact3Fiber/src/client/game/PreyLayer.tsx");
    const world = read("../vendor/ModuleReact3Fiber/src/client/game/WorldEnvironment.tsx");
    const fx = read("../vendor/ModuleReact3Fiber/src/client/game/FxLayer.tsx");
    const audio = read("../vendor/ModuleReact3Fiber/src/client/audio/AudioManager.ts");
    const radar = read("../vendor/ModuleReact3Fiber/src/client/ui/DepthRadar.tsx");
    const plan = read("../implementation_plan.md");
    const pkg = JSON.parse(read("../package.json")) as { version: string };

    expect(actor).toContain("performanceProfile.labelUpdateMs");
    expect(prey).toContain("performanceProfile.preyUpdateMs");
    expect(world).toContain("performanceProfile.environmentUpdateMs");
    expect(fx).toContain("performanceProfile.effectUpdateMs");
    expect(audio).toContain("this.listenerPose.position.x = position.x");
    expect(radar).toContain("buildDepthNavigation(socket.stateRef.current");
    expect(radar).toContain("setInterval(update, 250)");
    expect(pkg.version).toBe("2.0.0");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    expect(plan).not.toContain("### ST-127");
    expect(plan).not.toContain("### ST-128");
    expect(plan).not.toContain("### ST-129");
    expect(plan.indexOf("### ST-130")).toBeGreaterThan(0);
  });
});
