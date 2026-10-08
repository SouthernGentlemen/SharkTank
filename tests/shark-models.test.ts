import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOM_SCHEMA_VERSION } from "../src/engine/room.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";
import {
  resolveSharkAnimation,
  resolveSharkPresentationQuality,
} from "../src/game/game/sharkPresentation.js";

import { sharkScaleForLength, mouthPoint, bodySegment } from "../src/engine/sharkGeometry.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-119 animated shark models", () => {
  it("replaces the single stretched actor primitive with a recognizable composed shark silhouette", () => {
    const actors = read("../src/game/game/ActorLayer.tsx");
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
      expect(actors).toContain(`ref={${refName}}`);
    }
    expect(actors).not.toContain("const sharkMesh =");
    expect(actors).not.toContain("dummy.scale.set(sharkScale * 1.75");
  });

  it("keeps local prediction, remote interpolation, orientation bank and authoritative length scaling", () => {
    const actors = read("../src/game/game/ActorLayer.tsx");
    expect(actors).toContain("LocalPredictor");
    expect(actors).toContain("frameAt(REMOTE_INTERP_DELAY_MS)");
    expect(actors).toContain("interpolateOrientedPose(");
    expect(actors).toContain("root.rotation.set(motion.roll, -yaw, pitch)");
    expect(actors).toContain("sharkScaleForLength(shark.length)");
    expect(sharkScaleForLength(64)).toBeCloseTo(Math.min(2.5, 0.32 + Math.sqrt(64) * 0.2));
  });

  it("derives deterministic swim animation from continuous seconds, speed, boost and pitch state", () => {
    const base = {
      seconds: 42 / 20,
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
    let last = cruise;
    for (let frame = 1; frame <= 60; frame += 1) {
      const next = resolveSharkAnimation({ ...base, seconds: base.seconds + frame / 60 });
      expect(next).not.toEqual(last);
      last = next;
    }
    expect(read("../src/game/game/ActorLayer.tsx")).toContain("seconds: clock.elapsedTime");
    expect(boosted.intensity).toBeGreaterThan(cruise.intensity);
    expect(Math.abs(boosted.tailYaw)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(boosted.pectoralSweep)).toBeLessThanOrEqual(0.22);
  });

  it("keeps reduced motion playable by suppressing decorative flex while bank remains an orientation cue", () => {
    const reduced = resolveSharkAnimation({
      seconds: 42 / 20,
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

    const sceneMath = read("../src/game/game/sceneMath.ts");
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

    const actors = read("../src/game/game/ActorLayer.tsx");
    expect(actors).toContain("<coneGeometry args={[1, 1, 3]} />");
    expect(actors).toContain("resolveSharkPresentationQuality(settings.graphics.quality)");
  });

  it("keeps shark presentation browser-only with protocol, persistence and package identities unchanged", () => {
    const worker = read("../src/worker/index.ts");
    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    const actors = read("../src/game/game/ActorLayer.tsx");

    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    expect(packageJson.version).toBe("2.4.0");
    expect(worker).not.toContain("sharkPresentation");
    expect(worker).not.toContain("@react-three/fiber");
    expect(worker).not.toContain('from "three"');
    expect(actors).not.toContain("http://");
    expect(actors).not.toContain("https://");
    expect(actors).not.toContain("fetch(");
  });
});


describe("shared shark geometry", () => {
  it("keeps geometry server-safe and shares rest landmarks with renderer and camera", () => {
    const geometry = read("../src/engine/sharkGeometry.ts");
    expect(geometry).not.toMatch(/three|document|window|react|src\/game/);
    const actors = read("../src/game/game/ActorLayer.tsx");
    expect(actors).toContain("SHARK_GEOMETRY.snoutTip - SHARK_GEOMETRY.snoutRadius");
    expect(actors).toContain("SHARK_GEOMETRY.tail");
    expect(read("../src/game/game/sceneMath.ts")).toContain("SHARK_GEOMETRY.mouth * size");
  });
  it("preserves the full size curve including invalid lengths and the cap", () => {
    for (const length of [-1, 0, 1, 12, 64, 220, 1000, NaN, Infinity]) {
      const safe = Number.isFinite(length) ? Math.max(0, length) : 0;
      expect(sharkScaleForLength(length)).toBe(Math.min(2.5, 0.32 + Math.sqrt(safe) * 0.2));
    }
  });
  it("places mouth and body endpoints along yaw and pitch without mutating the pose", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const pitch of [-0.7, 0, 0.7]) {
        const shark = { position: { x: 4, y: 2, z: -3 }, yaw, pitch, length: 64 };
        const before = structuredClone(shark);
        const scale = sharkScaleForLength(shark.length);
        const segment = bodySegment(shark);
        for (const [point, offset] of [[mouthPoint(shark), 1.9], [segment.start, 2.56], [segment.end, -2.45]] as const) {
          expect(point.x).toBeCloseTo(4 + Math.cos(yaw) * Math.cos(pitch) * offset * scale);
          expect(point.y).toBeCloseTo(2 + Math.sin(pitch) * offset * scale);
          expect(point.z).toBeCloseTo(-3 + Math.sin(yaw) * Math.cos(pitch) * offset * scale);
        }
        expect(shark).toEqual(before);
      }
    }
  });
});
