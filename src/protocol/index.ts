// Wire protocol between the client and the server. Kept JSON-only so the same shapes
// travel over the WebSocket (realtime play) into the Room Durable Object.

import { clampPitch, normalizeYaw } from "../engine/geometry3d.js";
import type { Action, DeathAction, Explosion, OceanVolume, Prey, RoomState, RoundState, ScoreEntry, Shark, Vec3 } from "../engine/types.js";
export { isFamilyFriendlyName, sanitizeDisplayName } from "./name-policy.js";

// ── WebSocket: realtime play (client ⇄ Room DO) ───────────────────────────────
export const STATE_BROADCAST_EVERY = 2; // 20 Hz simulation, 10 Hz snapshots.

export const REALTIME_PROTOCOL_VERSION = 12 as const;

interface OrientationInputAction {
  type: "setOrientation";
  yaw: number;
  pitch: number;
}

type ClientInputAction =
  | OrientationInputAction
  | { type: "setBoost"; on: boolean }
  | { type: "bite" }
  | { type: "respawn" };

export type ClientMessagePayload =
  | { t: "hello"; name: string; skin: string }
  | { t: "input"; action: ClientInputAction }
  | { t: "ping"; ts: number };

type ClientMessage = ClientMessagePayload & { v: typeof REALTIME_PROTOCOL_VERSION };

/** A trimmed shark for the wire — one authoritative head/body sample plus orientation. */
export type NetShark = Pick<
  Shark,
  "id" | "name" | "skin" | "yaw" | "pitch" | "length" | "lungeTicks" | "dashCooldownTick" | "health" | "biteCooldownTick" | "score" | "alive"
> & { position: Vec3 };

/**
 * Compact authoritative prey on the wire. Stable ids allow interpolation between
 * snapshots; school membership remains server-only because rendering does not need it.
 */
export type NetPrey = { species?: typeof PREY_SPECIES[number] } & Pick<
  Prey,
  "id" | "kind" | "x" | "y" | "z" | "value" | "r" | "yaw" | "pitch"
>;


/** Protocol 12 code order is permanent; future species do not renumber entries. */
export const PREY_SPECIES = [
  "sardine", "anchovy", "silverside", "clownfish", "blue-tang", "yellow-tang", "angelfish", "parrotfish",
  "chum", "bonus-chum", "carcass", "bonus-carcass", "tuna", "squid", "ray", "golden-fish",
] as const;
export type PreyTuple = [id: string, species: number, x: number, y: number, z: number, yaw: number, pitch: number];
export type WireState = Omit<NetState, "food"> & { food: PreyTuple[] };

