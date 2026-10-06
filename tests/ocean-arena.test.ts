import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_LANDMARKS,
  makeEnvironmentSeeds,
  resolveOceanArenaCues,
  resolveOceanEnvironmentQuality,
} from "../src/game/game/oceanArena.js";
import { OCEAN_CUES, resolveSceneQuality } from "../src/game/game/sceneMath.js";
import {
  DEFAULT_SEABED_Y,
  DEFAULT_SURFACE_Y,
  ROOM_SCHEMA_VERSION,
} from "../src/engine/room.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-118 stylized ocean arena", () => {
  it("derives presentation volume and warning geometry from authoritative ocean values", () => {
    const cues = resolveOceanArenaCues({ arenaRadius: 82, seabedY: -18, surfaceY: 14 });
    expect(cues.radius).toBe(82);
    expect(cues.seabedY).toBe(-18);
    expect(cues.surfaceY).toBe(14);
    expect(cues.height).toBe(32);
    expect(cues.midY).toBe(-2);
    expect(cues.boundaryWarningRadius).toBeLessThan(cues.radius);
    expect(cues.frenzyRadius).toBeCloseTo(cues.radius * 0.3);
    expect(OCEAN_CUES.horizontalRadius).toBe(82);
    expect(DEFAULT_SEABED_Y).toBe(-12);
    expect(DEFAULT_SURFACE_Y).toBe(12);
  });

  it("quality presets scale only optional environment cost while preserving the world", () => {
    const low = resolveOceanEnvironmentQuality("low");
    const medium = resolveOceanEnvironmentQuality("medium");
    const high = resolveOceanEnvironmentQuality("high");
    expect(low.particulateBudget).toBeLessThan(medium.particulateBudget);
    expect(medium.particulateBudget).toBeLessThan(high.particulateBudget);
    expect(low.bubbleBudget).toBeLessThan(high.bubbleBudget);
    expect(low.lightShaftCount).toBeGreaterThan(0);
    expect(low.causticBands).toBeGreaterThan(0);
    expect(high.particulateBudget).toBeLessThanOrEqual(256);
  });

  it("keeps deterministic environment particles bounded and allocation counts explicit", () => {
    const first = makeEnvironmentSeeds(36, 118);
    const second = makeEnvironmentSeeds(36, 118);
    expect(first).toEqual(second);
    expect(first).toHaveLength(36);
    for (const particle of first) {
      expect(particle.radialShare).toBeGreaterThanOrEqual(0);
      expect(particle.radialShare).toBeLessThan(0.9);
      expect(particle.depthShare).toBeGreaterThan(0);
      expect(particle.depthShare).toBeLessThan(1);
      expect(particle.speed).toBeGreaterThan(0);
    }
    expect(makeEnvironmentSeeds(9999)).toHaveLength(256);
  });

  it("includes reef, wreck, and Feeding Frenzy landmark categories without changing game rules", () => {
    expect(ENVIRONMENT_LANDMARKS.some((landmark) => landmark.kind === "reef")).toBe(true);
    expect(ENVIRONMENT_LANDMARKS.some((landmark) => landmark.kind === "wreck")).toBe(true);
    expect(ENVIRONMENT_LANDMARKS.some((landmark) => landmark.kind === "frenzy")).toBe(true);
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
  });

  it("reads live arena/frenzy authority and keeps the procedural environment client-only", () => {
    const scene = read("../src/game/game/Scene.tsx");
    const world = read("../src/game/game/WorldEnvironment.tsx");
    const worker = read("../src/worker/index.ts");

    expect(scene).toContain("<WorldEnvironment socket={socket} settings={settings}");
    expect(world).toContain("socket.stateRef.current");
    expect(world).toContain("state?.arenaRadius");
    expect(world).toContain("state?.seabedY");
    expect(world).toContain("state?.surfaceY");
    expect(world).toContain("state.frenzyUntilTick > state.tick");
    expect(world).toContain("reefBaseRef");
    expect(world).toContain("<instancedMesh ref={reefBaseRef}");
    expect(world).toContain("<WreckLandmark");
    expect(world).toContain("particulateBudget");
    expect(world).toContain("bubbleBudget");
    expect(world).not.toContain("http://");
    expect(world).not.toContain("https://");
    expect(world).not.toContain("fetch(");
    expect(world).not.toContain("setOrientation(");
    expect(world).not.toContain("setBoost(");
    expect(worker).not.toContain("@react-three/fiber");
    expect(worker).not.toContain('from "three"');
  });
});

it("ST-241 fog hides the prey visibility boundary at every quality", () => {
  for (const quality of ["low", "medium", "high"] as const) {
    const fog = resolveSceneQuality(quality);
    expect(fog.fogFar).toBeLessThanOrEqual(70);
    expect(fog.fogNear).toBeLessThan(fog.fogFar);
  }
});
