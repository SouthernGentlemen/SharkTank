// Engine core — deterministic snake.io-style room simulation.
// Pure functions over serializable RoomState (no DOM, no three.js, no node APIs),
// so the exact same code runs in the browser (bots/preview) and in the authoritative
// Room Durable Object. RNG state lives in the snapshot, so the whole thing is replayable.

import {
  clampPitch,
  clampToOceanVolume,
  distance3,
  distancePointToSegmentSquared3,
  distanceSquared3,
  forwardFromYawPitch,
  horizontalRadiusSquared,
  isInsideOceanVolume,
  moveToward,
  normalizeYaw,
  rotateYawToward,
  yawPitchToward,
} from "./geometry3d.js";
import { nextRandom, seedToNumber } from "./rng.js";
import type { Action, OceanVolume, Prey, PreyKind, RocketProjectile, RoomState, ScoreEntry, Snake, Vec3 } from "./types.js";

// ── Tuning ────────────────────────────────────────────────────────────────────
// Ticking at 30Hz (vs 20) means fresher snapshots → less perceived lag. Per-tick speeds
// are scaled so world-per-second speed/turn stay constant; client prediction derives its
// per-second rates from MOVE × TICKS_PER_SECOND, so it stays exactly in sync.
export const TICKS_PER_SECOND = 20; // responsive authority; shark snapshots contain only one body point
// 32 sharks share a tank, so the arena grew with the population — enough water that a
// full lobby is dense rather than a permanent scrum at the wall.
export const ROOM_SCHEMA_VERSION = 9 as const;
const OCEAN_RADIUS = 82;
export const DEFAULT_SEABED_Y = -12;
export const DEFAULT_SURFACE_Y = 12;
const BASE_SPEED = 0.556; // world units / tick (~11 u/s)
const BOOST_SPEED = 1.42; // (~28 u/s) — short, high-impact chomp dash
const TURN_RATE = 0.22; // max yaw radians / tick (~4.4 rad/s)
const PITCH_RATE = 0.16; // max pitch radians / tick (~3.2 rad/s), calmer near surface/floor
const SEGMENT_SPACING = 0.62; // arc-length between body discs sampled off the head trail
const START_LENGTH = 10;
/** A fresh shark enters at the size of the field, not at the size of an empty tank.
 *  In a 32-shark arena the bots are already 3-5× a bare spawn by the time a human
 *  joins, so a flat START_LENGTH meant every new life was eaten within seconds by the
 *  middle of the pack. Spawn size now tracks the median living shark, capped so the
 *  biggest sharks still out-rank a newcomer and the tank cannot inflate itself. */
const SPAWN_MEDIAN_SHARE = 0.45;
const MAX_SPAWN_LENGTH = START_LENGTH * 2.6;
const MIN_LENGTH = 6; // can't boost below this
const TAIL_MARGIN = 1.5; // extra trail arc-length kept beyond the body (world units)
const HEAD_RADIUS = 0.7; // collision radius of the head
const EAT_RADIUS = 1.2;
const MAX_CHOMPS_PER_TICK = 2;
const RESPAWN_DELAY = TICKS_PER_SECOND; // one second dead before respawn is allowed
const SPAWN_GRACE = Math.round(TICKS_PER_SECOND * 6); // enough time to orient and use an ability before size combat starts
export const PREY_KINDS = ["bait", "reef", "chum", "carcass"] as const satisfies readonly PreyKind[];
export const PREY_BUDGET = {
  ambient: 200,
  spawnPerTick: 4,
  max: 360,
  frenzyChum: 40,
  schools: 12,
  boundaryMargin: 1.5,
  maxSharksForFlee: 32,
} as const;
export const PREY_SPECS: Record<PreyKind, {
  value: number;
  r: number;
  speed: number;
  turnRate: number;
  pitchRate: number;
  fleeRadius: number;
  fleeMultiplier: number;
}> = {
  bait: { value: 1, r: 0.42, speed: 0.13, turnRate: 0.1, pitchRate: 0.055, fleeRadius: 9, fleeMultiplier: 1.65 },
  reef: { value: 2, r: 0.58, speed: 0.105, turnRate: 0.075, pitchRate: 0.045, fleeRadius: 8, fleeMultiplier: 1.45 },
  chum: { value: 3, r: 0.78, speed: 0.065, turnRate: 0.04, pitchRate: 0.03, fleeRadius: 0, fleeMultiplier: 1 },
  carcass: { value: 1, r: 0.5, speed: 0.035, turnRate: 0.02, pitchRate: 0.018, fleeRadius: 0, fleeMultiplier: 1 },
};
/** Share of ambient dots that spawn in the middle of the tank rather than anywhere.
 *  A uniform-area scatter over the larger arena left the centre visibly empty, which
 *  removed the reason to fight over the middle. */
