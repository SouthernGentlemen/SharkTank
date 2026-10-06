import { describe, expect, it } from "vitest";
import { applyAction, createRoom, returningCurrentYaw, step, TICKS_PER_SECOND } from "../src/engine/index.js";
import { LocalPredictor } from "../src/game/game/prediction.js";
import { toClientShark } from "../src/game/net/clientState.js";
import { toNetState } from "../src/protocol/index.js";

describe("ST-247 returning current", () => {
  it("grows from zero at four units inside and leaves inward headings alone", () => {
    expect(returningCurrentYaw(0, { x: 78, y: 0, z: 0 }, 82, 0.05)).toBe(0);
    const weak = returningCurrentYaw(0, { x: 79, y: 0, z: 0 }, 82, 0.05);
    const strong = returningCurrentYaw(0, { x: 81.5, y: 0, z: 0 }, 82, 0.05);
    expect(Math.abs(strong)).toBeGreaterThan(Math.abs(weak));
    expect(returningCurrentYaw(-Math.PI, { x: 81.5, y: 0, z: 0 }, 82, 0.05)).toBe(-Math.PI);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])("returns a shark despite held outward steering at yaw %s", (yaw) => {
    const state = createRoom({ seed: "current", oceanRadius: 82 });
    applyAction(state, { type: "join", playerId: "pilot", name: "pilot" });
    const shark = state.sharks.pilot;
    state.food = [];
    shark.position = { x: 81.5 * Math.cos(yaw), y: 0, z: 81.5 * Math.sin(yaw) };
    shark.yaw = shark.targetYaw = yaw;
    shark.pitch = shark.targetPitch = 0;
    shark.invulnTick = 0;
    const health = shark.health;
    let returned = false;
    for (let tick = 0; tick < TICKS_PER_SECOND * 3; tick++) {
      step(state);
      const radius = Math.hypot(shark.position.x, shark.position.z);
      expect(radius).toBeLessThanOrEqual(81.5 + 1e-9);
      returned ||= radius < 78;
      expect(shark.alive).toBe(true);
      expect(shark.health).toBe(health);
      expect(shark.lastDeath).toBeNull();
    }
    expect(returned).toBe(true);
  });

  it("mirrors one authority tick and clamps reconciliation from a stale outward snapshot", () => {
    const state = createRoom({ seed: "prediction-current" });
    applyAction(state, { type: "join", playerId: "pilot", name: "pilot" });
    const shark = state.sharks.pilot;
    shark.position = { x: 81.5, y: 0, z: 0 };
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const auth = toClientShark(toNetState(state).sharks[0]);
    const predictor = new LocalPredictor();
    const input = { targetYaw: 0, targetPitch: 0 } as Parameters<LocalPredictor["step"]>[1];
    const world = { ...state.ocean, arenaRadius: state.ocean.radius, tick: state.tick, frenzyUntilTick: 0 };
    predictor.step(auth, input, 0, 0, world);
    step(state);
    const result = predictor.step(auth, input, 0.05, 0, world)!;
    expect(result.yaw).toBeCloseTo(shark.yaw, 10);
    expect(Math.hypot(result.position.x, result.position.z)).toBeLessThanOrEqual(81.5 + 1e-9);
    for (let frame = 0; frame < 60; frame++) {
      const predicted = predictor.step(auth, input, 1 / 60, 0.1, world)!;
      expect(Math.hypot(predicted.position.x, predicted.position.z)).toBeLessThanOrEqual(81.5 + 1e-9);
      const rendered = predictor.renderPosition();
      expect(Math.hypot(rendered.x, rendered.z)).toBeLessThanOrEqual(81.5 + 1e-9);
    }
  });
});
