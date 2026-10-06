import { describe, expect, it } from "vitest";
import {
  CAMERA_PROJECTION,
  OCEAN_CUES,
  chaseCameraPose,
  forwardFromYawPitch,
  resolveSceneQuality,
} from "../src/game/game/sceneMath.js";

describe("3D scene skeleton math", () => {
  it("uses X/Z horizontally and Y vertically with yaw + pitch forward math", () => {
    const forward = forwardFromYawPitch(0, 0);
    expect(forward.x).toBeCloseTo(1);
    expect(forward.y).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(0);

    const right = forwardFromYawPitch(Math.PI / 2, 0);
    expect(right.x).toBeCloseTo(0);
    expect(right.y).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(1);

    const climb = forwardFromYawPitch(0, Math.PI / 6);
    expect(climb.y).toBeGreaterThan(0);
  });

  it("keeps the chase camera behind the forward direction with bounded projection planes", () => {
    const pose = chaseCameraPose({ x: 10, y: 2, z: -4 }, 0, 0);
    expect(pose.position.x).toBeLessThan(10);
    expect(pose.position.y).toBeGreaterThan(2);
    expect(pose.lookAt.x).toBeGreaterThan(10);
    expect(CAMERA_PROJECTION.near).toBeGreaterThan(0);
    expect(CAMERA_PROJECTION.far).toBeGreaterThan(CAMERA_PROJECTION.near);
    expect(CAMERA_PROJECTION.far).toBeLessThanOrEqual(300);
  });

  it("keeps surface, seabed and quality profiles presentation-only and ordered", () => {
    expect(OCEAN_CUES.surfaceY).toBeGreaterThan(0);
    expect(OCEAN_CUES.seabedY).toBeLessThan(0);
    const low = resolveSceneQuality("low");
    const high = resolveSceneQuality("high");
    expect(low.dpr[1]).toBeLessThan(high.dpr[1]);
    expect(low.burstParticleBudget).toBeLessThan(high.burstParticleBudget);
    expect(low.fogFar).toBeLessThan(high.fogFar);
  });
});