const CENTER_FOOD_SHARE = 0.55;
const CENTER_FOOD_RADIUS = 0.3; // fraction of the arena radius that counts as "the middle"
// ── Feeding Frenzy ──
// Every FRENZY_PERIOD ticks a chum drop lands dead centre and the whole tank goes
// hungry for FRENZY_TICKS: faster sharks, halved dash cooldown, richer dots. Driven
// entirely off `state.tick`, so it replays deterministically like everything else.
const FRENZY_PERIOD = TICKS_PER_SECOND * 75;
const FRENZY_TICKS = TICKS_PER_SECOND * 20;
const FRENZY_SPEED = 1.16;
const FRENZY_CHUM = PREY_BUDGET.frenzyChum;
// With 24 bots in the tank, a high retire score let two or three monsters accumulate and
// farm every fresh spawn. A lower ceiling keeps the size ladder climbable.
const BOT_RETIRE_SCORE = 240;
const DASH_TICKS = 10;
const DASH_ACCEL_TICKS = 3;
const DASH_DECEL_TICKS = 4;
const DASH_COOLDOWN_TICKS = TICKS_PER_SECOND * 2;
const ROCKET_SPEED = 3.1;
const ROCKET_LIFETIME_TICKS = TICKS_PER_SECOND * 3;
const ROCKET_COOLDOWN_TICKS = TICKS_PER_SECOND * 3;
const EXPLOSION_TICKS = 24;

/** Cosmetic catalog. Colorblind-safe, high-contrast hues; shared by server + client. */
export interface Skin {
  id: string;
  name: string;
  /** Body color (hex). Head is rendered brighter client-side. */
  color: string;
  /** Optional secondary color for banded patterns. */
  accent?: string;
  pattern: "solid" | "bands";
}

// Neon "Tron" palette — vivid, hue-distinct (colorblind-separable), glows on black.
export const SKINS: Skin[] = [
  { id: "cyan", name: "Cyan", color: "#22e6ff", accent: "#0891b2", pattern: "bands" },
  { id: "orange", name: "Orange", color: "#ff8a1f", accent: "#c2410c", pattern: "bands" },
  { id: "lime", name: "Lime", color: "#57ff5a", accent: "#15803d", pattern: "bands" },
  { id: "magenta", name: "Magenta", color: "#ff43d4", accent: "#a21caf", pattern: "bands" },
  { id: "gold", name: "Gold", color: "#ffe14d", accent: "#b8890a", pattern: "bands" },
  { id: "violet", name: "Violet", color: "#a78bff", accent: "#6d28d9", pattern: "bands" },
];

export const DEFAULT_SKIN = SKINS[0].id;

const BOT_NAMES = [
  "Slinky", "Noodle", "Fang", "Zippy", "Coil", "Viper", "Wriggle", "Dash", "Boa", "Mamba",
  "Chomp", "Gill", "Reef", "Tide", "Bruce", "Nibbles", "Torpedo", "Barnacle", "Kelp", "Riptide",
  "Molar", "Anchor", "Squall", "Chowder", "Flotsam", "Bubbles", "Undertow", "Cutlass",
];

export interface CreateRoomOptions {
  id?: string;
  seed?: string;
  oceanRadius?: number;
  seabedY?: number;
  surfaceY?: number;
}

export function createRoom(opts: CreateRoomOptions = {}): RoomState {
  const seed = opts.seed ?? "seed-fixed";
  const radius = Number.isFinite(opts.oceanRadius) && (opts.oceanRadius as number) >= 8
    ? (opts.oceanRadius as number)
    : OCEAN_RADIUS;
  const requestedFloor = Number.isFinite(opts.seabedY) ? (opts.seabedY as number) : DEFAULT_SEABED_Y;
  const requestedSurface = Number.isFinite(opts.surfaceY) ? (opts.surfaceY as number) : DEFAULT_SURFACE_Y;
  const validVerticalBounds = requestedSurface - requestedFloor >= 4;
  const seabedY = validVerticalBounds ? requestedFloor : DEFAULT_SEABED_Y;
  const surfaceY = validVerticalBounds ? requestedSurface : DEFAULT_SURFACE_Y;
  const state: RoomState = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    id: opts.id ?? "room-local",
    seed,
    tick: 0,
    rngState: seedToNumber(seed),
    ocean: { radius, seabedY, surfaceY },
    snakes: {},
    food: [],
    rockets: [],
    explosions: [],
    frenzyUntilTick: 0,
  };
  for (let i = 0; i < PREY_BUDGET.ambient; i += 1) spawnAmbientFood(state);
  return state;
}

// ── RNG helpers (thread state through the snapshot) ─────────────────────────────
function rand(state: RoomState): number {
  const [v, next] = nextRandom(state.rngState);
  state.rngState = next;
  return v;
}

function randRange(state: RoomState, min: number, max: number): number {
  return min + rand(state) * (max - min);
}

function randomY(state: RoomState, margin = 2): number {
  return randRange(state, state.ocean.seabedY + margin, state.ocean.surfaceY - margin);
}

/** A uniform random point inside the playable ocean cylinder. */
function randomPointInOcean(state: RoomState): Vec3 {
  const r = Math.sqrt(rand(state)) * (state.ocean.radius - 2);
  const a = rand(state) * Math.PI * 2;
  return { x: Math.cos(a) * r, y: randomY(state), z: Math.sin(a) * r };
}

/** A random point inside the central horizontal region and water column. */
function randomPointNearCenter(state: RoomState): Vec3 {
  const r = Math.sqrt(rand(state)) * state.ocean.radius * CENTER_FOOD_RADIUS;
  const a = rand(state) * Math.PI * 2;
  return { x: Math.cos(a) * r, y: randomY(state), z: Math.sin(a) * r };
}

