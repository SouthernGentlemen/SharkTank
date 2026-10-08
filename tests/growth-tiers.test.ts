import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  OCEAN,
  PREY_SPECS,
  ROUND_RULES,
  SHARK_TIERS,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  mouthPoint,
  sharkScaleForLength,
  step,
  tierForLength,
  tierProgress,
  type Prey,
} from "../src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";
import { CAMERA_PROJECTION, chaseCameraPose, makeChaseCameraPose } from "../src/game/game/sceneMath.js";

describe("ST-269 five authoritative growth tiers", () => {
  it("has five inclusive named milestones and bounded progress without adding persistent tier state", () => {
    expect(SHARK_TIERS.map((tier) => tier.name)).toEqual([
      "Pup", "Reef Shark", "Tiger Shark", "Great White", "Megalodon",
    ]);
    for (let index = 0; index < SHARK_TIERS.length; index += 1) {
      const tier = SHARK_TIERS[index];
      expect(tierForLength(tier.minLength)).toBe(tier.name);
      if (index > 0) expect(tierForLength(tier.minLength - 0.001)).toBe(SHARK_TIERS[index - 1].name);
      if (index < SHARK_TIERS.length - 1) {
        const next = SHARK_TIERS[index + 1];
        expect(tierProgress((tier.minLength + next.minLength) / 2)).toBeCloseTo(0.5);
      }
    }
    expect(tierProgress(0)).toBe(0);
    expect(tierProgress(112)).toBe(1);
    expect(tierProgress(1000)).toBe(1);
    for (const length of [-Infinity, Infinity, NaN, -3]) {
      expect(tierForLength(length)).toBe("Pup");
      expect(tierProgress(length)).toBe(0);
    }
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
  });

  it("reaches the four next tiers in a deterministic one-bait-per-second round", () => {
    // Feed through actual Room.step() mouth sweeps, rather than assigning score or length.
    // A sparse 1000-unit fixture isolates the steady-eater cadence from opportunistic prey.
    const room = createRoom({ seed: "st-269-steady-eater", oceanRadius: 1000 });
    room.food = [];
    applyAction(room, { type: "join", playerId: "eater", name: "Eater" });
    const shark = room.sharks.eater;
    const milestones: Record<string, number> = {};
    const target: Record<string, number> = {
      "Reef Shark": 30, "Tiger Shark": 90, "Great White": 180, "Megalodon": 270,
    };
    for (let tick = 1; tick <= ROUND_RULES.activeTicks; tick += 1) {
      if (tick % TICKS_PER_SECOND === 0) {
        const mouth = mouthPoint(shark);
        const meal: Prey = {
          id: `steady-${tick}`, kind: "bait", x: mouth.x, y: mouth.y, z: mouth.z,
          value: PREY_SPECS.bait.value, r: PREY_SPECS.bait.r,
          yaw: 0, pitch: 0, school: -1,
        };
        room.food.unshift(meal);
      }
      step(room);
      const tier = tierForLength(shark.length);
      if (tier !== "Pup" && !(tier in milestones)) milestones[tier] = room.tick / TICKS_PER_SECOND;
      if (Object.keys(milestones).length === 4) break;
    }
    expect(Object.keys(milestones)).toHaveLength(4);
    for (const [tier, seconds] of Object.entries(target)) {
      expect(milestones[tier]).toBeGreaterThanOrEqual(seconds * 0.75);
      expect(milestones[tier]).toBeLessThanOrEqual(seconds * 1.25);
    }
    expect(room.round.phase).not.toBe("result");
    expect(shark.score).toBeGreaterThanOrEqual(250);
    expect(shark.length).toBeGreaterThanOrEqual(112);
  }, 45_000);

  it("makes Megalodon approximately 2.5 times the Pup visual scale while retaining a finite cap", () => {
    const pup = sharkScaleForLength(SHARK_TIERS[0].minLength);
    const mega = sharkScaleForLength(SHARK_TIERS[4].minLength);
    expect(mega / pup).toBeGreaterThan(2.35);
    expect(mega / pup).toBeLessThan(2.65);
    expect(sharkScaleForLength(100000)).toBe(2.5);
  });

  it("frames Megalodon in the lower third without escaping the water column", () => {
    const scale = sharkScaleForLength(SHARK_TIERS[4].minLength);
    const pose = chaseCameraPose(
      { x: 0, y: 0, z: 0 }, 0, 0, makeChaseCameraPose(),
      { sharkScale: scale, speed: 11, arenaRadius: OCEAN.radius, seabedY: OCEAN.seabedY, surfaceY: OCEAN.surfaceY },
    );
    const camera = new PerspectiveCamera(CAMERA_PROJECTION.fov, 16 / 9);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    camera.updateMatrixWorld();
    const projected = new Vector3(0, 0, 0).project(camera);
    expect(projected.y).toBeGreaterThan(-0.7);
    expect(projected.y).toBeLessThan(-1 / 3);
    expect(pose.position.y).toBeLessThan(OCEAN.surfaceY);
    expect(pose.position.y).toBeGreaterThan(OCEAN.seabedY);
  });
});
