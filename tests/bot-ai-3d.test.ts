import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOT_AI_BUDGET,
  PREY_BUDGET,
  PREY_SPECS,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  spawnBots,
  step,
  type Prey,
  type Shark,
} from "../src/engine/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
}

function prey(
  id: string,
  kind: Prey["kind"],
  x: number,
  y: number,
  z: number,
  school = -1,
  value = PREY_SPECS[kind].value,
): Prey {
  return {
    id,
    kind,
    x,
    y,
    z,
    school,
    value,
    r: PREY_SPECS[kind].r,
    yaw: 0,
    pitch: 0,
  };
}

function farPrey(count = PREY_BUDGET.ambient): Prey[] {
  return Array.from({ length: count }, (_, i) => prey(
    `far-${i}`,
    "carcass",
    64 + (i % 4),
    -6 + (i % 13),
    -14 + (i % 29),
  ));
}

describe("ST-121 full-3D bot hunting and evasion", () => {
  it("uses explicit bounded perception and keeps the production target at 24 bots / 32 sharks", () => {
    expect(BOT_AI_BUDGET).toMatchObject({
      targetPopulation: 24,
      maxTrackedSharks: 32,
      preySight: 24,
      frenzySight: 40,
      threatRadius: 15,
      huntRadius: 19,
    });
    expect(BOT_AI_BUDGET.maxTrackedSharks).toBeGreaterThanOrEqual(BOT_AI_BUDGET.targetPopulation);
    expect(PREY_BUDGET.max).toBe(720);

    const engine = read("../src/engine/room.ts");
    expect(engine).toContain(".slice(0, BOT_AI_BUDGET.maxTrackedSharks)");
    expect(engine).toContain("for (const actor of state.food)");
    expect(engine).not.toContain("Math.random(");
  });

  it("flies toward prey above and below instead of collapsing steering onto one Y plane", () => {
    const high = createRoom({ seed: "bot-depth-high", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    high.food = [prey("upper-reef", "reef", 10, 8, 0), ...farPrey(PREY_BUDGET.ambient - 1)];
    const climbing = join(high, "climber", true);
    place(climbing, 0, -8, 0);
    climbing.yaw = climbing.targetYaw = 0;
    climbing.pitch = climbing.targetPitch = 0;
    step(high);
    expect(climbing.targetPitch).toBeGreaterThan(0.5);
    expect(climbing.position.y).toBeGreaterThan(-8);

    const low = createRoom({ seed: "bot-depth-low", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    low.food = [prey("lower-reef", "reef", 10, -8, 0), ...farPrey(PREY_BUDGET.ambient - 1)];
    const diving = join(low, "diver", true);
    place(diving, 0, 8, 0);
    diving.yaw = diving.targetYaw = 0;
    diving.pitch = diving.targetPitch = 0;
    step(low);
    expect(diving.targetPitch).toBeLessThan(-0.5);
    expect(diving.position.y).toBeLessThan(8);
  });

  it("turns inward from the outer wall and pitches away from surface and seabed before collision", () => {
    const surface = createRoom({ seed: "bot-boundary-surface", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    surface.food = farPrey();
    const upper = join(surface, "upper", true);
    place(upper, 91, 18, 0);
    upper.yaw = upper.targetYaw = 0;
    upper.pitch = upper.targetPitch = 0;
    step(surface);
    expect(Math.abs(upper.targetYaw)).toBeGreaterThan(2.5);
    expect(upper.targetPitch).toBeLessThan(-0.5);
    expect(upper.alive).toBe(true);

    const floor = createRoom({ seed: "bot-boundary-floor", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    floor.food = farPrey();
    const lower = join(floor, "lower", true);
    place(lower, 0, -18, 0);
    lower.yaw = lower.targetYaw = 0;
    lower.pitch = lower.targetPitch = 0;
    step(floor);
    expect(lower.targetPitch).toBeGreaterThan(0.5);
    expect(lower.alive).toBe(true);
  });

  it("evades a nearby apex shark through 3D and uses the normal authoritative burst action", () => {
    const state = createRoom({ seed: "bot-evade", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = farPrey();
    const bot = join(state, "evader", true);
    const apex = join(state, "apex");
    place(bot, 0, 0, 0);
    place(apex, 6, 5, 0);
    bot.length = 10;
    apex.length = 20;
    bot.yaw = bot.targetYaw = 0;
    bot.pitch = bot.targetPitch = 0;
    apex.invulnTick = 0;

    step(state);

    expect(Math.abs(bot.targetYaw)).toBeGreaterThan(2.5);
    expect(bot.targetPitch).toBeLessThan(0);
    expect(bot.lungeTicks).toBe(9);
    expect(bot.dashCooldownTick).toBe(state.tick + TICKS_PER_SECOND * 2);

    const engine = read("../src/engine/room.ts");
    expect(engine).toContain('applyAction(state, { type: "setBoost", playerId: s.id, on: true })');
    expect(engine).not.toContain("s.lungeTicks = 6");
  });

  it("lets a larger bot pursue a vulnerable rival in full 3D without bot-only combat rules", () => {
    const state = createRoom({ seed: "bot-hunt", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = farPrey();
    const hunter = join(state, "hunter", true);
    const quarry = join(state, "quarry");
    place(hunter, 0, 0, 0);
    place(quarry, 7, 4, 0);
    hunter.length = 30;
    quarry.length = 10;
    quarry.invulnTick = 0;
    hunter.yaw = hunter.targetYaw = 0;
    hunter.pitch = hunter.targetPitch = 0;

    step(state);

    expect(Math.abs(hunter.targetYaw)).toBeLessThan(0.25);
    expect(hunter.targetPitch).toBeGreaterThan(0.25);
    expect(hunter.lungeTicks).toBe(9);
    const engine = read("../src/engine/room.ts");
    expect(engine).not.toContain("botDamage");
    expect(engine).not.toContain("botKill");
  });

  it("prioritizes authoritative Feeding Frenzy chum over a nearer low-value bait fish", () => {
    const state = createRoom({ seed: "bot-frenzy", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.tick = 100;
    state.frenzyUntilTick = 220;
    state.food = [
      prey("near-bait", "bait", 3, 0, 0, 1),
      prey("frenzy-chum", "chum", 0, 8, 15, 2, 5),
      ...farPrey(PREY_BUDGET.ambient - 2),
    ];
    const bot = join(state, "frenzy-bot", true);
    place(bot, 0, 0, 0);
    bot.yaw = bot.targetYaw = 0;
    bot.pitch = bot.targetPitch = 0;

    step(state);

    expect(bot.targetYaw).toBeGreaterThan(1);
    expect(bot.targetPitch).toBeGreaterThan(0.25);
  });

  it("replays seeded 24-bot simulations byte-identically while bots occupy multiple depths", () => {
    const first = createRoom({ id: "deterministic-bots", seed: "st-121-deterministic" });
    const second = createRoom({ id: "deterministic-bots", seed: "st-121-deterministic" });
    spawnBots(first, BOT_AI_BUDGET.targetPopulation);
    spawnBots(second, BOT_AI_BUDGET.targetPopulation);

    for (let i = 0; i < 180; i += 1) {
      step(first);
      step(second);
    }

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const living = Object.values(first.sharks).filter((shark) => shark.alive && shark.position);
    expect(new Set(living.map((shark) => Math.round(shark.position.y))).size).toBeGreaterThan(4);
    expect(living.some((shark) => Math.abs(shark.pitch) > 0.08)).toBe(true);
  });

  it("keeps a max-prey, 24-bot simulation inside the authoritative server-tick budget", () => {
    const state = createRoom({ id: "budget-bots", seed: "st-121-budget" });
    state.food.push(...farPrey(PREY_BUDGET.max - state.food.length).map((actor, i) => ({
      ...actor,
      id: `budget-extra-${i}`,
    })));
    spawnBots(state, BOT_AI_BUDGET.targetPopulation);

    for (let i = 0; i < 10; i += 1) step(state);
    while (state.food.length < PREY_BUDGET.max) {
      const i = state.food.length;
      state.food.push(prey(`budget-refill-${i}`, "carcass", 62 + (i % 5), -5 + (i % 11), -12 + (i % 25)));
    }

    const ticks = 80;
    const started = performance.now();
    for (let i = 0; i < ticks; i += 1) step(state);
    const elapsed = performance.now() - started;
    const averageTickMs = elapsed / ticks;
    const authoritativeTickMs = 1000 / TICKS_PER_SECOND;
    console.info(`ST-121 24-bot / max-prey average tick: ${averageTickMs.toFixed(3)}ms; budget: ${authoritativeTickMs.toFixed(1)}ms`);

    expect(averageTickMs).toBeLessThan(authoritativeTickMs);
  });
});