function schoolOrientation(school: number, tick: number): { yaw: number; pitch: number } {
  const phase = school * 2.399963229728653;
  return {
    yaw: normalizeYaw(phase + Math.sin(tick * 0.025 + school * 0.61) * 0.55),
    pitch: Math.sin(tick * 0.018 + school * 0.83) * 0.22,
  };
}

function spawnAmbientFood(state: RoomState): void {
  const middle = rand(state) < CENTER_FOOD_SHARE;
  const p = middle ? randomPointNearCenter(state) : randomPointInOcean(state);
  const kind: PreyKind = rand(state) < 0.78 ? "bait" : "reef";
  const school = Math.floor(rand(state) * PREY_BUDGET.schools);
  const orientation = schoolOrientation(school, state.tick);
  const spec = PREY_SPECS[kind];
  state.food.push({
    id: `prey-${state.tick}-${Math.floor(rand(state) * 1e9).toString(36)}`,
    kind,
    x: p.x,
    y: p.y,
    z: p.z,
    value: spec.value,
    r: spec.r,
    yaw: orientation.yaw,
    pitch: orientation.pitch,
    school,
  });
}

function stepPrey(state: RoomState): void {
  const horizontalWarning = Math.max(2, state.ocean.radius - PREY_BUDGET.boundaryMargin * 3);
  const horizontalWarningSq = horizontalWarning * horizontalWarning;
  const livingHeads = Object.values(state.snakes)
    .filter((shark) => shark.alive && shark.segments[0])
    .slice(0, PREY_BUDGET.maxSharksForFlee)
    .map((shark) => shark.segments[0]);

  for (const prey of state.food) {
    const spec = PREY_SPECS[prey.kind];
    let target = prey.school >= 0
      ? schoolOrientation(prey.school, state.tick)
      : { yaw: prey.yaw, pitch: prey.kind === "carcass" ? -0.08 : prey.pitch };
    let speed = spec.speed;

    if (spec.fleeRadius > 0 && livingHeads.length) {
      let nearest: Vec3 | null = null;
      let nearestDistanceSq = spec.fleeRadius * spec.fleeRadius;
      for (const head of livingHeads) {
        const d2 = distanceSquared3(prey, head);
        if (d2 < nearestDistanceSq) {
          nearestDistanceSq = d2;
          nearest = head;
        }
      }
      if (nearest) {
        target = yawPitchToward(nearest, prey);
        speed *= spec.fleeMultiplier;
      }
    }

    if (horizontalRadiusSquared(prey) > horizontalWarningSq) {
      target.yaw = Math.atan2(-prey.z, -prey.x);
    }
    if (prey.y > state.ocean.surfaceY - PREY_BUDGET.boundaryMargin * 1.5) {
      target.pitch = Math.min(target.pitch, -0.24);
    } else if (prey.y < state.ocean.seabedY + PREY_BUDGET.boundaryMargin * 1.5) {
      target.pitch = Math.max(target.pitch, 0.24);
    }

    prey.yaw = rotateYawToward(prey.yaw, target.yaw, spec.turnRate);
    prey.pitch = clampPitch(moveToward(prey.pitch, target.pitch, spec.pitchRate));
    const direction = forwardFromYawPitch(prey.yaw, prey.pitch);
    const next = clampToOceanVolume({
      x: prey.x + direction.x * speed,
      y: prey.y + direction.y * speed,
      z: prey.z + direction.z * speed,
    }, state.ocean, PREY_BUDGET.boundaryMargin);
    prey.x = next.x;
    prey.y = next.y;
    prey.z = next.z;
  }
}

// ── Snake construction ──────────────────────────────────────────────────────────
/** Pick a spawn in the inner ocean volume, as far as possible from living shark segments. */
function safeSpawn(state: RoomState): Vec3 {
  const inner = state.ocean.radius * 0.72;
  const occupied: Array<{ p: Vec3; weight: number }> = [];
  for (const s of Object.values(state.snakes)) {
    if (!s.alive) continue;
    const weight = 1 + Math.min(3, s.length / (START_LENGTH * 2));
    for (let i = 0; i < s.segments.length; i += 3) occupied.push({ p: s.segments[i], weight });
  }

  let best: Vec3 = {
    x: 0,
    y: (state.ocean.seabedY + state.ocean.surfaceY) / 2,
    z: 0,
  };
  let bestDist = -1;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const r = Math.sqrt(rand(state)) * inner;
    const a = rand(state) * Math.PI * 2;
    const p: Vec3 = { x: Math.cos(a) * r, y: randomY(state), z: Math.sin(a) * r };
    let nearest = Infinity;
    for (const o of occupied) nearest = Math.min(nearest, distance3(o.p, p) / o.weight);
    if (nearest > bestDist) {
      bestDist = nearest;
      best = p;
      if (nearest > 12 || occupied.length === 0) break;
    }
  }
  return best;
}

/** Number of body discs a snake of the given target length should show. */
export function segmentCount(length: number): number {
  return 1; // sharks grow by scale, not by adding a long segmented body
}

/** Movement model shared with the client so client-side prediction uses identical math.
 *  Values are per authoritative tick; multiply by TICKS_PER_SECOND for per-second rates. */
