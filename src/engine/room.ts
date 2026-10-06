// Engine core — deterministic full-3D shark room simulation.
// Pure functions over serializable RoomState (no DOM, no three.js, no node APIs),
// so the exact same code runs in the browser (bots/preview) and in the authoritative
// Room Durable Object. RNG state lives in the snapshot, so the whole thing is replayable.

import {
  clampPitch,
  clampToOceanVolume,
  distance3,
  distanceSquared3,
  forwardFromYawPitch,
  horizontalRadiusSquared,
  moveToward,
  normalizeYaw,
  rotateYawToward,
  yawPitchToward,
} from "./geometry3d.js";
import { nextRandom, seedToNumber } from "./rng.js";
import type { Action, DeathAction, OceanVolume, Prey, PreyKind, RoomState, RoundState, ScoreEntry, Snake, Vec3 } from "./types.js";

// ── Tuning ────────────────────────────────────────────────────────────────────
// Ticking at 30Hz (vs 20) means fresher snapshots → less perceived lag. Per-tick speeds
// are scaled so world-per-second speed/turn stay constant; client prediction derives its
// per-second rates from MOVE × TICKS_PER_SECOND, so it stays exactly in sync.
export const TICKS_PER_SECOND = 20; // responsive authority; shark snapshots contain only one body point
// 32 sharks share a tank, so the arena grew with the population — enough water that a
// full lobby is dense rather than a permanent scrum at the wall.
// Wire-state schema identity remains 11 until the queued protocol cut-over; RoomState itself is no longer persisted.
export const ROOM_SCHEMA_VERSION = 11 as const;
const OCEAN_RADIUS = 82;
export const DEFAULT_SEABED_Y = -12;
export const DEFAULT_SURFACE_Y = 12;
const BASE_SPEED = 0.556; // world units / tick (~11 u/s)
const BOOST_SPEED = 1.42; // (~28 u/s) — short, high-impact chomp dash
const TURN_RATE = 0.22; // max yaw radians / tick (~4.4 rad/s)
const PITCH_RATE = 0.16; // max pitch radians / tick (~3.2 rad/s), calmer near surface/floor
const START_LENGTH = 10;
/** A fresh shark enters at the size of the field, not at the size of an empty tank.
 *  In a 32-shark arena the bots are already 3-5× a bare spawn by the time a human
 *  joins, so a flat START_LENGTH meant every new life was eaten within seconds by the
 *  middle of the pack. Spawn size now tracks the median living shark, capped so the
 *  biggest sharks still out-rank a newcomer and the tank cannot inflate itself. */
const SPAWN_MEDIAN_SHARE = 0.45;
const MAX_SPAWN_LENGTH = START_LENGTH * 2.6;
const MIN_LENGTH = 6; // can't boost below this
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
// This is authoritative gameplay, not presentation tuning. The shared values let the
// client explain server truth without inventing its own schedule, volume, or modifiers.
export const FRENZY_RULES = {
  periodTicks: TICKS_PER_SECOND * 75,
  durationTicks: TICKS_PER_SECOND * 20,
  speedMultiplier: 1.16,
  dashCooldownMultiplier: 0.5,
  volumeRadiusShare: 0.3,
  volumeHalfHeightShare: 0.32,
  placementInset: 0.88,
  chumCount: PREY_BUDGET.frenzyChum,
  baseChumValue: PREY_SPECS.chum.value,
  bonusChumValue: 5,
  bonusChumEvery: 3,
} as const;

interface FrenzyVolume {
  center: Vec3;
  radius: number;
  halfHeight: number;
}

const FRENZY_PERIOD = FRENZY_RULES.periodTicks;
const FRENZY_TICKS = FRENZY_RULES.durationTicks;
const FRENZY_SPEED = FRENZY_RULES.speedMultiplier;
const FRENZY_CHUM = FRENZY_RULES.chumCount;

