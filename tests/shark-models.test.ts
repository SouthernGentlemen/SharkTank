import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOM_SCHEMA_VERSION } from "../vendor/ModuleReact3Fiber/src/engine/room.js";
import { REALTIME_PROTOCOL_VERSION } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  SHARK_ANATOMY,
  resolveSharkAnimation,
  resolveSharkPresentationQuality,
  sharkScaleForLength,
} from "../vendor/ModuleReact3Fiber/src/client/game/sharkPresentation.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-119 animated shark models", () => {
  it("replaces the single stretched actor primitive with a recognizable composed shark silhouette", () => {
    expect(SHARK_ANATOMY).toEqual([
      "head",
      "snout",
      "body",
      "tailPeduncle",
      "tailFin",
      "dorsalFin",
      "pectoralFins",
    ]);

    const actors = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
    for (const refName of [
      "bodyMesh",
      "headMesh",
      "snoutMesh",
      "peduncleMesh",
      "tailFinMesh",
      "dorsalFinMesh",
      "pectoralLeftMesh",
      "pectoralRightMesh",
    ]) {
      expect(actors).toContain(`const ${refName} = useRef<THREE.InstancedMesh>(null);`);
    }
    expect(actors).not.toContain("const sharkMesh =");
    expect(actors).not.toContain("dummy.scale.set(sharkScale * 1.75");
  });

  it("keeps local prediction, remote interpolation, orientation bank and authoritative length scaling", () => {
    const actors = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
    expect(actors).toContain("LocalPredictor");
    expect(actors).toContain("frameAt(INTERP_DELAY_MS)");
    expect(actors).toContain("interpolateOrientedPose(");
    expect(actors).toContain("root.rotation.set(motion.roll, -yaw, pitch)");
    expect(actors).toContain("sharkScaleForLength(shark.length)");
    expect(sharkScaleForLength(64)).toBeCloseTo(Math.min(2.5, 0.72 + Math.sqrt(64) * 0.12));
  });

  it("derives deterministic swim animation from existing tick, speed, boost and pitch state", () => {
    const base = {
      tick: 42,
      actorId: "shark-alpha",
      speed: 11,
      baseSpeed: 11,
      boostSpeed: 28,
      boosting: false,
      pitch: 0.3,
      reducedMotion: false,
    };
    const cruise = resolveSharkAnimation(base);
    const cruiseAgain = resolveSharkAnimation(base);
    const boosted = resolveSharkAnimation({
      ...base,
      speed: 28,
      boosting: true,
    });
    expect(cruiseAgain).toEqual(cruise);
    expect(boosted.intensity).toBeGreaterThan(cruise.intensity);
    expect(Math.abs(boosted.tailYaw)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(boosted.pectoralSweep)).toBeLessThanOrEqual(0.22);
  });

  it("keeps reduced motion playable by suppressing decorative flex while bank remains an orientation cue", () => {
    const reduced = resolveSharkAnimation({
      tick: 42,
      actorId: "shark-alpha",
      speed: 28,
      baseSpeed: 11,
      boostSpeed: 28,
      boosting: true,
      pitch: 0.5,
      reducedMotion: true,
    });
    expect(reduced).toEqual({
      bodyYaw: 0,
      peduncleYaw: 0,
      tailYaw: 0,
      pectoralSweep: 0,
      intensity: 0,
    });

    const sceneMath = read("../vendor/ModuleReact3Fiber/src/client/game/sceneMath.ts");
    expect(sceneMath).toContain("const maxBank = reducedMotion ? 0.24 : 0.42");
    expect(sceneMath).not.toContain("if (reducedMotion) return 0;");
  });

  it("scales optional geometry detail without removing the essential shark anatomy", () => {
    const low = resolveSharkPresentationQuality("low");
    const medium = resolveSharkPresentationQuality("medium");
    const high = resolveSharkPresentationQuality("high");
    expect(low.radialSegments).toBeLessThan(medium.radialSegments);
    expect(medium.radialSegments).toBeLessThan(high.radialSegments);
    expect(low.radialSegments).toBeGreaterThanOrEqual(6);

    const actors = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
    expect(actors).toContain("<coneGeometry args={[1, 1, 3]} />");
    expect(actors).toContain("resolveSharkPresentationQuality(settings.graphics.quality)");
  });

  it("keeps shark presentation browser-only with protocol, persistence and package identities unchanged", () => {
    const worker = read("../src/worker/index.ts");
    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    const actors = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");

    expect(ROOM_SCHEMA_VERSION).toBe(8);
    expect(REALTIME_PROTOCOL_VERSION).toBe(8);
    expect(packageJson.version).toBe("2.0.0");
    expect(worker).not.toContain("sharkPresentation");
    expect(worker).not.toContain("@react-three/fiber");
    expect(worker).not.toContain('from "three"');
    expect(actors).not.toContain("http://");
    expect(actors).not.toContain("https://");
    expect(actors).not.toContain("fetch(");
  });
});