export const MOVE = {
  BASE_SPEED,
  BOOST_SPEED,
  TURN_RATE,
  PITCH_RATE,
  SEGMENT_SPACING,
  MIN_LENGTH,
  FRENZY_SPEED,
} as const;

/**
 * Deterministic forward speed envelope for the existing dash/lunge state.
 * It uses only lungeTicks, so schema-8 snapshots/replays need no new velocity field.
 */
export function swimSpeedForLungeTicks(lungeTicks: number): number {
  const ticks = Math.max(0, Math.min(DASH_TICKS, Math.floor(Number.isFinite(lungeTicks) ? lungeTicks : 0)));
  if (ticks === 0) return BASE_SPEED;
  const elapsed = DASH_TICKS - ticks;
  const accel = Math.min(1, (elapsed + 1) / DASH_ACCEL_TICKS);
  const decel = Math.min(1, ticks / DASH_DECEL_TICKS);
  const envelope = Math.min(accel, decel);
  return BASE_SPEED + (BOOST_SPEED - BASE_SPEED) * envelope;
}

/** Sample `count` evenly-spaced points by walking a head-first trail at SEGMENT_SPACING
 *  arc-length steps (interpolating between breadcrumbs). Pure — reused by the server
 *  simulation and by client-side prediction. `fallbackHeading` extends the tail when the
 *  trail is too short (fresh spawn). Returns points head-first. */
export function sampleTrail(
  path: Vec3[],
  count: number,
  fallbackYaw: number,
  fallbackPitch = 0,
): Vec3[] {
  const out: Vec3[] = [{ x: path[0].x, y: path[0].y, z: path[0].z }];
  let seg = 1;
  let acc = 0;
  for (let i = 0; i < path.length - 1 && seg < count; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const edge = distance3(a, b);
    if (edge <= 1e-6) continue;
    let along = 0;
    while (acc + (edge - along) >= SEGMENT_SPACING && seg < count) {
      const need = SEGMENT_SPACING - acc;
      along += need;
      const f = along / edge;
      out.push({
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
      });
      seg += 1;
      acc = 0;
    }
    acc += edge - along;
  }

  const fallback = forwardFromYawPitch(fallbackYaw, fallbackPitch);
  while (out.length < count) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    const back = prev
      ? { x: last.x - prev.x, y: last.y - prev.y, z: last.z - prev.z }
      : { x: -fallback.x, y: -fallback.y, z: -fallback.z };
    const length = Math.sqrt(back.x * back.x + back.y * back.y + back.z * back.z) || 1;
    out.push({
      x: last.x + (back.x / length) * SEGMENT_SPACING,
      y: last.y + (back.y / length) * SEGMENT_SPACING,
      z: last.z + (back.z / length) * SEGMENT_SPACING,
    });
  }
  return out;
}

/** Rebuild a snake's body segments from its head trail (server-side). */
function resampleSegments(snake: Snake): void {
  snake.segments = sampleTrail(snake.path, segmentCount(snake.length), snake.yaw, snake.pitch);
}

/** Median length across living sharks — the yardstick a fresh spawn is sized against. */
function medianLivingLength(state: RoomState): number {
  const lengths = Object.values(state.snakes).filter((s) => s.alive).map((s) => s.length).sort((a, b) => a - b);
  if (lengths.length === 0) return START_LENGTH;
  const middle = lengths.length >> 1;
  return lengths.length % 2 ? lengths[middle] : (lengths[middle - 1] + lengths[middle]) / 2;
}

function spawnLength(state: RoomState): number {
  return Math.min(MAX_SPAWN_LENGTH, Math.max(START_LENGTH, medianLivingLength(state) * SPAWN_MEDIAN_SHARE));
}

export function spawnOrientationForPoint(
  spawn: Vec3,
  ocean: OceanVolume,
  yawJitter = 0,
): { yaw: number; pitch: number } {
  const yaw = normalizeYaw(Math.atan2(-spawn.z, -spawn.x) + yawJitter);
  const middleY = (ocean.seabedY + ocean.surfaceY) / 2;
  const horizontalDistance = Math.max(8, Math.sqrt(spawn.x * spawn.x + spawn.z * spawn.z));
  const pitchToMiddle = Math.atan2(middleY - spawn.y, horizontalDistance);
  const pitch = clampPitch(Math.max(-0.35, Math.min(0.35, pitchToMiddle)));
  return { yaw, pitch };
}

function makeSnake(state: RoomState, id: string, name: string, skin: string, isBot: boolean): Snake {
  const spawn = safeSpawn(state);
  const length = spawnLength(state);
  const { yaw, pitch } = spawnOrientationForPoint(spawn, state.ocean, randRange(state, -0.5, 0.5));
  const backward = forwardFromYawPitch(yaw, pitch);
  const path: Vec3[] = [];
  const trailStep = SEGMENT_SPACING;
  for (let i = 0; i < START_LENGTH + 3; i += 1) {
    path.push({
      x: spawn.x - backward.x * i * trailStep,
      y: spawn.y - backward.y * i * trailStep,
      z: spawn.z - backward.z * i * trailStep,
    });
  }
  const snake: Snake = {
    id,
    name,
    skin: validSkin(skin),
    path,
    segments: [],
    yaw,
    pitch,
    targetYaw: yaw,
    targetPitch: pitch,
    length,
    boosting: false,
    chargeTicks: 0,
    lungeTicks: 0,
    dashCooldownTick: 0,
    rocketTicks: 0,
    rocketCooldownTick: 0,
    score: 0,
    alive: true,
    isBot,
    respawnTick: 0,
    invulnTick: state.tick + SPAWN_GRACE,
  };
  resampleSegments(snake);
  return snake;
}

