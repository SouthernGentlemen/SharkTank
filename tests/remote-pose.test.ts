import { describe, expect, it } from "vitest";
import { RemotePose } from "../src/game/game/remotePose.js";
import { forwardFromYawPitch } from "../src/game/game/sceneMath.js";
import { swimSpeedForLungeTicks, TICKS_PER_SECOND } from "../src/engine/index.js";

const pose = (x = 0) => ({ x, y: 0, z: 0, yaw: 0, pitch: 0 });
describe("remote actor poses", () => {
  it.each([0, 3])("moves a pitched shark at dash-derived speed for only 120 ms (lunge %s)", lunge => {
    const remote = new RemotePose();
    const direction = forwardFromYawPitch(Math.PI / 4, Math.PI / 6);
    const speed = swimSpeedForLungeTicks(lunge) * TICKS_PER_SECOND;
    const velocity = { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed };
    for (let ms = 0; ms <= 200; ms += 10) {
      const out = pose();
      remote.sample(out, velocity, ms, 20, ms);
      expect(out.x).toBeCloseTo(velocity.x * Math.min(ms, 120) / 1000);
      expect(out.y).toBeCloseTo(velocity.y * Math.min(ms, 120) / 1000);
      expect(out.z).toBeCloseTo(velocity.z * Math.min(ms, 120) / 1000);
    }
  });
  it("holds prey after 120 ms and blends a corrected snapshot without a backwards jump", () => {
    const remote = new RemotePose();
    const velocity = { x: 10, y: 2, z: -3 };
    const held = pose();
    remote.sample(held, velocity, 200, 20, 200);
    const recovered = pose(0.8);
    remote.sample(recovered, velocity, 0, 24, 201);
    expect(recovered.x).toBe(held.x);
    expect(recovered.y).toBe(held.y);
    for (let ms = 211; ms < 1200; ms += 10) {
      const next = pose(0.8 + (ms - 201) / 100);
      remote.sample(next, velocity, 0, 24, ms);
      expect(next.x).toBeGreaterThanOrEqual(recovered.x);
      expect(next.x - recovered.x).toBeLessThan(0.11);
      Object.assign(recovered, next);
    }
    expect(recovered.x).toBeCloseTo(0.8 + (1191 - 201) / 100, 3);
  });
  it("resets corrections when server ticks regress", () => {
    const remote = new RemotePose();
    remote.sample(pose(), { x: 10, y: 0, z: 0 }, 120, 20, 200);
    remote.sample(pose(0.8), { x: 0, y: 0, z: 0 }, 0, 24, 201);
    const reset = pose(4);
    remote.sample(reset, { x: 0, y: 0, z: 0 }, 0, 0, 210);
    expect(reset.x).toBe(4);
  });
});
