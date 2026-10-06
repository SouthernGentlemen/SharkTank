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
  type Shark,
} from "../src/engine/index.js";
import {
  REALTIME_PROTOCOL_VERSION,
  STATE_BROADCAST_EVERY,
  toNetState,
  withRealtimeProtocol,
} from "../src/protocol/index.js";
import {
  cadenceDue,
  resolveClientPerformanceProfile,
  resolveRenderDpr,
} from "../src/game/game/performance.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: ReturnType<typeof createRoom>, id: string): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot: true });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
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
  state.food = Array.from({ length: PREY_BUDGET.max }, (_, index) => ({
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
  state.sharks = {};
  for (let index = 0; index < 32; index += 1) {
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

    const viewport = read("../src/game/game/GameViewport.tsx");
    expect(viewport).toContain("<Canvas");
    expect(viewport).toContain("resolveRenderDpr");
    expect(viewport).not.toContain("CanvasRenderingContext2D");
    expect(viewport).not.toContain("getContext(\"2d\")");
  });

  it("batches repeated environment props and keeps FX limited to burst particles", () => {
    const world = read("../src/game/game/WorldEnvironment.tsx");
    const prey = read("../src/game/game/PreyLayer.tsx");
    const fx = read("../src/game/game/FxLayer.tsx");
    expect(fx.match(/<instancedMesh\b/g)).toHaveLength(1);
    expect(fx).not.toContain("<ringGeometry");
    expect(world).toContain("frenzyVolumeRef");
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
    const measuredBytesPerSecond = snapshotBytes * (TICKS_PER_SECOND / STATE_BROADCAST_EVERY);

    expect(message.state.snakes).toHaveLength(32);
    expect(message.state.food).toHaveLength(PREY_BUDGET.max);
    expect(snapshotBytes).toBeLessThanOrEqual(60_000);
    expect(measuredBytesPerSecond).toBeLessThanOrEqual(600_000);

    const roomDo = read("../src/worker/room-do.ts");
    expect(roomDo).toContain("STATE_BROADCAST_EVERY,");
    expect(STATE_BROADCAST_EVERY).toBe(2);
    expect(TICKS_PER_SECOND / STATE_BROADCAST_EVERY).toBe(10);
    console.info(
      `ST-127 network fixture: ${snapshotBytes} bytes/snapshot × ${TICKS_PER_SECOND / STATE_BROADCAST_EVERY} snapshots/s = ${measuredBytesPerSecond} bytes/s max representative stream`,
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
    const actor = read("../src/game/game/ActorLayer.tsx");
    const prey = read("../src/game/game/PreyLayer.tsx");
    const world = read("../src/game/game/WorldEnvironment.tsx");
    const fx = read("../src/game/game/FxLayer.tsx");
    const audio = read("../src/game/audio/AudioManager.ts");
    const radar = read("../src/game/ui/DepthRadar.tsx");
    const pkg = JSON.parse(read("../package.json")) as { version: string };

    expect(actor).toContain("performanceProfile.labelUpdateMs");
    expect(prey).toContain("performanceProfile.preyUpdateMs");
    expect(world).toContain("performanceProfile.environmentUpdateMs");
    expect(fx).toContain("performanceProfile.effectUpdateMs");
    expect(audio).toContain("this.listenerPose.position.x = position.x");
    expect(radar).toContain("buildDepthNavigation(socket.stateRef.current");
    expect(radar).toContain("setInterval(update, 250)");
    expect(pkg.version).toBe("2.1.0");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
  });
});
