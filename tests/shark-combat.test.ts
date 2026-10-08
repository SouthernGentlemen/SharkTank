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
      biteRange: 1.8,
      biteRangeScale: 0.3,
      victimBodyRadiusScale: 0.62,
      baseDamage: 50,
      devourLengthRatio: 1.5,
      burstDamage: 60,
      nibbleDamage: 20,
      healthRegenPerSecond: 4,
      killScoreMin: 5,
      killScoreMax: 60,
      killGrowthMin: 0.5,
      killGrowthMax: 8,
    });
    expect(COMBAT.biteConeCos).toBeCloseTo(Math.cos(Math.PI * (65 / 180)));
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

    expect(front.health).toBe(50);
    expect(behind.health).toBe(100);
    expect(far.health).toBe(100);
    expect(state.explosions).toContainEqual(expect.objectContaining({ kind: "bite", x: 3 }));
  });

  it.each([
    ["tail", 6, 0, 0, 0, 0, true],
    ["flank", 2, 0, 3, Math.PI / 2, 0, true],
    ["pitched body", 2, 3, 0, 0, Math.PI / 2, true],
    ["wide cone", 2, 0, 2.6, 0, 0, true],
    ["aimed away", -6, 0, 0, Math.PI, 0, false],
    ["out of reach", 10, 0, 0, 0, 0, false],
  ])("checks mouth-to-body contact: %s", (_, x, y, z, yaw, pitch, hits) => {
    const state = createRoom({ seed: "body-contact" });
    const attacker = join(state, "a");
    const victim = join(state, "v");
    attacker.length = victim.length = 10;
    place(attacker, 0, 0, 0);
    place(victim, x, y, z, yaw, pitch);
    ready(attacker); ready(victim);
    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(hits ? 50 : 100);
  });

  it("chooses the nearest body surface with stable id ties", () => {
    const state = createRoom({ seed: "body-nearest" });
    const attacker = join(state, "attacker");
    const farther = join(state, "farther");
    const z = join(state, "z");
    const a = join(state, "a");
    for (const shark of [attacker, farther, z, a]) { shark.length = 10; ready(shark); }
    place(attacker, 0, 0, 0);
    place(farther, 2, 0, 5, Math.PI / 2);
    place(z, 6, 0, 0);
    place(a, 6, 0, 0);
    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(a.health).toBe(50);
    expect(z.health).toBe(100);
    expect(farther.health).toBe(100);
  });

  it("keeps bite cooldown authoritative and two equal-size bites total 100 damage", () => {
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
    expect(victim.health).toBe(50);
    expect(attacker.biteCooldownTick).toBe(114);

    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(50);

    state.tick = 114;
    applyAction(state, { type: "bite", playerId: attacker.id });

    expect(victim.alive).toBe(false);
    expect(victim.health).toBe(0);
    expect(victim.lastDeath).toEqual({
      killerId: attacker.id,
      victimId: victim.id,
      action: "bite",
      tick: 114,
    });
  });

  it.each([
    [15, 10, 0, 0], [14.999, 10, 0, 50],
    [10, 15, 0, 80], [10, 14.999, 0, 50],
    [10, 10, 5, 40], [10, 15, 5, 80], [15, 10, 5, 0],
  ])("applies length tiers and burst damage (%s / %s, lunge %s)", (aLength, vLength, lunge, health) => {
    const state = createRoom({ seed: "damage-tiers" });
    const attacker = join(state, "a"); const victim = join(state, "v");
    place(attacker, 0, 0, 0); place(victim, 3, 0, 0);
    ready(attacker); ready(victim);
    attacker.length = aLength; victim.length = vLength; attacker.lungeTicks = lunge;
    applyAction(state, { type: "bite", playerId: attacker.id });
    expect(victim.health).toBe(health);
    expect(victim.alive).toBe(health > 0);
  });

  it.each([[0, 1, 5, 0.5], [42, 12, 11, 3], [1000, 100, 60, 8]])(
    "bounds score and length rewards (%s score, %s length)", (score, length, reward, growth) => {
      const state = createRoom({ seed: "rewards" });
      const a = join(state, "a"); const v = join(state, "v");
      place(a, 0, 0, 0); place(v, 3, 0, 0); ready(a); ready(v);
      a.length = length * 1.5; v.length = length; v.score = score;
      const before = a.length;
      applyAction(state, { type: "bite", playerId: a.id });
      expect(v.alive).toBe(false);
      expect(a.score).toBe(reward); expect(a.length - before).toBeCloseTo(growth);
    },
  );

  it("includes regeneration between cooldown-spaced even bites", () => {
    const state = createRoom({ seed: "even-regen" });
    state.food = farFood(PREY_BUDGET.ambient);
    const a = join(state, "a"); const v = join(state, "v");
    place(a, 0, 0, 0); place(v, 3, 0, 0); ready(a); ready(v);
    applyAction(state, { type: "bite", playerId: a.id });
    for (let i = 0; i < COMBAT.biteCooldownTicks; i++) step(state);
    place(a, 0, 0, 0); place(v, 3, 0, 0);
    applyAction(state, { type: "bite", playerId: a.id });
    expect(v.alive).toBe(true); expect(v.health).toBeCloseTo(2.8);
  });

  it("regenerates 4 HP per second, caps health and leaves dead sharks and results frozen", () => {
    const state = createRoom({ seed: "regen" });
    state.food = farFood(PREY_BUDGET.ambient);
    const a = join(state, "a"); const b = join(state, "b"); const dead = join(state, "dead");
    place(a, 0, 0, 0); place(b, 0, 5, 30);
    a.health = 50; b.health = 99; dead.alive = false; dead.health = 0;
    for (let i = 0; i < TICKS_PER_SECOND; i++) step(state);
    expect(a.health).toBeCloseTo(54); expect(b.health).toBe(100); expect(dead.health).toBe(0);
    state.round.phase = "result"; state.round.resultEndTick = state.tick + 10;
    step(state); expect(a.health).toBeCloseTo(54);
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
    victim.score = 1000;
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
    place(victim, 6, 0, 0);
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
