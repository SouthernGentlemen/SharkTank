// Wire protocol between the client and the server. Kept JSON-only so the same shapes
// travel over HTTP (tank/profile) and over the WebSocket (realtime play)
// into the Room Durable Object.

import { clampPitch, normalizeYaw } from "../engine/geometry3d.js";
import type { Action, Explosion, OceanVolume, Prey, RocketProjectile, RoomState, ScoreEntry, Snake, Vec3 } from "../engine/types.js";
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
export const REALTIME_PROTOCOL_VERSION = 9 as const;

export interface OrientationInputAction {
  type: "setOrientation";
  yaw: number;
  pitch: number;
}

export type ClientInputAction =
  | OrientationInputAction
  | { type: "setBoost"; on: boolean }
  | { type: "rocket" }
  | { type: "respawn" };

export type ClientMessagePayload =
  | { t: "hello"; name: string; skin: string }
  | { t: "input"; action: ClientInputAction }
  | { t: "ping"; ts: number };

export type ClientMessage = ClientMessagePayload & { v: typeof REALTIME_PROTOCOL_VERSION };

/** A trimmed shark for the wire — one authoritative head/body sample plus orientation. */
export type NetSnake = Pick<
  Snake,
  "id" | "name" | "skin" | "segments" | "yaw" | "pitch" | "length" | "boosting" | "chargeTicks" | "lungeTicks" | "dashCooldownTick" | "rocketTicks" | "rocketCooldownTick" | "score" | "alive"
>;

/**
 * Compact authoritative prey on the wire. Stable ids allow interpolation between
 * snapshots; school membership remains server-only because rendering does not need it.
 */
export type NetPrey = Pick<
  Prey,
  "id" | "kind" | "x" | "y" | "z" | "value" | "r" | "yaw" | "pitch"
>;

export type NetRocket = Pick<
  RocketProjectile,
  "id" | "ownerId" | "x" | "y" | "z" | "yaw" | "pitch" | "expiresTick"
>;

export type NetExplosion = Pick<
  Explosion,
  "id" | "x" | "y" | "z" | "tick" | "skin" | "kind"
>;

/** The per-tick world snapshot broadcast to every connected client. */
export interface NetState {
  schemaVersion: 9;
  tick: number;
  arenaRadius: number;
  seabedY: number;
  surfaceY: number;
  snakes: NetSnake[];
  food: NetPrey[];
  rockets: NetRocket[];
  explosions: NetExplosion[];
  /** Tick the running Feeding Frenzy ends at; 0 or past when none is running. */
  frenzyUntilTick: number;
}

export type ServerMessagePayload =
  | { t: "welcome"; youId: string; roomId: string; state: NetState }
  | { t: "state"; state: NetState }
  | { t: "leaderboard"; entries: ScoreEntry[] }
  | { t: "died"; by: string | null; score: number; respawnInMs: number }
  | { t: "pong"; ts: number };

export type ServerMessage = ServerMessagePayload & { v: typeof REALTIME_PROTOCOL_VERSION };

export type RealtimeParseFailureReason = "stale-schema" | "malformed";
export type RealtimeParseResult<T> =
  | { ok: true; message: T }
  | { ok: false; reason: RealtimeParseFailureReason };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function withRealtimeProtocol<T extends { t: string }>(
  message: T,
): T & { v: typeof REALTIME_PROTOCOL_VERSION } {
  return { ...message, v: REALTIME_PROTOCOL_VERSION };
}

export function normalizeClientInputAction(value: unknown): ClientInputAction | null {
  if (!record(value) || typeof value.type !== "string") return null;
  if (value.type === "setOrientation") {
    if (typeof value.yaw !== "number" || !Number.isFinite(value.yaw)) return null;
    if (typeof value.pitch !== "number" || !Number.isFinite(value.pitch)) return null;
    return {
      type: "setOrientation",
      yaw: normalizeYaw(value.yaw),
      pitch: clampPitch(value.pitch),
    };
  }
  if (value.type === "setBoost" && typeof value.on === "boolean") return { type: "setBoost", on: value.on };
  if (value.type === "rocket") return { type: "rocket" };
  if (value.type === "respawn") return { type: "respawn" };
  return null;
}

export function parseRealtimeClientMessage(value: unknown): RealtimeParseResult<ClientMessage> {
  if (!record(value) || typeof value.t !== "string") return { ok: false, reason: "malformed" };
  if (value.v !== REALTIME_PROTOCOL_VERSION) return { ok: false, reason: "stale-schema" };

  if (value.t === "hello") {
    if (typeof value.name !== "string" || typeof value.skin !== "string") return { ok: false, reason: "malformed" };
    return { ok: true, message: { t: "hello", name: value.name, skin: value.skin, v: REALTIME_PROTOCOL_VERSION } };
  }
  if (value.t === "ping") {
    if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) return { ok: false, reason: "malformed" };
    return { ok: true, message: { t: "ping", ts: value.ts, v: REALTIME_PROTOCOL_VERSION } };
  }
  if (value.t === "input") {
    const action = normalizeClientInputAction(value.action);
    if (!action) return { ok: false, reason: "malformed" };
    return { ok: true, message: { t: "input", action, v: REALTIME_PROTOCOL_VERSION } };
  }
  return { ok: false, reason: "malformed" };
}