function validSkin(skin: string | undefined): string {
  return SKINS.some((s) => s.id === skin) ? (skin as string) : DEFAULT_SKIN;
}

/** Fill the arena with `n` bot snakes (server-side AI opponents). */
export function spawnBots(state: RoomState, n: number): void {
  for (let i = 0; i < n; i += 1) {
    const id = `bot-${i}`;
    if (state.snakes[id]) continue;
    const name = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ` ${Math.floor(i / BOT_NAMES.length) + 1}` : "");
    const skin = SKINS[Math.floor(rand(state) * SKINS.length)].id;
    state.snakes[id] = makeSnake(state, id, name, skin, true);
  }
}

// ── Feeding Frenzy ───────────────────────────────────────────────────────────────
/** True while the tank is in a Feeding Frenzy. Shared with the client HUD/renderer. */
export function isFrenzy(state: { tick: number; frenzyUntilTick?: number }): boolean {
  return (state.frenzyUntilTick ?? 0) > state.tick;
}

/** Ticks left in the current frenzy (0 when none is running). */
export function frenzyTicksLeft(state: { tick: number; frenzyUntilTick?: number }): number {
  return Math.max(0, (state.frenzyUntilTick ?? 0) - state.tick);
}

/** Fat, high-value chum shower dropped in the middle when a frenzy opens. */
function dropChum(state: RoomState): void {
  const centerY = (state.ocean.seabedY + state.ocean.surfaceY) / 2;
  const halfDepth = (state.ocean.surfaceY - state.ocean.seabedY) * 0.18;
  for (let i = 0; i < FRENZY_CHUM; i += 1) {
    const angle = (i / FRENZY_CHUM) * Math.PI * 2 + randRange(state, -0.3, 0.3);
    const radius = randRange(state, 0.8, state.ocean.radius * CENTER_FOOD_RADIUS * 0.9);
    const school = i % Math.min(8, PREY_BUDGET.schools);
    const orientation = schoolOrientation(school, state.tick);
    state.food.push({
      id: `chum-${state.tick}-${i}`,
      kind: "chum",
      x: Math.cos(angle) * radius,
      y: randRange(state, centerY - halfDepth, centerY + halfDepth),
      z: Math.sin(angle) * radius,
      value: i % 3 === 0 ? 5 : PREY_SPECS.chum.value,
      r: i % 3 === 0 ? 0.95 : PREY_SPECS.chum.r,
      yaw: orientation.yaw,
      pitch: orientation.pitch,
      school,
    });
  }
  state.explosions ??= [];
  state.explosions.push({
    id: `chum-burst-${state.tick}`,
    x: 0,
    y: centerY,
    z: 0,
    tick: state.tick,
    skin: "gold",
    kind: "rocket",
  });
}

/** Open a frenzy on schedule. Purely tick-driven so replays reproduce it exactly. */
function stepFrenzy(state: RoomState): void {
  state.frenzyUntilTick ??= 0;
  if (state.tick % FRENZY_PERIOD !== 0 || state.tick === 0) return;
  state.frenzyUntilTick = state.tick + FRENZY_TICKS;
  dropChum(state);
}

// ── Actions ──────────────────────────────────────────────────────────────────────
export function applyAction(state: RoomState, action: Action): RoomState {
  switch (action.type) {
    case "join": {
      if (!state.snakes[action.playerId]) {
        state.snakes[action.playerId] = makeSnake(
          state,
          action.playerId,
          (action.name ?? "Player").slice(0, 16),
          action.skin ?? DEFAULT_SKIN,
          action.isBot ?? false,
        );
      }
      return state;
    }
    case "leave": {
      const s = state.snakes[action.playerId];
      if (s) scatterAsFood(state, s); // dropping out feeds the arena, like a death
      delete state.snakes[action.playerId];
      return state;
    }
    case "setOrientation": {
      const s = state.snakes[action.playerId];
      if (s && s.alive && Number.isFinite(action.yaw) && Number.isFinite(action.pitch)) {
        s.targetYaw = normalizeYaw(action.yaw);
        s.targetPitch = clampPitch(action.pitch);
      }
      return state;
    }
    case "setBoost": {
      const s = state.snakes[action.playerId];
      if (s && s.alive) {
        // Space/click is an immediate, server-timed impact dash. The two-second
        // cooldown is authoritative, so key repeat and packet spam cannot bypass it.
        s.dashCooldownTick ??= 0;
        if (action.on && state.tick >= s.dashCooldownTick) {
          s.lungeTicks = DASH_TICKS;
          // A frenzy halves the dash cooldown, which is what makes the twenty seconds
          // feel different rather than just looking different.
          s.dashCooldownTick = state.tick + Math.round(DASH_COOLDOWN_TICKS * (isFrenzy(state) ? 0.5 : 1));
        }
        s.chargeTicks = 0;
        s.boosting = false;
      }
      return state;
    }
    case "rocket": {
      const s = state.snakes[action.playerId];
      if (s?.alive && !s.isBot && s.segments[0] && state.tick >= (s.rocketCooldownTick ?? 0)) {
        const head = s.segments[0];
        const lead = 2.5;
        const forward = forwardFromYawPitch(s.yaw, s.pitch);
        state.rockets ??= [];
        state.rockets.push({
          id: `rocket-${s.id}-${state.tick}`,
          ownerId: s.id,
          x: head.x + forward.x * lead,
          y: head.y + forward.y * lead,
          z: head.z + forward.z * lead,
          yaw: s.yaw,
          pitch: s.pitch,
          expiresTick: state.tick + ROCKET_LIFETIME_TICKS,
        });
        s.rocketTicks = 6;
        s.rocketCooldownTick = state.tick + ROCKET_COOLDOWN_TICKS;
      }
      return state;
    }
    case "respawn": {
      const s = state.snakes[action.playerId];
      if (s && !s.alive && state.tick >= s.respawnTick) {
        const fresh = makeSnake(state, s.id, s.name, s.skin, s.isBot);
        state.snakes[s.id] = fresh;
      }
      return state;
    }
    default:
      return state;
  }
}