export const ROUND_RULES = {
  activeTicks: TICKS_PER_SECOND * 5 * 60,
  apexTicks: TICKS_PER_SECOND * 45,
  resultTicks: TICKS_PER_SECOND * 10,
  apexSpeedMultiplier: 1.08,
  apexKillBonusScore: 12,
  apexKillBonusGrowth: 1.2,
} as const;
// With 24 bots in the tank, a high retire score let two or three monsters accumulate and
// farm every fresh spawn. A lower ceiling keeps the size ladder climbable.
const BOT_RETIRE_SCORE = 240;
export const BOT_AI_BUDGET = {
  targetPopulation: 24,
  maxTrackedSharks: 32,
  preySight: 24,
  frenzySight: 40,
  threatRadius: 15,
  huntRadius: 19,
  burstRange: 9,
  escapeBurstRange: 8,
  boundaryMargin: 10,
  verticalMargin: 4.5,
  threatLengthRatio: 1.3,
  huntLengthRatio: 1.25,
  wanderInterval: 20,
  wanderPitch: 0.45,
} as const;
const DASH_TICKS = 10;
const DASH_ACCEL_TICKS = 3;
const DASH_DECEL_TICKS = 4;
const DASH_COOLDOWN_TICKS = TICKS_PER_SECOND * 2;
const EXPLOSION_TICKS = 24;

export const COMBAT = {
  maxHealth: 100,
  biteCooldownTicks: 14,
  biteRange: 3.4,
  biteRangeLengthScale: 0.02,
  biteRangeSizeBonusMax: 0.8,
  biteConeCos: Math.cos(Math.PI * (50 / 180)),
  baseDamage: 34,
  minSizeDamageScale: 0.85,
  maxSizeDamageScale: 1.2,
  burstDamageMultiplier: 1.15,
  maxDamage: 42,
  killScoreLengthScale: 0.12,
  killScoreMin: 3,
  killScoreMax: 10,
  killGrowthLengthScale: 0.025,
  killGrowthMin: 0.4,
  killGrowthMax: 1,
} as const;

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

interface CreateRoomOptions {
  id?: string;
  seed?: string;
  oceanRadius?: number;
  seabedY?: number;
  surfaceY?: number;
}