/** Stable 32-bit FNV-1a identity, encoded in base 36 (at most seven characters). */
export function preyWireId(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
export function preySpeciesCode(prey: Prey): number {
  if (prey.kind === "chum") return prey.value > 3 ? 9 : 8;
  if (prey.kind === "carcass") return prey.value > 1 ? 11 : 10;
  if (prey.kind === "tuna") return 12;
  if (prey.kind === "ray") return 14;
  const school = Math.max(0, prey.school);
  return prey.kind === "bait" ? school % 3 : 3 + school % 5;
}
export function encodePrey(prey: Prey): PreyTuple {
  return [preyWireId(prey.id), preySpeciesCode(prey), round(prey.x, 1), round(prey.y, 1), round(prey.z, 1), round(prey.yaw, 2), round(prey.pitch, 2)];
}
function isPreyTuple(value: unknown): value is PreyTuple {
  return Array.isArray(value) && value.length === 7 && typeof value[0] === "string"
    && /^[0-9a-z]{1,7}$/.test(value[0]) && Number.isInteger(value[1]) && value[1] >= 0 && value[1] < PREY_SPECIES.length
    && value.slice(2).every(finite);
}
export function decodePrey(tuple: PreyTuple): NetPrey {
  const [id, species, x, y, z, yaw, pitch] = tuple;
  const kind: Prey["kind"] = species < 3 ? "bait" : species < 8 ? "reef" : species < 10 ? "chum"
    : species < 12 ? "carcass" : species === 12 ? "tuna" : species === 14 ? "ray" : "reef";
  const value = species === 9 ? 5 : species === 11 ? 2 : kind === "tuna" ? 5 : kind === "ray" ? 8
    : kind === "bait" || kind === "carcass" ? 1 : kind === "chum" ? 3 : 2;
  const r = species === 9 ? 0.95 : species === 11 ? 0.72 : kind === "tuna" ? 1.05 : kind === "ray" ? 1.3
    : kind === "bait" ? 0.42 : kind === "carcass" ? 0.5 : kind === "chum" ? 0.78 : 0.58;
  return { id, species: PREY_SPECIES[species], kind, value, r, x, y, z, yaw, pitch };
}
export function decodeState(state: WireState): NetState {
  return { ...state, food: state.food.map(decodePrey) };
}

type NetExplosion = Pick<
  Explosion,
  "id" | "x" | "y" | "z" | "tick" | "skin" | "kind"
>;

/** The per-tick world snapshot broadcast to every connected client. */
type NetRoundState = RoundState;

export interface NetState {
  tick: number;
  arenaRadius: number;
  seabedY: number;
  surfaceY: number;
  sharks: NetShark[];
  food: NetPrey[];
  explosions: NetExplosion[];
  /** Tick the running Feeding Frenzy ends at; 0 or past when none is running. */
  frenzyUntilTick: number;
  /** Complete server-owned round/Apex/result truth for late join and reconnect. */
  round: NetRoundState;
}

export type ServerMessagePayload =
  | { t: "welcome"; youId: string; roomId: string; state: WireState }
  | { t: "state"; state: WireState }
  | { t: "leaderboard"; entries: ScoreEntry[] }
  | { t: "died"; by: string | null; action: DeathAction | null; tick: number; score: number; respawnInMs: number }
  | { t: "pong"; ts: number };

type DecodedServerPayload = Exclude<ServerMessagePayload, { t: "welcome" | "state" }>
  | { t: "welcome"; youId: string; roomId: string; state: NetState }
  | { t: "state"; state: NetState };
type ServerMessage = DecodedServerPayload & { v: typeof REALTIME_PROTOCOL_VERSION };

type RealtimeParseFailureReason = "stale-schema" | "malformed";
type RealtimeParseResult<T> =
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

function normalizeClientInputAction(value: unknown): ClientInputAction | null {
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
  if (value.type === "bite") return { type: "bite" };
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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScoreEntry(value: unknown): value is ScoreEntry {
  if (!record(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.skin === "string"
    && finite(value.score)
    && typeof value.alive === "boolean";
}

function isNetRoundState(value: unknown): value is NetRoundState {
  if (!record(value)) return false;
  const phase = value.phase;
  if (
    !finite(value.number)
    || !Number.isInteger(value.number)
    || value.number < 1
    || (phase !== "active" && phase !== "apex" && phase !== "result")
    || !finite(value.startTick)
    || !finite(value.apexStartTick)
    || !finite(value.endTick)
    || !finite(value.resultEndTick)
    || (value.apexId !== null && typeof value.apexId !== "string")
    || (value.startTick as number) < 0
    || (value.apexStartTick as number) <= (value.startTick as number)
    || (value.endTick as number) <= (value.apexStartTick as number)
    || (value.resultEndTick as number) <= (value.endTick as number)
  ) return false;
  if (value.result === null) return phase !== "result";
  if (phase !== "result" || !record(value.result)) return false;
  const result = value.result;
  return finite(result.roundNumber)
    && Number.isInteger(result.roundNumber)
    && finite(result.endedTick)
    && (result.winner === null || isScoreEntry(result.winner));
}

function isWireState(value: unknown): value is WireState {
  return record(value)
    && typeof value.tick === "number"
    && Number.isFinite(value.tick)
    && finite(value.arenaRadius) && finite(value.seabedY) && finite(value.surfaceY)
    && finite(value.frenzyUntilTick)
    && Array.isArray(value.sharks) && value.sharks.every((shark: unknown) =>
      record(shark) && record(shark.position) && finite(shark.position.x)
      && finite(shark.position.y) && finite(shark.position.z)
      && typeof shark.id === "string" && typeof shark.alive === "boolean"
      && finite(shark.yaw) && finite(shark.pitch))
    && Array.isArray(value.food) && value.food.every(isPreyTuple)
    && Array.isArray(value.explosions)
    && isNetRoundState(value.round);
}

export function parseRealtimeServerMessage(value: unknown): RealtimeParseResult<ServerMessage> {
  if (!record(value) || typeof value.t !== "string") return { ok: false, reason: "malformed" };
  if (value.v !== REALTIME_PROTOCOL_VERSION) return { ok: false, reason: "stale-schema" };

  if (value.t === "welcome") {
    if (typeof value.youId !== "string" || typeof value.roomId !== "string" || !isWireState(value.state)) return { ok: false, reason: "malformed" };
    return { ok: true, message: { ...value, state: decodeState(value.state as WireState) } as unknown as ServerMessage };
  }
  if (value.t === "state") {
    if (!isWireState(value.state)) return { ok: false, reason: "malformed" };
    return { ok: true, message: { ...value, state: decodeState(value.state as WireState) } as unknown as ServerMessage };
  }
  if (value.t === "leaderboard") {
    if (!Array.isArray(value.entries)) return { ok: false, reason: "malformed" };
    return { ok: true, message: value as unknown as ServerMessage };
  }
  if (value.t === "died") {
    if ((value.by !== null && typeof value.by !== "string")
      || (value.action !== null && value.action !== "bite" && value.action !== "retire")
      || typeof value.tick !== "number" || !Number.isFinite(value.tick)
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
  if (input.type === "bite") return { type: "bite", playerId };
  return { type: "respawn", playerId };
}

/** Round to places decimals — snapshot bytes, not display precision. */
function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor || 0;
}

/** Session visibility never changes the authoritative prey population. */
export const PREY_SNAPSHOT_RADIUS = 72;

/** Omit viewerId only for full-room tooling and protocol fixtures. */
export function toNetState(state: RoomState, viewerId?: string): WireState {
  const viewer = viewerId ? state.sharks[viewerId] : undefined;
  const centre = viewer?.alive ? viewer.position : { x: 0, y: 0, z: 0 };
  const food = viewerId === undefined ? state.food : state.food.filter((prey) =>
    Math.hypot(prey.x - centre.x, prey.y - centre.y, prey.z - centre.z) <= PREY_SNAPSHOT_RADIUS);
  return {
    tick: state.tick,
    arenaRadius: round(state.ocean.radius, 1),
    seabedY: round(state.ocean.seabedY, 1),
    surfaceY: round(state.ocean.surfaceY, 1),
    frenzyUntilTick: state.frenzyUntilTick ?? 0,
    round: {
      ...state.round,
      result: state.round.result
        ? {
            ...state.round.result,
            winner: state.round.result.winner ? { ...state.round.result.winner } : null,
          }
        : null,
    },
    sharks: Object.values(state.sharks).map((s) => ({
      id: s.id,
      name: s.name,
      skin: s.skin,
      position: { x: round(s.position.x), y: round(s.position.y), z: round(s.position.z) },
      yaw: round(s.yaw, 3),
      pitch: round(s.pitch, 3),
      length: round(s.length, 2),
      lungeTicks: s.lungeTicks ?? 0,
      dashCooldownTick: s.dashCooldownTick ?? 0,
      health: s.health,
      biteCooldownTick: s.biteCooldownTick ?? 0,
      score: s.score,
      alive: s.alive,
    })),
    food: food.map(encodePrey),

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

export type { Action, DeathAction, Explosion, OceanVolume, Prey, PreyKind, RoomState, RoundPhase, RoundResult, RoundState, ScoreEntry, Shark, Vec3 } from "../engine/types.js";