// ── Simulation step ────────────────────────────────────────────────────────────
/** Advance the simulation by one tick. Mutates and returns `state`. */
export function step(state: RoomState): RoomState {
  state.tick += 1;
  state.rockets ??= [];
  state.explosions ??= [];
  state.explosions = state.explosions.filter((burst) => state.tick - burst.tick < EXPLOSION_TICKS);

  // Frenzy scheduling runs first so this tick's movement already uses the new speed.
  stepFrenzy(state);

  // Ambient prey top-up. Population and spawn work remain explicitly bounded.
  for (let i = 0; i < PREY_BUDGET.spawnPerTick && state.food.length < PREY_BUDGET.ambient; i += 1) {
    spawnAmbientFood(state);
  }

  // Prey movement is authoritative and deterministic. Client animation only interpolates this state.
  stepPrey(state);

  // Bots choose their current compatibility orientation before movement.
  for (const s of Object.values(state.snakes)) {
    if (s.alive && s.isBot) steerBot(state, s);
  }

  // Move every living snake.
  for (const s of Object.values(state.snakes)) {
    if (s.alive) moveSnake(state, s);
  }

  // Rockets are real projectiles: server-authoritative, lethal, and swept against
  // each target so their deliberately high speed cannot tunnel through a shark.
  stepRockets(state);

  // Eating.
  for (const s of Object.values(state.snakes)) {
    if (s.alive) eat(state, s);
  }

  // Contact combat is size-ordered: the larger shark consumes the smaller. Rockets
  // are resolved first and remain lethal regardless of size or spawn protection.
  resolveSharkCollisions(state);

  // Always-on rivals must not snowball across a long-lived Durable Object until a
  // fresh player has no practical opening. A bot that clears the demo-scale score
  // target bursts into food, then returns through the normal fast respawn path.
  for (const s of Object.values(state.snakes)) {
    if (s.isBot && s.alive && s.score >= BOT_RETIRE_SCORE) killSnake(state, s);
  }

  // Bots auto-respawn after their delay so the arena stays populated (~24 snakes).
  for (const s of Object.values(state.snakes)) {
    if (s.isBot && !s.alive && state.tick >= s.respawnTick) {
      state.snakes[s.id] = makeSnake(state, s.id, s.name, s.skin, true);
    }
  }

  // Cap total food (corpse drops otherwise pile up into thousands of dots) — drop oldest.
  if (state.food.length > PREY_BUDGET.max) state.food.splice(0, state.food.length - PREY_BUDGET.max);

  return state;
}

function moveSnake(state: RoomState, s: Snake): void {
  s.yaw = rotateYawToward(s.yaw, s.targetYaw, TURN_RATE);
  s.pitch = clampPitch(moveToward(s.pitch, s.targetPitch, PITCH_RATE));

  let speed = swimSpeedForLungeTicks(s.lungeTicks);
  s.chargeTicks ??= 0;
  s.lungeTicks ??= 0;
  s.dashCooldownTick ??= 0;
  s.rocketTicks ??= 0;
  s.rocketCooldownTick ??= 0;
  if (s.boosting) s.chargeTicks = Math.min(16, s.chargeTicks + 1);
  if (s.lungeTicks > 0) s.lungeTicks -= 1;
  if (s.rocketTicks > 0) s.rocketTicks -= 1;
  if (isFrenzy(state)) speed *= FRENZY_SPEED;

  const head = s.path[0];
  const forward = forwardFromYawPitch(s.yaw, s.pitch);
  const rawY = head.y + forward.y * speed;
  const y = Math.max(state.ocean.seabedY, Math.min(state.ocean.surfaceY, rawY));
  if (y !== rawY) {
    s.pitch = 0;
    s.targetPitch = 0;
  }
  s.path.unshift({
    x: head.x + forward.x * speed,
    y,
    z: head.z + forward.z * speed,
  });

  const needLen = segmentCount(s.length) * SEGMENT_SPACING + TAIL_MARGIN;
  let acc = 0;
  let cut = s.path.length;
  for (let i = 1; i < s.path.length; i += 1) {
    acc += distance3(s.path[i], s.path[i - 1]);
    if (acc >= needLen) {
      cut = i + 1;
      break;
    }
  }
  if (s.path.length > cut) s.path.length = cut;
  resampleSegments(s);
}