function makeRoundState(number: number, startTick: number): RoundState {
  const endTick = startTick + ROUND_RULES.activeTicks;
  return {
    number,
    phase: "active",
    startTick,
    apexStartTick: endTick - ROUND_RULES.apexTicks,
    endTick,
    resultEndTick: endTick + ROUND_RULES.resultTicks,
    apexId: null,
    result: null,
  };
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
    id: opts.id ?? "room-local",
    seed,
    tick: 0,
    rngState: seedToNumber(seed),
    ocean: { radius, seabedY, surfaceY },
    snakes: {},
    food: [],
    explosions: [],
    frenzyUntilTick: 0,
    round: makeRoundState(1, 0),
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
    .filter((shark) => shark.alive)
    .slice(0, PREY_BUDGET.maxSharksForFlee)
    .map((shark) => shark.position);

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
/** Pick a spawn in the inner ocean volume, as far as possible from living shark positions. */
function safeSpawn(state: RoomState): Vec3 {
  const inner = state.ocean.radius * 0.72;
  const occupied: Array<{ p: Vec3; weight: number }> = [];
  for (const s of Object.values(state.snakes)) {
    if (!s.alive) continue;
    const weight = 1 + Math.min(3, s.length / (START_LENGTH * 2));
    occupied.push({ p: s.position, weight });
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

/** Movement model shared with the client so client-side prediction uses identical math.
 *  Values are per authoritative tick; multiply by TICKS_PER_SECOND for per-second rates. */
export const MOVE = {
  BASE_SPEED,
  BOOST_SPEED,
  TURN_RATE,
  PITCH_RATE,
  MIN_LENGTH,
  FRENZY_SPEED,
} as const;

/**
 * Deterministic forward speed envelope for the existing dash/lunge state.
 * It uses only lungeTicks, so movement needs no separate authoritative velocity field.
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
  const snake: Snake = {
    id,
    name,
    skin: validSkin(skin),
    position: spawn,
    yaw,
    pitch,
    targetYaw: yaw,
    targetPitch: pitch,
    length,
    lungeTicks: 0,
    dashCooldownTick: 0,
    health: COMBAT.maxHealth,
    biteCooldownTick: 0,
    lastDeath: null,
    score: 0,
    alive: true,
    isBot,
    respawnTick: 0,
    invulnTick: state.tick + SPAWN_GRACE,
  };
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
interface FrenzyTiming {
  active: boolean;
  startTick: number | null;
  endTick: number;
  remainingTicks: number;
}

/** The authoritative central event cylinder. Placement and bot navigation share it. */
export function frenzyVolumeFor(ocean: OceanVolume): FrenzyVolume {
  const height = Math.max(2, ocean.surfaceY - ocean.seabedY);
  const desiredHalfHeight = height * FRENZY_RULES.volumeHalfHeightShare;
  const maxHalfHeight = Math.max(0.5, height / 2 - PREY_BUDGET.boundaryMargin);
  return {
    center: { x: 0, y: (ocean.seabedY + ocean.surfaceY) / 2, z: 0 },
    radius: Math.max(2, ocean.radius * FRENZY_RULES.volumeRadiusShare),
    halfHeight: Math.min(desiredHalfHeight, maxHalfHeight),
  };
}

/** Derive active/start/end/remaining state only from authoritative snapshot ticks. */
export function frenzyTiming(state: { tick: number; frenzyUntilTick?: number }): FrenzyTiming {
  const endTick = Math.max(0, Math.trunc(state.frenzyUntilTick ?? 0));
  const active = endTick > state.tick;
  return {
    active,
    startTick: active ? endTick - FRENZY_RULES.durationTicks : null,
    endTick,
    remainingTicks: active ? endTick - state.tick : 0,
  };
}

/** True while the tank is in a Feeding Frenzy. Shared with the client HUD/renderer. */
export function isFrenzy(state: { tick: number; frenzyUntilTick?: number }): boolean {
  return frenzyTiming(state).active;
}


/** Deterministic, vertically stratified chum shower inside the authoritative volume. */
function dropChum(state: RoomState): void {
  const volume = frenzyVolumeFor(state.ocean);
  const depthStep = (volume.halfHeight * 2 * FRENZY_RULES.placementInset) / FRENZY_CHUM;
  for (let i = 0; i < FRENZY_CHUM; i += 1) {
    const angle = (i / FRENZY_CHUM) * Math.PI * 2 + randRange(state, -0.3, 0.3);
    const radius = Math.sqrt(rand(state)) * volume.radius * FRENZY_RULES.placementInset;
    const depthBase = -volume.halfHeight * FRENZY_RULES.placementInset + depthStep * (i + 0.5);
    const y = volume.center.y + depthBase + randRange(state, -depthStep * 0.3, depthStep * 0.3);
    const school = i % Math.min(8, PREY_BUDGET.schools);
    const orientation = schoolOrientation(school, state.tick);
    const bonus = i % FRENZY_RULES.bonusChumEvery === 0;
    state.food.push({
      id: `chum-${state.tick}-${i}`,
      kind: "chum",
      x: Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
      value: bonus ? FRENZY_RULES.bonusChumValue : FRENZY_RULES.baseChumValue,
      r: bonus ? 0.95 : PREY_SPECS.chum.r,
      yaw: orientation.yaw,
      pitch: orientation.pitch,
      school,
    });
  }
  state.explosions ??= [];
  state.explosions.push({
    id: `chum-burst-${state.tick}`,
    x: volume.center.x,
    y: volume.center.y,
    z: volume.center.z,
    tick: state.tick,
    skin: "gold",
    kind: "frenzy",
  });
}

function retireFrenzyFood(state: RoomState): void {
  state.food = state.food.filter((actor) => actor.kind !== "chum");
}

/** Open and close the event from authoritative ticks; expired event food is retired here. */
function openFrenzy(state: RoomState): void {
  retireFrenzyFood(state);
  state.frenzyUntilTick = state.tick + FRENZY_TICKS;
  dropChum(state);
}

function stepFrenzy(state: RoomState): void {
  state.frenzyUntilTick ??= 0;
  if (state.frenzyUntilTick > 0 && state.tick >= state.frenzyUntilTick) {
    retireFrenzyFood(state);
    state.frenzyUntilTick = 0;
  }
  if (state.round.phase === "result") return;

  // The Apex phase ends in one guaranteed shared Feeding Frenzy. Normal periodic
  // frenzies remain active-round pressure; the final one is tied to the round clock.
  if (
    state.round.phase === "apex"
    && state.tick === state.round.endTick - FRENZY_TICKS
  ) {
    openFrenzy(state);
    return;
  }
  if (state.round.phase !== "active" || state.tick % FRENZY_PERIOD !== 0 || state.tick === 0) return;
  openFrenzy(state);
}

function scoreEntries(state: RoomState): ScoreEntry[] {
  return Object.values(state.snakes)
    .map((shark) => ({
      id: shark.id,
      name: shark.name,
      skin: shark.skin,
      score: shark.score,
      alive: shark.alive,
    }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function updateApexLeader(state: RoomState): void {
  if (state.round.phase !== "apex") {
    state.round.apexId = null;
    return;
  }
  state.round.apexId = scoreEntries(state)[0]?.id ?? null;
}

function beginApex(state: RoomState): void {
  state.round.phase = "apex";
  state.round.result = null;
  updateApexLeader(state);
}

function concludeRound(state: RoomState): void {
  const winner = scoreEntries(state)[0] ?? null;
  state.round.phase = "result";
  state.round.apexId = null;
  state.round.result = {
    roundNumber: state.round.number,
    winner,
    endedTick: state.tick,
  };
  retireFrenzyFood(state);
  state.frenzyUntilTick = 0;
  for (const shark of Object.values(state.snakes)) {
    shark.lungeTicks = 0;
    shark.targetYaw = shark.yaw;
    shark.targetPitch = shark.pitch;
  }
}

function resetCompetitiveRound(state: RoomState): void {
  const identities = Object.values(state.snakes)
    .map((shark) => ({ id: shark.id, name: shark.name, skin: shark.skin, isBot: shark.isBot }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const nextNumber = state.round.number + 1;

  state.snakes = {};
  state.food = [];
  state.explosions = [];
  state.frenzyUntilTick = 0;
  state.round = makeRoundState(nextNumber, state.tick);

  for (const identity of identities) {
    state.snakes[identity.id] = makeSnake(
      state,
      identity.id,
      identity.name,
      identity.skin,
      identity.isBot,
    );
  }
  for (let i = 0; i < PREY_BUDGET.ambient; i += 1) spawnAmbientFood(state);
}

function advanceRoundLifecycle(state: RoomState): boolean {
  if (state.round.phase === "result") {
    if (state.tick >= state.round.resultEndTick) {
      // Publish a pristine next-round state at the transition tick. Simulation resumes
      // on the following tick, so score/growth cannot change inside the reset itself.
      resetCompetitiveRound(state);
      return false;
    }
    return false;
  }

  if (state.tick >= state.round.endTick) {
    concludeRound(state);
    return false;
  }
  if (state.round.phase === "active" && state.tick >= state.round.apexStartTick) beginApex(state);
  return true;
}

export function roundTicksLeft(state: Pick<RoomState, "tick" | "round">): number {
  const until = state.round.phase === "result" ? state.round.resultEndTick : state.round.endTick;
  return Math.max(0, until - state.tick);
}

// ── Actions ──────────────────────────────────────────────────────────────────────
export function applyAction(state: RoomState, action: Action): RoomState {
  switch (action.type) {
    case "join": {
      if (!state.snakes[action.playerId]) {
        const joined = makeSnake(
          state,
          action.playerId,
          (action.name ?? "Player").slice(0, 16),
          action.skin ?? DEFAULT_SKIN,
          action.isBot ?? false,
        );
        if (state.round.phase === "result") {
          joined.alive = false;
          joined.health = 0;
          joined.respawnTick = state.round.resultEndTick;
        }
        state.snakes[action.playerId] = joined;
      }
      return state;
    }
    case "leave": {
      const s = state.snakes[action.playerId];
      if (s && state.round.phase !== "result") scatterAsFood(state, s);
      delete state.snakes[action.playerId];
      return state;
    }
    case "setOrientation": {
      const s = state.snakes[action.playerId];
      if (state.round.phase !== "result" && s && s.alive && Number.isFinite(action.yaw) && Number.isFinite(action.pitch)) {
        s.targetYaw = normalizeYaw(action.yaw);
        s.targetPitch = clampPitch(action.pitch);
      }
      return state;
    }
    case "setBoost": {
      const s = state.snakes[action.playerId];
      if (state.round.phase !== "result" && s && s.alive) {
        // Space/click is an immediate, server-timed impact dash. The two-second
        // cooldown is authoritative, so key repeat and packet spam cannot bypass it.
        s.dashCooldownTick ??= 0;
        if (action.on && state.tick >= s.dashCooldownTick) {
          s.lungeTicks = DASH_TICKS;
          // A frenzy halves the dash cooldown, which is what makes the twenty seconds
          // feel different rather than just looking different.
          s.dashCooldownTick = state.tick + Math.round(DASH_COOLDOWN_TICKS * (isFrenzy(state) ? FRENZY_RULES.dashCooldownMultiplier : 1));
        }
      }
      return state;
    }
    case "bite": {
      const s = state.snakes[action.playerId];
      if (state.round.phase !== "result" && s?.alive && state.tick >= s.biteCooldownTick) {
        s.biteCooldownTick = state.tick + COMBAT.biteCooldownTicks;
        // Choosing to attack ends spawn grace: protected sharks cannot deal free damage.
        if (state.tick < s.invulnTick) s.invulnTick = state.tick;
        resolveBite(state, s);
      }
      return state;
    }
    case "respawn": {
      const s = state.snakes[action.playerId];
      if (state.round.phase !== "result" && s && !s.alive && state.tick >= s.respawnTick) {
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

  // Result windows advance only the authoritative round clock. All competitive state is
  // frozen until the next server-owned reset; no client input can advance the round.
  if (!advanceRoundLifecycle(state)) return state;

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

  // Bots plan from one bounded authoritative view, then move through the same
  // yaw/pitch and burst rules as every other shark.
  const bots = Object.values(state.snakes).filter((s) => s.alive && s.isBot);
  if (bots.length) {
    const botView = makeBotWorldView(state);
    for (const bot of bots) steerBot(state, bot, botView);
  }

  // Move every living snake.
  for (const s of Object.values(state.snakes)) {
    if (s.alive) moveSnake(state, s);
  }

  // Eating.
  for (const s of Object.values(state.snakes)) {
    if (s.alive) eat(state, s);
  }

  // Physical overlap is non-lethal. Combat damage only comes from explicit bite actions.
  resolveSharkCollisions(state);

  // Always-on rivals must not snowball across a long-lived Durable Object until a
  // fresh player has no practical opening. A bot that clears the demo-scale score
  // target bursts into food, then returns through the normal fast respawn path.
  for (const s of Object.values(state.snakes)) {
    if (s.isBot && s.alive && s.score >= BOT_RETIRE_SCORE) killSnake(state, s, null, "retire");
  }

  // Bots auto-respawn after their delay so the arena stays populated (~24 snakes).
  for (const s of Object.values(state.snakes)) {
    if (s.isBot && !s.alive && state.tick >= s.respawnTick) {
      state.snakes[s.id] = makeSnake(state, s.id, s.name, s.skin, true);
    }
  }

  // Cap total food (corpse drops otherwise pile up into thousands of dots) — drop oldest.
  if (state.food.length > PREY_BUDGET.max) state.food.splice(0, state.food.length - PREY_BUDGET.max);

  updateApexLeader(state);
  return state;
}

function moveSnake(state: RoomState, s: Snake): void {
  s.yaw = rotateYawToward(s.yaw, s.targetYaw, TURN_RATE);
  s.pitch = clampPitch(moveToward(s.pitch, s.targetPitch, PITCH_RATE));

  let speed = swimSpeedForLungeTicks(s.lungeTicks);
  s.lungeTicks ??= 0;
  s.dashCooldownTick ??= 0;
  if (s.lungeTicks > 0) s.lungeTicks -= 1;
  if (isFrenzy(state)) speed *= FRENZY_SPEED;
  if (state.round.phase === "apex" && state.round.apexId === s.id) {
    speed *= ROUND_RULES.apexSpeedMultiplier;
  }

  const head = s.position;
  const forward = forwardFromYawPitch(s.yaw, s.pitch);
  const rawY = head.y + forward.y * speed;
  const y = Math.max(state.ocean.seabedY, Math.min(state.ocean.surfaceY, rawY));
  if (y !== rawY) {
    s.pitch = 0;
    s.targetPitch = 0;
  }
  s.position = {
    x: head.x + forward.x * speed,
    y,
    z: head.z + forward.z * speed,
  };
}

function eat(state: RoomState, s: Snake): void {
  const head = s.position;
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

function biteRangeFor(s: Snake): number {
  const sizeBonus = Math.min(
    COMBAT.biteRangeSizeBonusMax,
    Math.max(0, s.length - START_LENGTH) * COMBAT.biteRangeLengthScale,
  );
  return COMBAT.biteRange + sizeBonus;
}

function biteDamage(attacker: Snake, victim: Snake): number {
  const sizeScale = Math.max(
    COMBAT.minSizeDamageScale,
    Math.min(COMBAT.maxSizeDamageScale, Math.sqrt(Math.max(0.01, attacker.length / Math.max(0.01, victim.length)))),
  );
  const burstScale = attacker.lungeTicks > 0 ? COMBAT.burstDamageMultiplier : 1;
  return Math.min(COMBAT.maxDamage, Math.round(COMBAT.baseDamage * sizeScale * burstScale));
}

function resolveBite(state: RoomState, attacker: Snake): void {
  const origin = attacker.position;
  if (!origin) return;
  const forward = forwardFromYawPitch(attacker.yaw, attacker.pitch);
  const range = biteRangeFor(attacker);
  let target: Snake | null = null;
  let targetDistance = Infinity;

  for (const candidate of Object.values(state.snakes)) {
    if (
      candidate.id === attacker.id
      || !candidate.alive
      || state.tick < candidate.invulnTick
    ) continue;
    const head = candidate.position;
    const dx = head.x - origin.x;
    const dy = head.y - origin.y;
    const dz = head.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= 1e-6 || distance > range) continue;
    const dot = (forward.x * dx + forward.y * dy + forward.z * dz) / distance;
    if (dot < COMBAT.biteConeCos) continue;
    if (distance < targetDistance || (distance === targetDistance && candidate.id < (target?.id ?? ""))) {
      target = candidate;
      targetDistance = distance;
    }
  }

  if (!target) return;
  target.health = Math.max(0, target.health - biteDamage(attacker, target));
  const hit = target.position;
  state.explosions.push({
    id: `bite-${attacker.id}-${target.id}-${state.tick}`,
    x: hit.x,
    y: hit.y,
    z: hit.z,
    tick: state.tick,
    skin: attacker.skin,
    kind: "bite",
  });
  if (target.health > 0) return;

  const scoreReward = Math.max(
    COMBAT.killScoreMin,
    Math.min(COMBAT.killScoreMax, Math.round(target.length * COMBAT.killScoreLengthScale)),
  );
  const growthReward = Math.max(
    COMBAT.killGrowthMin,
    Math.min(COMBAT.killGrowthMax, target.length * COMBAT.killGrowthLengthScale),
  );
  const apexBounty = state.round.phase === "apex" && state.round.apexId === target.id;
  attacker.score += scoreReward + (apexBounty ? ROUND_RULES.apexKillBonusScore : 0);
  attacker.length += growthReward + (apexBounty ? ROUND_RULES.apexKillBonusGrowth : 0);
  killSnake(state, target, attacker.id, "bite");
}

function resolveSharkCollisions(state: RoomState): void {
  const living = Object.values(state.snakes).filter((shark) => shark.alive);
  const radiusSq = state.ocean.radius * state.ocean.radius;
  for (const shark of living) {
    const head = shark.position;
    if (shark.alive && horizontalRadiusSquared(head) >= radiusSq) killSnake(state, shark, null, "boundary");
  }

  for (let i = 0; i < living.length; i += 1) {
    const a = living[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < living.length; j += 1) {
      const b = living[j];
      if (!b.alive) continue;
      const radiusA = HEAD_RADIUS + Math.min(1.15, Math.sqrt(a.length) * 0.075);
      const radiusB = HEAD_RADIUS + Math.min(1.15, Math.sqrt(b.length) * 0.075);
      const headA = a.position;
      const headB = b.position;
      if (distanceSquared3(headA, headB) > (radiusA + radiusB) ** 2) continue;

      const apartA = distanceSquared3(headA, headB) > 1e-9
        ? yawPitchToward(headB, headA)
        : { yaw: normalizeYaw(a.yaw + Math.PI / 2), pitch: 0 };
      const apartB = { yaw: normalizeYaw(apartA.yaw + Math.PI), pitch: -apartA.pitch };
      a.yaw = a.targetYaw = apartA.yaw;
      a.pitch = a.targetPitch = apartA.pitch;
      b.yaw = b.targetYaw = apartB.yaw;
      b.pitch = b.targetPitch = apartB.pitch;
    }
  }
}

function killSnake(state: RoomState, s: Snake, killerId: string | null, action: DeathAction): void {
  const head = s.position;
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
  s.health = 0;
  s.lastDeath = { killerId, victimId: s.id, action, tick: state.tick };
  s.lungeTicks = 0;
  s.respawnTick = state.tick + RESPAWN_DELAY;
}

/** Turn a shark into bounded, collectible carcass pieces without using presentation geometry for collision. */
function scatterAsFood(state: RoomState, s: Snake): void {
  const head = s.position;
  if (!head) return;
  const desired = Math.min(28, 12 + Math.floor(Math.sqrt(Math.max(0, s.length)) * 1.5));
  const count = Math.min(desired, Math.max(0, PREY_BUDGET.max - state.food.length));
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

// ── Bot AI ───────────────────────────────────────────────────────────────────────
interface BotWorldView {
  frenzy: boolean;
  apexId: string | null;
  livingSharks: Snake[];
  schoolValue: number[];
}

function makeBotWorldView(state: RoomState): BotWorldView {
  const livingSharks = Object.values(state.snakes)
    .filter((shark) => shark.alive)
    .slice(0, BOT_AI_BUDGET.maxTrackedSharks);
  const schoolValue = Array.from({ length: PREY_BUDGET.schools }, () => 0);
  for (const actor of state.food) {
    if (actor.school >= 0 && actor.school < schoolValue.length) {
      schoolValue[actor.school] += actor.value;
    }
  }
  return {
    frenzy: isFrenzy(state),
    apexId: state.round.phase === "apex" ? state.round.apexId : null,
    livingSharks,
    schoolValue,
  };
}

function boundaryEscapeTarget(state: RoomState, s: Snake): Vec3 | null {
  const head = s.position;
  const radius = Math.sqrt(horizontalRadiusSquared(head));
  const radialGap = state.ocean.radius - radius;
  const surfaceGap = state.ocean.surfaceY - head.y;
  const floorGap = head.y - state.ocean.seabedY;
  const nearWall = radialGap < BOT_AI_BUDGET.boundaryMargin;
  const nearSurface = surfaceGap < BOT_AI_BUDGET.verticalMargin;
  const nearFloor = floorGap < BOT_AI_BUDGET.verticalMargin;
  if (!nearWall && !nearSurface && !nearFloor) return null;

  const forward = forwardFromYawPitch(s.yaw, s.pitch);
  let dx = forward.x;
  let dy = forward.y;
  let dz = forward.z;

  if (nearWall && radius > 1e-6) {
    const urgency = 1 + (BOT_AI_BUDGET.boundaryMargin - radialGap) / BOT_AI_BUDGET.boundaryMargin;
    dx -= (head.x / radius) * urgency * 2.6;
    dz -= (head.z / radius) * urgency * 2.6;
  }
  if (nearSurface) {
    const urgency = 1 + (BOT_AI_BUDGET.verticalMargin - surfaceGap) / BOT_AI_BUDGET.verticalMargin;
    dy -= urgency * 2.4;
  }
  if (nearFloor) {
    const urgency = 1 + (BOT_AI_BUDGET.verticalMargin - floorGap) / BOT_AI_BUDGET.verticalMargin;
    dy += urgency * 2.4;
  }

  return { x: head.x + dx * 10, y: head.y + dy * 10, z: head.z + dz * 10 };
}

function choosePreyTarget(state: RoomState, head: Vec3, view: BotWorldView): { prey: Prey; distance: number } | null {
  const sight = view.frenzy ? BOT_AI_BUDGET.frenzySight : BOT_AI_BUDGET.preySight;
  let best: Prey | null = null;
  let bestDistance = Infinity;
  let bestUtility = -Infinity;

  for (const actor of state.food) {
    const distance = distance3(actor, head);
    if (distance > sight) continue;
    const schoolBonus = actor.school >= 0 && actor.school < view.schoolValue.length
      ? Math.min(8, view.schoolValue[actor.school] * 0.12)
      : 0;
    const frenzyBonus = view.frenzy && actor.kind === "chum" ? 18 : 0;
    const utility = actor.value * 2 + schoolBonus + frenzyBonus - distance * 0.22;
    if (utility > bestUtility || (utility === bestUtility && distance < bestDistance)) {
      best = actor;
      bestDistance = distance;
      bestUtility = utility;
    }
  }

  return best ? { prey: best, distance: bestDistance } : null;
}

function steerBot(state: RoomState, s: Snake, view: BotWorldView): void {
  const head = s.position;

  const boundaryTarget = boundaryEscapeTarget(state, s);
  if (boundaryTarget) {
    const target = yawPitchToward(head, boundaryTarget);
    s.targetYaw = target.yaw;
    s.targetPitch = target.pitch;
    return;
  }

  let threat: Snake | null = null;
  let threatDistance = Infinity;
  let quarry: Snake | null = null;
  let quarryDistance = Infinity;
  for (const rival of view.livingSharks) {
    if (rival.id === s.id) continue;
    const distance = distance3(head, rival.position);
    if (
      rival.length >= s.length * BOT_AI_BUDGET.threatLengthRatio
      && distance < BOT_AI_BUDGET.threatRadius
      && distance < threatDistance
    ) {
      threat = rival;
      threatDistance = distance;
    }
    const apexTarget = view.apexId === rival.id;
    const huntRadius = apexTarget ? BOT_AI_BUDGET.huntRadius * 1.35 : BOT_AI_BUDGET.huntRadius;
    if (
      (apexTarget || s.length >= rival.length * BOT_AI_BUDGET.huntLengthRatio)
      && state.tick >= rival.invulnTick
      && distance < huntRadius
      && (
        apexTarget
          ? view.apexId !== quarry?.id || distance < quarryDistance
          : view.apexId !== quarry?.id && distance < quarryDistance
      )
    ) {
      quarry = rival;
      quarryDistance = distance;
    }
  }

  if (threat?.position) {
    const target = yawPitchToward(threat.position, head);
    s.targetYaw = target.yaw;
    s.targetPitch = target.pitch;
    if (threatDistance <= BOT_AI_BUDGET.escapeBurstRange) {
      applyAction(state, { type: "setBoost", playerId: s.id, on: true });
    }
    return;
  }

  const preyTarget = choosePreyTarget(state, head, view);
  const shouldHuntRival = quarry?.position
    && (view.apexId === quarry.id || !preyTarget || quarryDistance < Math.min(12, preyTarget.distance * 0.8));

  let targetPoint: Vec3 | null = null;
  let targetDistance = Infinity;
  let wantsBurst = false;

  if (shouldHuntRival && quarry?.position) {
    targetPoint = quarry.position;
    targetDistance = quarryDistance;
    wantsBurst = quarryDistance <= BOT_AI_BUDGET.burstRange;
  } else if (preyTarget) {
    targetPoint = preyTarget.prey;
    targetDistance = preyTarget.distance;
    wantsBurst = targetDistance <= BOT_AI_BUDGET.burstRange
      && (view.frenzy || preyTarget.prey.value >= 2);
  } else if (view.frenzy) {
    targetPoint = {
      x: 0,
      y: (state.ocean.seabedY + state.ocean.surfaceY) / 2,
      z: 0,
    };
  }

  if (targetPoint) {
    const target = yawPitchToward(head, targetPoint);
    s.targetYaw = target.yaw;
    s.targetPitch = target.pitch;
    if (wantsBurst) applyAction(state, { type: "setBoost", playerId: s.id, on: true });
    if (shouldHuntRival && targetDistance <= biteRangeFor(s)) {
      applyAction(state, { type: "bite", playerId: s.id });
    }
  } else if ((state.tick + botPhase(s.id)) % BOT_AI_BUDGET.wanderInterval === 0) {
    s.targetYaw = randRange(state, -Math.PI, Math.PI);
    s.targetPitch = randRange(state, -BOT_AI_BUDGET.wanderPitch, BOT_AI_BUDGET.wanderPitch);
  }
}

/** Stable per-bot offset so wander turns are staggered across the tank. */
function botPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % BOT_AI_BUDGET.wanderInterval;
  return h;
}

// ── Derived views ────────────────────────────────────────────────────────────────
/** Leaderboard rows, highest score first. */
export function leaderboard(state: RoomState, limit = 10): ScoreEntry[] {
  return scoreEntries(state).slice(0, limit);
}
