// Wire protocol between the client and the server. Kept JSON-only so the same shapes
// travel over HTTP (tank/profile) and over the WebSocket (realtime play)
// into the Room Durable Object.

import type { Action, Explosion, Food, RocketProjectile, RoomState, ScoreEntry, Snake } from "../engine/types.js";
export { isFamilyFriendlyName, sanitizeDisplayName } from "./name-policy.js";

// ── HTTP: health / tank / profile ─────────────────────────────────────────────
export interface HealthResponse {
  ok: true;
  module: "module-react3fiber";
  time: string;
}

/** One joinable room as shown in the Shark Tank list, with live counts + top score. */
export interface TankRoom {
  id: string;
  name: string;
  players: number;
  bots: number;
  capacity: number;
  topScore: number;
  topName: string;
}

export interface TankResponse {
  ok: true;
  rooms: TankRoom[];
}

/** Persisted per-player cosmetics + settings profile. */
export interface Profile {
  name: string;
  skin: string;
  /** Best score ever, for the local player's own record. */
  best: number;
  /** Opaque settings blob owned by the client (systems menu). */
  settings?: Record<string, unknown>;
}

export interface ProfileResponse {
  ok: true;
  profile: Profile;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

// ── WebSocket: realtime play (client ⇄ Room DO) ───────────────────────────────
/** Client → server. `input` carries the same Action union the engine applies. */
export type ClientMessage =
  | { t: "hello"; name: string; skin: string }
  | { t: "input"; action: Action }
  | { t: "ping"; ts: number };

/** A trimmed snake for the wire — segments are the bulk of the payload. */
export type NetSnake = Pick<
  Snake,
  "id" | "name" | "skin" | "segments" | "heading" | "length" | "boosting" | "chargeTicks" | "lungeTicks" | "dashCooldownTick" | "rocketTicks" | "rocketCooldownTick" | "score" | "alive"
>;

/**
 * A dot on the wire. The server-side `id` is bookkeeping the client never reads, and
 * coordinates are rounded to a tenth of a world unit. A full tank ships hundreds of
 * dots ten times a second, so trimming this record is the single biggest lever on
 * snapshot size — it roughly halves the payload of a busy arena.
 */
export interface NetFood {
  x: number;
  z: number;
  value: number;
  r: number;
}

/** The per-tick world snapshot broadcast to every connected client. */
export interface NetState {
  tick: number;
  arenaRadius: number;
  snakes: NetSnake[];
  food: NetFood[];
  rockets: RocketProjectile[];
  explosions: Explosion[];
  /** Tick the running Feeding Frenzy ends at; 0 or past when none is running. */
  frenzyUntilTick: number;
}

/** Server → client. */
export type ServerMessage =
  | { t: "welcome"; youId: string; roomId: string; state: NetState }
  | { t: "state"; state: NetState }
  | { t: "leaderboard"; entries: ScoreEntry[] }
  | { t: "died"; by: string | null; score: number; respawnInMs: number }
  | { t: "pong"; ts: number };

/** Round to `places` decimals — snapshot bytes, not display precision. */
function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Build the on-the-wire snapshot from authoritative RoomState. */
export function toNetState(state: RoomState): NetState {
  return {
    tick: state.tick,
    arenaRadius: state.arena.radius,
    frenzyUntilTick: state.frenzyUntilTick ?? 0,
    snakes: Object.values(state.snakes).map((s) => ({
      id: s.id,
      name: s.name,
      skin: s.skin,
      segments: s.segments.map((seg) => ({ x: round(seg.x), z: round(seg.z) })),
      heading: round(s.heading, 3),
      length: s.length,
      boosting: s.boosting,
      chargeTicks: s.chargeTicks ?? 0,
      lungeTicks: s.lungeTicks ?? 0,
      dashCooldownTick: s.dashCooldownTick ?? 0,
      rocketTicks: s.rocketTicks ?? 0,
      rocketCooldownTick: s.rocketCooldownTick ?? 0,
      score: s.score,
      alive: s.alive,
    })),
    food: state.food.map((f) => ({ x: round(f.x, 1), z: round(f.z, 1), value: f.value, r: f.r })),
    rockets: state.rockets ?? [],
    explosions: state.explosions ?? [],
  };
}

// ── Endpoint map ───────────────────────────────────────────────────────────────
export const API = {
  health: "/api/health",
  tank: "/api/tank",
  profile: "/api/profile",
} as const;

/** WebSocket path for a given room id, e.g. `/room/room-1/ws`. */
export function roomSocketPath(roomId: string): string {
  return `/room/${encodeURIComponent(roomId)}/ws`;
}

export type { Action, Explosion, Food, RocketProjectile, RoomState, ScoreEntry, Snake };
