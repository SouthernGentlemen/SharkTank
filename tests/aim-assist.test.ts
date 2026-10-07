import { describe, expect, it } from "vitest";
import { AIM_ASSIST, aimAssistEnabled, assistAim } from "../src/game/game/aimAssist.js";
import { forwardFromYawPitch } from "../src/engine/geometry3d.js";

const me = { id: "you", position: { x: 0, y: 0, z: 0 }, length: 15, alive: true };
const heading = { yaw: 0, pitch: 0 };
const position = (yaw: number, pitch = 0, distance = 10) => {
  const f = forwardFromYawPitch(yaw, pitch);
  return { x: f.x * distance, y: f.y * distance, z: f.z * distance };
};
const prey = (yaw: number, pitch = 0, distance = 10) => ({ food: [position(yaw, pitch, distance)], sharks: [] });

describe("gentle aim assist", () => {
  it("defaults to touch and preserves explicit choices", () => {
    expect(aimAssistEnabled(null, true)).toBe(true);
    expect(aimAssistEnabled(null, false)).toBe(false);
    expect(aimAssistEnabled(false, true)).toBe(false);
    expect(aimAssistEnabled(true, false)).toBe(true);
  });
  it("rejects outside-cone, behind, distant, coincident and invalid targets", () => {
    for (const state of [prey(21 * Math.PI / 180), prey(0, 21 * Math.PI / 180), prey(Math.PI), prey(0.1, 0, 14.01), prey(0, 0, 0), { food: [{ x: NaN, y: 0, z: 0 }], sharks: [] }]) {
      expect(assistAim(heading, me, state, 1 / 60, true)).toEqual(heading);
    }
  });
  it("does nothing when disabled, dead or time is invalid", () => {
    expect(assistAim(heading, me, prey(0.2), 0.05, false)).toEqual(heading);
    expect(assistAim(heading, { ...me, alive: false }, prey(0.2), 0.05, true)).toEqual(heading);
    for (const dt of [0, -1, NaN, Infinity]) expect(assistAim(heading, me, prey(0.2), dt, true)).toEqual(heading);
  });
  it("bounds the combined 3D angular step at different frame rates and clamps suspension gaps", () => {
    for (const dt of [1 / 120, 1 / 60, 0.05, 10]) {
      const result = assistAim(heading, me, prey(0.2, 0.15), dt, true);
      const f = forwardFromYawPitch(result.yaw, result.pitch);
      expect(Math.acos(f.x)).toBeCloseTo(AIM_ASSIST.radiansPerSecond * Math.min(dt, 0.05), 8);
      expect(result.yaw).toBeGreaterThan(0);
      expect(result.pitch).toBeGreaterThan(0);
    }
    expect(assistAim(heading, me, prey(0.001), 0.05, true).yaw).toBeCloseTo(0.001);
  });
  it("chooses the most aligned target and wraps yaw over the seam", () => {
    const state = { food: [...prey(0.2).food, ...prey(-0.1).food], sharks: [] };
    expect(assistAim(heading, me, state, 0.05, true).yaw).toBeLessThan(0);
    const start = { yaw: Math.PI - 0.001, pitch: 0 };
    expect(assistAim(start, me, prey(-Math.PI + 0.01), 0.05, true).yaw).toBeCloseTo(-Math.PI + 0.01);
  });
  it("assists only living edible-sized rival sharks", () => {
    const rival = { ...me, id: "rival", length: 10, position: position(0.2) };
    expect(assistAim(heading, me, { food: [], sharks: [rival] }, 0.05, true).yaw).toBeGreaterThan(0);
    for (const shark of [{ ...rival, length: 10.1 }, { ...rival, alive: false }, { ...rival, id: me.id }]) {
      expect(assistAim(heading, me, { food: [], sharks: [shark] }, 0.05, true)).toEqual(heading);
    }
  });
});
