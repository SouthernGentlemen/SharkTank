import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_PITCH,
  MOVE,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  forwardFromYawPitch as engineForward,
  spawnOrientationForPoint,
  step,
  swimSpeedForLungeTicks,
} from "../src/engine/index.js";
import {
  CAMERA_PROJECTION,
  advanceBankRoll,
  snapshotYawRate,
  smoothYawRate,
  applyCameraRelativeSteering,
  cameraFovForSpeed,
  chaseCameraPose,
  makeChaseCameraPose,
  smoothChaseCameraPose,
} from "../src/game/game/sceneMath.js";

describe("ST-115 shark swimming and chase camera", () => {
  it("follows the same corrected visual position used to draw the local shark", () => {
    const actor = readFileSync(new URL("../src/game/game/ActorLayer.tsx", import.meta.url), "utf8");
    expect(actor).toContain("position.set(localRenderPosition!.x, localRenderPosition!.y, localRenderPosition!.z)");
    for (const axis of ["x", "y", "z"]) {
      expect(actor).toContain(`followRef.current.position.${axis} = localRenderPosition!.${axis}`);
    }
    expect(actor).toMatch(/if \(!frame\) \{\s+predictor.reset\(\)/);
  });

  it("applies configurable camera-relative yaw/pitch steering inside safe pitch limits", () => {
    const steered = applyCameraRelativeSteering(
      Math.PI / 2, 0.2, 1, 0.5, 0.1, { turnRate: 2, pitchRate: 1 },
    );
    expect(steered.yaw).toBeCloseTo(Math.PI / 2 + 0.1);
    expect(steered.pitch).toBeCloseTo(0.225);

    const bounded = applyCameraRelativeSteering(0, MAX_PITCH - 0.01, 0, 1, 0.05, {
      turnRate: 4,
      pitchRate: 8,
    });
    expect(bounded.pitch).toBe(MAX_PITCH);
  });

  it("accelerates into and decelerates out of a dash without adding velocity state", () => {
    const entering = swimSpeedForLungeTicks(10);
    const peak = swimSpeedForLungeTicks(8);
    const leaving = swimSpeedForLungeTicks(1);
    expect(entering).toBeGreaterThan(MOVE.BASE_SPEED);
    expect(peak).toBeGreaterThan(entering);
    expect(peak).toBeLessThanOrEqual(MOVE.BOOST_SPEED);
    expect(leaving).toBeLessThan(peak);
    expect(swimSpeedForLungeTicks(0)).toBe(MOVE.BASE_SPEED);
  });

  it("traverses X/Y/Z continuously under combined yaw and pitch", () => {
    const state = createRoom({ seed: "st-115-flight", oceanRadius: 100, seabedY: -30, surfaceY: 30 });
    state.food = [];
    applyAction(state, { type: "join", playerId: "pilot", name: "Pilot" });
    const shark = state.sharks.pilot;
    shark.position = { x: 0, y: 0, z: 0 };
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    applyAction(state, { type: "setOrientation", playerId: "pilot", yaw: Math.PI / 3, pitch: Math.PI / 5 });
    for (let i = 0; i < 8; i += 1) step(state);
    expect(Math.abs(shark.position.x)).toBeGreaterThan(0.5);
    expect(shark.position.y).toBeGreaterThan(0.5);
    expect(Math.abs(shark.position.z)).toBeGreaterThan(0.5);
  });

  it("derives presentation bank from yaw rate and returns smoothly to neutral", () => {
    let roll = advanceBankRoll(0, 2.2, 1 / 60);
    const turning = Math.abs(roll);
    expect(turning).toBeGreaterThan(0);
    for (let i = 0; i < 90; i += 1) roll = advanceBankRoll(roll, 0, 1 / 60);
    expect(Math.abs(roll)).toBeLessThan(turning);
    expect(Math.abs(roll)).toBeLessThan(0.002);
    const reducedBank = advanceBankRoll(0.3, 3, 1 / 60, true);
    expect(Math.abs(reducedBank)).toBeGreaterThan(0);
    expect(Math.abs(reducedBank)).toBeLessThanOrEqual(0.24);
  });

  it("smooths stepped 10 Hz snapshot yaw without frame-sized rate spikes", () => {
    expect(snapshotYawRate(Math.PI - 0.1, -Math.PI + 0.1, 10, 12)).toBeCloseTo(2);
    expect(snapshotYawRate(0, 1, 12, 12)).toBe(0);
    let rate = 0;
    let roll = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      const pair = Math.floor(frame / 6);
      const target = snapshotYawRate(pair * 0.12, (pair + 1) * 0.12, pair * 2, (pair + 1) * 2);
      rate = smoothYawRate(rate, target, 1 / 60);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1.2 + 1e-12);
      const next = advanceBankRoll(roll, rate, 1 / 60);
      expect(Math.abs(next - roll)).toBeLessThan(0.01);
      roll = next;
    }
    for (let frame = 0; frame < 180; frame += 1) {
      rate = smoothYawRate(rate, 0, 1 / 60);
      roll = advanceBankRoll(roll, rate, 1 / 60);
    }
    expect(Math.abs(roll)).toBeLessThan(0.002);
  });

  it("keeps the chase camera readable through pitch/turn, scales distance, and bounds it to water", () => {
    const target = { x: 0, y: 0, z: 0 };
    const base = chaseCameraPose(target, Math.PI / 2, Math.PI / 4, makeChaseCameraPose(), {
      sharkScale: 1, speed: 11, baseSpeed: 11, boostSpeed: 28,
      arenaRadius: 82, seabedY: -12, surfaceY: 12,
    });
    const fast = chaseCameraPose(target, Math.PI / 2, Math.PI / 4, makeChaseCameraPose(), {
      sharkScale: 2, speed: 28, baseSpeed: 11, boostSpeed: 28,
      arenaRadius: 82, seabedY: -12, surfaceY: 12,
    });
    expect(Math.hypot(fast.position.x, fast.position.y, fast.position.z))
      .toBeGreaterThan(Math.hypot(base.position.x, base.position.y, base.position.z));
    expect(base.lookAt.y).toBeGreaterThan(target.y);

    const edge = chaseCameraPose({ x: 80, y: 11.5, z: 0 }, Math.PI, -Math.PI / 4, makeChaseCameraPose(), {
      arenaRadius: 82, seabedY: -12, surfaceY: 12,
    });
    expect(Math.hypot(edge.position.x, edge.position.z)).toBeLessThanOrEqual(80.5);
    expect(edge.position.y).toBeGreaterThanOrEqual(-10.75);
    expect(edge.position.y).toBeLessThanOrEqual(10.75);
  });

  it("uses a non-overshooting camera spring and a fully playable reduced-motion pose", () => {
    const current = makeChaseCameraPose();
    current.position = { x: 0, y: 0, z: 0 };
    current.lookAt = { x: 0, y: 0, z: 0 };
    const goal = makeChaseCameraPose();
    goal.position = { x: 10, y: -5, z: 4 };
    goal.lookAt = { x: 12, y: 1, z: 0 };

    const smooth = smoothChaseCameraPose(current, goal, 1 / 60, false, makeChaseCameraPose());
    expect(smooth.position.x).toBeGreaterThan(0);
    expect(smooth.position.x).toBeLessThan(10);

    const reduced = smoothChaseCameraPose(current, goal, 1 / 60, true, makeChaseCameraPose());
    expect(reduced).toEqual(goal);
    expect(cameraFovForSpeed(28, 11, 28, true)).toBe(CAMERA_PROJECTION.fov);
    expect(cameraFovForSpeed(28, 11, 28, false)).toBeGreaterThan(CAMERA_PROJECTION.fov);
  });

  it("spawns facing the tank interior and pitches away from surface/floor", () => {
    const ocean = { radius: 82, seabedY: -12, surfaceY: 12 };
    const high = spawnOrientationForPoint({ x: 50, y: 10, z: 0 }, ocean, 0);
    const low = spawnOrientationForPoint({ x: 50, y: -10, z: 0 }, ocean, 0);
    expect(high.pitch).toBeLessThan(0);
    expect(low.pitch).toBeGreaterThan(0);

    const forward = engineForward(high.yaw, high.pitch);
    const towardCenter = { x: -50, y: -10, z: 0 };
    const dot = forward.x * towardCenter.x + forward.y * towardCenter.y + forward.z * towardCenter.z;
    expect(dot).toBeGreaterThan(0);
    expect(Math.abs(high.pitch)).toBeLessThanOrEqual(0.35);
  });

  it("keeps separate authoritative turn/pitch rates visible to prediction", () => {
    expect(MOVE.TURN_RATE * TICKS_PER_SECOND).toBeGreaterThan(MOVE.PITCH_RATE * TICKS_PER_SECOND);
  });
});