function eat(state: RoomState, s: Snake): void {
  const head = s.segments[0];
  const maxChomps = s.isBot ? 1 : MAX_CHOMPS_PER_TICK;
  let chomps = 0;
  state.food = state.food.filter((f) => {
    const foodPosition: Vec3 = { x: f.x, y: f.y, z: f.z };
    if (chomps < maxChomps && distance3(foodPosition, head) <= EAT_RADIUS + f.r) {
      chomps += 1;
      s.score += f.value;
      s.length += Math.min(0.6, f.value * 0.18);
      return false;
    }
    return true;
  });
}

function resolveSharkCollisions(state: RoomState): void {
  const living = Object.values(state.snakes).filter((shark) => shark.alive && shark.segments[0]);
  const radiusSq = state.ocean.radius * state.ocean.radius;
  for (const shark of living) {
    const head = shark.segments[0];
    if (shark.alive && horizontalRadiusSquared(head) >= radiusSq) killSnake(state, shark);
  }

  for (let i = 0; i < living.length; i += 1) {
    const a = living[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < living.length; j += 1) {
      const b = living[j];
      if (!b.alive || state.tick < a.invulnTick || state.tick < b.invulnTick) continue;
      const radiusA = HEAD_RADIUS + Math.min(1.15, Math.sqrt(a.length) * 0.075);
      const radiusB = HEAD_RADIUS + Math.min(1.15, Math.sqrt(b.length) * 0.075);
      const headA = a.segments[0];
      const headB = b.segments[0];
      if (distanceSquared3(headA, headB) > (radiusA + radiusB) ** 2) continue;

      const difference = a.length - b.length;
      const consumeAdvantage = Math.max(3, Math.min(a.length, b.length) * 0.2);
      if (Math.abs(difference) <= consumeAdvantage) {
        const apartA = distanceSquared3(headA, headB) > 1e-9
          ? yawPitchToward(headB, headA)
          : { yaw: a.yaw, pitch: 0 };
        const apartB = { yaw: normalizeYaw(apartA.yaw + Math.PI), pitch: -apartA.pitch };
        a.yaw = a.targetYaw = apartA.yaw;
        a.pitch = a.targetPitch = apartA.pitch;
        b.yaw = b.targetYaw = apartB.yaw;
        b.pitch = b.targetPitch = apartB.pitch;
        continue;
      }

      const winner = difference > 0 ? a : b;
      const smaller = difference > 0 ? b : a;
      winner.score += Math.max(3, Math.round(smaller.length * 0.15));
      winner.length += Math.min(1.5, Math.max(0.5, smaller.length * 0.035));
      killSnake(state, smaller);
      if (!a.alive) break;
    }
  }
}

function killSnake(state: RoomState, s: Snake): void {
  const head = s.segments[0] ?? s.path[0];
  if (head) {
    state.explosions ??= [];
    state.explosions.push({
      id: `shark-burst-${s.id}-${state.tick}`,
      x: head.x,
      y: head.y,
      z: head.z,
      tick: state.tick,
      skin: s.skin,
      kind: "shark",
    });
  }
  scatterAsFood(state, s);
  s.alive = false;
  s.boosting = false;
  s.chargeTicks = 0;
  s.lungeTicks = 0;
  s.rocketTicks = 0;
  s.respawnTick = state.tick + RESPAWN_DELAY;
  s.segments = [];
}

/** Turn a shark into bounded, collectible carcass pieces without using presentation geometry for collision. */
function scatterAsFood(state: RoomState, s: Snake): void {
  const head = s.segments[0] ?? s.path[0];
  if (!head) return;
  const count = Math.min(42, 24 + Math.floor(Math.sqrt(Math.max(0, s.length)) * 2));
  for (let i = 0; i < count; i += 1) {
    const yaw = (i / count) * Math.PI * 2 + randRange(state, -0.16, 0.16);
    const pitch = randRange(state, -0.55, 0.55);
    const radius = randRange(state, 0.6, 5.6);
    const direction = forwardFromYawPitch(yaw, pitch);
    const point = clampToOceanVolume({
      x: head.x + direction.x * radius,
      y: head.y + direction.y * radius,
      z: head.z + direction.z * radius,
    }, state.ocean, 0.25);
    state.food.push({
      id: `carcass-${s.id}-${state.tick}-${i}`,
      kind: "carcass",
      x: point.x,
      y: point.y,
      z: point.z,
      value: i % 6 === 0 ? 2 : PREY_SPECS.carcass.value,
      r: i % 6 === 0 ? 0.72 : PREY_SPECS.carcass.r,
      yaw,
      pitch,
      school: -1,
    });
  }
}

