import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoom,
  nextRandom,
  seedToNumber,
  spawnBots,
  step,
  type Action,
  type RoomState,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";

interface GameLogEntry {
  tick: number;
  action: Action;
}

function replayForDeterminism(
  options: { seed: string; id?: string; botCount: number },
  events: GameLogEntry[],
  toTick: number,
): RoomState {
  const state = createRoom({ seed: options.seed, id: options.id });
  spawnBots(state, options.botCount);
  const byTick = new Map<number, Action[]>();
  for (const event of events) {
    const actions = byTick.get(event.tick);
    if (actions) actions.push(event.action);
    else byTick.set(event.tick, [event.action]);
  }
  for (let tick = 0; tick <= toTick; tick += 1) {
    for (const action of byTick.get(tick) ?? []) applyAction(state, action);
    if (tick < toTick) step(state);
  }
  return state;
}

describe("deterministic engine", () => {
  it("reproduces the cross-runtime seed and random sequence", () => {
    const seed = seedToNumber("seed-fixed");
    expect(seed).toBe(3325626751);
    const [, next] = nextRandom(seed);
    expect(next).toBe(862225268);
  });

  it("creates byte-equivalent rooms from the same seed", () => {
    const left = createRoom({ id: "test", seed: "repeatable" });
    const right = createRoom({ id: "test", seed: "repeatable" });
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it("replays an ordered action fixture byte-for-byte inside the determinism test", () => {
    const events: GameLogEntry[] = [
      { tick: 0, action: { type: "join", playerId: "pilot", name: "Pilot" } },
      { tick: 20, action: { type: "setOrientation", playerId: "pilot", yaw: 0.75, pitch: 0.2 } },
      { tick: 40, action: { type: "setBoost", playerId: "pilot", on: true } },
      { tick: 60, action: { type: "bite", playerId: "pilot" } },
    ];
    const first = replayForDeterminism({ id: "determinism-replay", seed: "test-only-replay", botCount: 0 }, events, 80);
    const second = replayForDeterminism({ id: "determinism-replay", seed: "test-only-replay", botCount: 0 }, events, 80);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
