import { performance } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMBAT,
  PREY_BUDGET,
  TICKS_PER_SECOND,
  applyAction,
  createRoom,
  returningCurrentYaw,
  step,
  type Prey,
  type Shark,
} from "../src/engine/index.js";

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
  const point = { x, y, z };
  shark.position = { ...point };
  shark.yaw = shark.targetYaw = yaw;
  shark.pitch = shark.targetPitch = pitch;
}

function ready(shark: Shark): void {
  shark.invulnTick = 0;
  shark.biteCooldownTick = 0;
}

function farFood(count: number): Prey[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `far-${i}`,
    kind: "carcass" as const,
    x: 60 + (i % 5),
    y: -5 + (i % 11),
    z: -12 + (i % 25),
    value: 1,
    r: 0.5,
    yaw: 0,
    pitch: 0,
    school: -1,
  }));
}

describe("ST-122 directional shark combat", () => {
  it("uses explicit bounded combat constants", () => {
    expect(COMBAT).toMatchObject({
      maxHealth: 100,
      biteCooldownTicks: 14,
      biteRange: 3.4,
      biteRangeSizeBonusMax: 0.8,
      baseDamage: 34,
      minSizeDamageScale: 0.85,
      maxSizeDamageScale: 1.2,
      burstDamageMultiplier: 1.15,
      maxDamage: 42,
      killScoreMin: 3,
      killScoreMax: 10,
      killGrowthMin: 0.4,
      killGrowthMax: 1,
    });
    expect(COMBAT.biteConeCos).toBeCloseTo(Math.cos(Math.PI * (50 / 180)));
  });

  it("only hits an authoritative target in the forward cone and range", () => {
    const state = createRoom({ seed: "bite-cone", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const attacker = join(state, "attacker");
    const front = join(state, "front");
    const behind = join(state, "behind");
    const far = join(state, "far");
    place(attacker, 0, 0, 0, 0, 0);
    place(front, 3, 0, 0);
    place(behind, -2.5, 0, 0);
    place(far, 8, 0, 0);
    for (const shark of [attacker, front, behind, far]) ready(shark);
    state.tick = 100;

    applyAction(state, { type: "bite", playerId: attacker.id });

    expect(front.health).toBe(66);
    expect(behind.health).toBe(100);
    expect(far.health).toBe(100);
    expect(state.explosions).toContainEqual(expect.objectContaining({ kind: "bite", x: 3 }));
  });

  it("keeps bite cooldown authoritative and equal-size fights multi-hit", () => {
    const state = createRoom({ seed: "multi-bite", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const attacker = join(state, "attacker");
    const victim = join(state, "victim");
    place(attacker, 0, 0, 0);
    place(victim, 3, 0, 0);
    ready(attacker);
    ready(victim);
    state.tick = 100;

    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(66);
    expect(attacker.biteCooldownTick).toBe(114);

    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(66);

    state.tick = 114;
    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(32);
    expect(victim.alive).toBe(true);

    state.tick = 128;
    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.alive).toBe(false);
    expect(victim.health).toBe(0);
    expect(victim.lastDeath).toEqual({
      killerId: attacker.id,
      victimId: victim.id,
      action: "bite",
      tick: 128,
    });
  });

  it("bounds size advantage and the optional burst damage bonus", () => {
    const normal = createRoom({ seed: "normal-damage", oceanRadius: 100 });
    normal.food = farFood(PREY_BUDGET.ambient);
    const a = join(normal, "a");
    const b = join(normal, "b");
    place(a, 0, 0, 0);
    place(b, 3, 0, 0);
    ready(a); ready(b);
    normal.tick = 50;
    applyAction(normal, { type: "bite", playerId: "a" });
    const normalDamage = 100 - b.health;
    expect(normalDamage).toBe(34);

    const burst = createRoom({ seed: "burst-damage", oceanRadius: 100 });
    burst.food = farFood(PREY_BUDGET.ambient);
    const c = join(burst, "c");
    const d = join(burst, "d");
    place(c, 0, 0, 0);
    place(d, 3, 0, 0);
    ready(c); ready(d);
    c.lungeTicks = 5;
    burst.tick = 50;
    applyAction(burst, { type: "bite", playerId: "c" });
    const burstDamage = 100 - d.health;
    expect(burstDamage).toBeGreaterThan(normalDamage);
    expect(burstDamage).toBeLessThanOrEqual(COMBAT.maxDamage);

    const size = createRoom({ seed: "size-cap", oceanRadius: 100 });
    size.food = farFood(PREY_BUDGET.ambient);
    const giant = join(size, "giant");
    const small = join(size, "small");
    place(giant, 0, 0, 0);
    place(small, 3, 0, 0);
    ready(giant); ready(small);
    giant.length = 10_000;
    size.tick = 50;
    applyAction(size, { type: "bite", playerId: "giant" });
    expect(100 - small.health).toBeLessThanOrEqual(COMBAT.maxDamage);
    expect(small.alive).toBe(true);
  });

  it("ends attacker spawn grace on aggression but protects an invulnerable victim", () => {
    const state = createRoom({ seed: "spawn-protection", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const attacker = join(state, "attacker");
    const protectedVictim = join(state, "protected");
    place(attacker, 0, 0, 0);
    place(protectedVictim, 3, 0, 0);
    state.tick = 10;
    attacker.invulnTick = 200;
    protectedVictim.invulnTick = 200;

    applyAction(state, { type: "bite", playerId: attacker.id });

    expect(attacker.invulnTick).toBe(10);
    expect(protectedVictim.health).toBe(100);
  });

  it("makes ordinary overlap non-lethal regardless of size", () => {
    const state = createRoom({ seed: "overlap", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const large = join(state, "large");
    const small = join(state, "small");
    place(large, 0, 0, 0);
    place(small, 0, 0, 0);
    ready(large); ready(small);
    large.length = 100;
    small.length = 8;

    step(state);

    expect(large.alive).toBe(true);
    expect(small.alive).toBe(true);
    expect(large.health).toBe(100);
    expect(small.health).toBe(100);
    expect(large.yaw).toBe(0);
    expect(small.yaw).toBe(0);
    expect(Math.hypot(large.position.x - small.position.x, large.position.y - small.position.y, large.position.z - small.position.z))
      .toBeGreaterThanOrEqual(1.4 + Math.sqrt(100) * 0.075 + Math.sqrt(8) * 0.075 - 1e-9);
  });

  it.each([
    ["diagonal", 0, 0, 0, 0.3, 0.4, 0.5],
    ["surface", 0, 12, 0, 0, 11.8, 0],
    ["seabed", 0, -12, 0, 0, -11.8, 0],
    ["wall", 99.4, 0, 0, 99.1, 0, 0],
  ])("separates %s overlaps within the ocean while preserving headings and intent", (_label, ax, ay, az, bx, by, bz) => {
    const state = createRoom({ seed: "separation", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const a = join(state, "a");
    const b = join(state, "b");
    place(a, ax, ay, az, Math.PI / 2);
    place(b, bx, by, bz, Math.PI / 2);
    const expectedYaw = new Map([a, b].map((shark) => [shark.id,
      returningCurrentYaw(shark.yaw, shark.position, state.ocean.radius, 1 / TICKS_PER_SECOND)]));
    // Only the current may change heading; collision separation preserves it.
    step(state);
    const combinedRadius = 1.4 + (Math.sqrt(a.length) + Math.sqrt(b.length)) * 0.075;
    expect(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z))
      .toBeGreaterThanOrEqual(combinedRadius - 1e-8);
    for (const shark of [a, b]) {
      expect(shark.alive).toBe(true);
      expect(shark.health).toBe(100);
      expect(shark.yaw).toBeCloseTo(expectedYaw.get(shark.id)!);
      expect(shark.targetYaw).toBe(Math.PI / 2);
      expect(shark.pitch).toBe(0);
      expect(shark.targetPitch).toBe(0);
      expect(Math.hypot(shark.position.x, shark.position.z)).toBeLessThanOrEqual(state.ocean.radius - 0.5 + 1e-9);
      expect(shark.position.y).toBeGreaterThanOrEqual(state.ocean.seabedY);
      expect(shark.position.y).toBeLessThanOrEqual(state.ocean.surfaceY);
    }
  });

  it("caps kill rewards, growth and carcass creation at the prey budget", () => {
    const state = createRoom({ seed: "reward-cap", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.max - 1);
    const attacker = join(state, "attacker");
    const victim = join(state, "victim");
    place(attacker, 0, 0, 0);
    place(victim, 3, 0, 0);
    ready(attacker); ready(victim);
    attacker.length = 10_000;
    victim.length = 10_000;
    victim.health = 1;
    state.tick = 100;
    const beforeLength = attacker.length;

    applyAction(state, { type: "bite", playerId: attacker.id });

    expect(attacker.score).toBe(COMBAT.killScoreMax);
    expect(attacker.length - beforeLength).toBeCloseTo(COMBAT.killGrowthMax);
    expect(state.food.length).toBe(PREY_BUDGET.max);
    expect(victim.lastDeath?.action).toBe("bite");
  });

  it("routes bot attacks through the same authoritative bite action path", () => {
    const state = createRoom({ seed: "bot-bite", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.ambient);
    const bot = join(state, "hunter", true);
    const victim = join(state, "victim");
    place(bot, 0, 0, 0);
    place(victim, 3, 0, 0);
    ready(bot); ready(victim);
    bot.length = 20;
    victim.length = 10;
    state.tick = 100;

    step(state);

    expect(victim.health).toBeLessThan(100);
    expect(bot.biteCooldownTick).toBeGreaterThan(state.tick);

    const source = readFileSync(new URL("../src/engine/room.ts", import.meta.url), "utf8");
    expect(source).toContain('applyAction(state, { type: "bite", playerId: s.id })');
    expect(source).not.toContain("botDamage");
    expect(source).not.toContain("botKill");
  });

  it("applies the same seeded bite action stream byte-identically", () => {
    const first = createRoom({ seed: "combat-determinism", id: "same" });
    const second = createRoom({ seed: "combat-determinism", id: "same" });
    const events = [
      { tick: 0, action: { type: "join", playerId: "a", name: "A" } as const },
      { tick: 0, action: { type: "join", playerId: "b", name: "B" } as const },
      { tick: 1, action: { type: "setOrientation", playerId: "a", yaw: 0.4, pitch: 0.2 } as const },
      { tick: 2, action: { type: "setBoost", playerId: "a", on: true } as const },
      { tick: 3, action: { type: "bite", playerId: "a" } as const },
    ];
    for (let tick = 0; tick <= 20; tick += 1) {
      for (const event of events) {
        if (event.tick !== tick) continue;
        applyAction(first, event.action);
        applyAction(second, event.action);
      }
      if (tick < 20) {
        step(first);
        step(second);
      }
    }
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("removes ranged projectile compatibility from engine, protocol, client and retired persistence", () => {
    const paths = [
      "../src/engine/types.ts",
      "../src/engine/room.ts",
      "../src/protocol/index.ts",
      "../src/game/net/useRoomSocket.ts",
      "../src/game/game/useLocalInput.ts",
      "../src/game/game/FxLayer.tsx",
      "../src/game/ui/GameScreen.tsx",
    ];
    for (const path of paths) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8").toLowerCase();
      expect(source).not.toContain("rocket");
    }
    expect(existsSync(new URL("../src/worker/room-state-schema.ts", import.meta.url))).toBe(false);
  });

  it("keeps a 32-shark / 360-prey combat simulation inside the 20 Hz tick budget", () => {
    const state = createRoom({ id: "combat-budget", seed: "st-122-budget", oceanRadius: 100 });
    state.food = farFood(PREY_BUDGET.max);
    state.sharks = {};
    for (let i = 0; i < 32; i += 1) {
      const shark = join(state, `shark-${i}`);
      const row = Math.floor(i / 8);
      const col = i % 8;
      place(shark, -14 + col * 4, -4 + row * 2.5, -4 + (i % 4) * 2.5, (i % 2) * Math.PI);
      ready(shark);
      shark.length = 10 + (i % 8);
    }
    for (let i = 0; i < 10; i += 1) step(state);

    const ticks = 80;
    const started = performance.now();
    for (let tick = 0; tick < ticks; tick += 1) {
      for (const shark of Object.values(state.sharks)) {
        if (shark.alive) applyAction(state, { type: "bite", playerId: shark.id });
      }
      step(state);
    }
    const averageMs = (performance.now() - started) / ticks;
    console.info(`ST-122 combat tick average: ${averageMs.toFixed(3)} ms; budget: ${(1000 / TICKS_PER_SECOND).toFixed(0)} ms; sharks: 32; prey max: ${PREY_BUDGET.max}`);
    expect(averageMs).toBeLessThan(1000 / TICKS_PER_SECOND);
  });
});