function isNetState(value: unknown): value is NetState {
  return record(value)
    && value.schemaVersion === 9
    && typeof value.tick === "number"
    && Number.isFinite(value.tick)
    && Array.isArray(value.snakes)
    && Array.isArray(value.food)
    && Array.isArray(value.rockets)
    && Array.isArray(value.explosions);
}

export function parseRealtimeServerMessage(value: unknown): RealtimeParseResult<ServerMessage> {
  if (!record(value) || typeof value.t !== "string") return { ok: false, reason: "malformed" };
  if (value.v !== REALTIME_PROTOCOL_VERSION) return { ok: false, reason: "stale-schema" };

  if (value.t === "welcome") {
    if (typeof value.youId !== "string" || typeof value.roomId !== "string" || !isNetState(value.state)) return { ok: false, reason: "malformed" };
    return { ok: true, message: value as unknown as ServerMessage };
  }
  if (value.t === "state") {
    if (!isNetState(value.state)) return { ok: false, reason: "malformed" };
    return { ok: true, message: value as unknown as ServerMessage };
  }
  if (value.t === "leaderboard") {
    if (!Array.isArray(value.entries)) return { ok: false, reason: "malformed" };
    return { ok: true, message: value as unknown as ServerMessage };
  }
  if (value.t === "died") {
    if ((value.by !== null && typeof value.by !== "string")
      || typeof value.score !== "number" || !Number.isFinite(value.score)
      || typeof value.respawnInMs !== "number" || !Number.isFinite(value.respawnInMs)) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, message: value as unknown as ServerMessage };
  }
  if (value.t === "pong") {
    if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) return { ok: false, reason: "malformed" };
    return { ok: true, message: value as unknown as ServerMessage };
  }
  return { ok: false, reason: "malformed" };
}

/** Bind a validated client intent to the authenticated WebSocket session id. */
export function clientInputToAction(input: ClientInputAction, playerId: string): Action {
  if (input.type === "setOrientation") return { type: "setOrientation", playerId, yaw: input.yaw, pitch: input.pitch };
  if (input.type === "setBoost") return { type: "setBoost", playerId, on: input.on };
  if (input.type === "rocket") return { type: "rocket", playerId };
  return { type: "respawn", playerId };
}

/** Round to places decimals — snapshot bytes, not display precision. */
function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Build the on-the-wire snapshot from authoritative RoomState. */
export function toNetState(state: RoomState): NetState {
  return {
    schemaVersion: state.schemaVersion,
    tick: state.tick,
    arenaRadius: round(state.ocean.radius, 1),
    seabedY: round(state.ocean.seabedY, 1),
    surfaceY: round(state.ocean.surfaceY, 1),
    frenzyUntilTick: state.frenzyUntilTick ?? 0,
    snakes: Object.values(state.snakes).map((s) => ({
      id: s.id,
      name: s.name,
      skin: s.skin,
      segments: s.segments.map((seg) => ({ x: round(seg.x), y: round(seg.y), z: round(seg.z) })),
      yaw: round(s.yaw, 3),
      pitch: round(s.pitch, 3),
      length: round(s.length, 2),
      boosting: s.boosting,
      chargeTicks: s.chargeTicks ?? 0,
      lungeTicks: s.lungeTicks ?? 0,
      dashCooldownTick: s.dashCooldownTick ?? 0,
      rocketTicks: s.rocketTicks ?? 0,
      rocketCooldownTick: s.rocketCooldownTick ?? 0,
      score: s.score,
      alive: s.alive,
    })),
    food: state.food.map((f) => ({
      id: f.id,
      kind: f.kind,
      x: round(f.x, 1),
      y: round(f.y, 1),
      z: round(f.z, 1),
      value: f.value,
      r: round(f.r, 2),
      yaw: round(f.yaw, 3),
      pitch: round(f.pitch, 3),
    })),
    rockets: (state.rockets ?? []).map((rocket) => ({
      id: rocket.id,
      ownerId: rocket.ownerId,
      x: round(rocket.x),
      y: round(rocket.y),
      z: round(rocket.z),
      yaw: round(rocket.yaw, 3),
      pitch: round(rocket.pitch, 3),
      expiresTick: rocket.expiresTick,
    })),
    explosions: (state.explosions ?? []).map((burst) => ({
      id: burst.id,
      x: round(burst.x),
      y: round(burst.y),
      z: round(burst.z),
      tick: burst.tick,
      skin: burst.skin,
      kind: burst.kind,
    })),
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

export type { Action, Explosion, OceanVolume, Prey, PreyKind, RocketProjectile, RoomState, ScoreEntry, Snake, Vec3 } from "../engine/types.js";