function stepRockets(state: RoomState): void {
  const active: RocketProjectile[] = [];
  for (const rocket of state.rockets) {
    const from: Vec3 = { x: rocket.x, y: rocket.y, z: rocket.z };
    const forward = forwardFromYawPitch(rocket.yaw, rocket.pitch);
    const to: Vec3 = {
      x: from.x + forward.x * ROCKET_SPEED,
      y: from.y + forward.y * ROCKET_SPEED,
      z: from.z + forward.z * ROCKET_SPEED,
    };

    let hit: Snake | null = null;
    for (const shark of Object.values(state.snakes)) {
      if (!shark.alive || shark.id === rocket.ownerId || !shark.segments[0]) continue;
      const hitRadius = 1.25 + Math.min(1.35, Math.sqrt(shark.length) * 0.1);
      if (distancePointToSegmentSquared3(shark.segments[0], from, to) <= hitRadius * hitRadius) {
        hit = shark;
        break;
      }
    }

    if (hit) {
      const owner = state.snakes[rocket.ownerId];
      if (owner?.alive) owner.score += 10;
      killSnake(state, hit);
      continue;
    }

    rocket.x = to.x;
    rocket.y = to.y;
    rocket.z = to.z;
    const expired = state.tick >= rocket.expiresTick || !isInsideOceanVolume(to, state.ocean);
    if (expired) {
      state.explosions.push({
        id: `rocket-burst-${rocket.id}-${state.tick}`,
        x: to.x,
        y: to.y,
        z: to.z,
        tick: state.tick,
        skin: "orange",
        kind: "rocket",
      });
    } else {
      active.push(rocket);
    }
  }
  state.rockets = active;
}

// ── Bot AI ───────────────────────────────────────────────────────────────────────
function steerBot(state: RoomState, s: Snake): void {
  const head = s.segments[0];
  const radiusSq = horizontalRadiusSquared(head);

  if (radiusSq > (state.ocean.radius * 0.8) ** 2) {
    s.targetYaw = Math.atan2(-head.z, -head.x);
    s.targetPitch = 0;
    s.boosting = false;
    s.chargeTicks = 0;
    return;
  }

  const sight = isFrenzy(state) ? 34 : 22;
  let best: Prey | null = null;
  let bestD = Infinity;
  for (const f of state.food) {
    const d = distance3({ x: f.x, y: f.y, z: f.z }, head);
    if (d < bestD && d < sight) {
      bestD = d;
      best = f;
    }
  }
  if (best) {
    // ST-120 compatibility only: bots may point at the selected authoritative prey in
    // depth so moving fish remain consumable. ST-121 owns volumetric navigation,
    // avoidance, threat assessment and tactical hunting.
    const target = yawPitchToward(head, best);
    s.targetYaw = target.yaw;
    s.targetPitch = target.pitch;
  } else if (isFrenzy(state)) {
    s.targetYaw = Math.atan2(-head.z, -head.x);
    s.targetPitch = 0;
  } else if ((state.tick + botPhase(s.id)) % 20 === 0) {
    s.targetYaw = randRange(state, -Math.PI, Math.PI);
    s.targetPitch = 0;
  }

  s.dashCooldownTick ??= 0;
  const wantsLunge = best !== null && bestD < 8 && best.value >= 2;
  if (wantsLunge && state.tick >= s.dashCooldownTick && !s.boosting && s.lungeTicks === 0) s.boosting = true;
  if (s.boosting && s.chargeTicks >= 6) {
    s.boosting = false;
    s.chargeTicks = 0;
    s.lungeTicks = 6;
    s.dashCooldownTick = state.tick + TICKS_PER_SECOND * 6;
  }
}

/** Stable per-bot offset so wander turns are staggered across the tank. */
function botPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 20;
  return h;
}

// ── Derived views ────────────────────────────────────────────────────────────────
/** Leaderboard rows, highest score first. */
export function leaderboard(state: RoomState, limit = 10): ScoreEntry[] {
  return Object.values(state.snakes)
    .map((s) => ({ id: s.id, name: s.name, skin: s.skin, score: s.score, alive: s.alive }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function playerCount(state: RoomState): number {
  return Object.values(state.snakes).filter((s) => !s.isBot).length;
}

// ── Deterministic replay ──────────────────────────────────────────────────────────
/** One recorded external action + the tick it was applied at. Bot behaviour is NOT
 *  logged — it's reproduced deterministically by re-running step() with the same seed. */
export interface GameLogEntry {
  tick: number;
  action: Action;
}

export interface ReplayOptions {
  seed: string;
  id?: string;
  botCount: number;
}

/**
 * Rebuild the exact RoomState at `toTick` from a game's seed + external action log.
 * Because the engine is fully deterministic (seeded RNG in the snapshot, no wall-clock
 * or Math.random), replaying the same seed + the same actions at the same ticks yields
 * byte-identical state — enabling per-game fast-forward and rollback. Pass a smaller
 * `toTick` to roll back; a larger one (≤ the last logged tick) to fast-forward.
 */
export function replay(opts: ReplayOptions, events: GameLogEntry[], toTick: number): RoomState {
  const state = createRoom({ seed: opts.seed, id: opts.id });
  spawnBots(state, opts.botCount);

  const byTick = new Map<number, Action[]>();
  for (const e of events) {
    const list = byTick.get(e.tick);
    if (list) list.push(e.action);
    else byTick.set(e.tick, [e.action]);
  }

  for (let t = 0; t <= toTick; t += 1) {
    const acts = byTick.get(t);
    if (acts) for (const a of acts) applyAction(state, a);
    if (t < toTick) step(state);
  }
  return state;
}

/** Deep clone a snapshot (structured, JSON-safe). Handy for React state updates. */
export function cloneRoom(state: RoomState): RoomState {
  return JSON.parse(JSON.stringify(state)) as RoomState;
}
