// Serializable authoritative gameplay state. Everything here is plain JSON so deterministic
// simulations can be compared and sent across the wire without provider-specific types.
// Engine/protocol code stays framework-agnostic: no DOM, Three.js, or browser vectors.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Radial X/Z tank bounds plus explicit vertical water-column limits. */
export interface OceanVolume {
  radius: number;
  seabedY: number;
  surfaceY: number;
}

export type DeathAction = "bite" | "boundary" | "retire";

export interface DeathRecord {
  killerId: string | null;
  victimId: string;
  action: DeathAction;
  tick: number;
}

/** A single living (or recently dead) shark — player or bot. */
export interface Shark {
  id: string;
  name: string;
  skin: string;
  /** Authoritative position, retained through death until respawn. */
  position: Vec3;
  /** Yaw rotates around +Y; pitch tilts forward motion toward +Y. */
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  length: number;
  lungeTicks: number;
  dashCooldownTick: number;
  health: number;
  biteCooldownTick: number;
  lastDeath: DeathRecord | null;
  score: number;
  alive: boolean;
  isBot: boolean;
  respawnTick: number;
  invulnTick: number;
}

/** Compact authoritative prey taxonomy. Rendering may style these differently, but gameplay owns the kind. */
export type PreyKind = "bait" | "reef" | "chum" | "carcass";

/** A single score-relevant prey actor. All movement/collision fields are server authoritative. */
export interface Prey {
  id: string;
  kind: PreyKind;
  x: number;
  y: number;
  z: number;
  value: number;
  r: number;
  yaw: number;
  pitch: number;
  /** Deterministic school identity; -1 marks non-schooling drops such as carcass pieces. */
  school: number;
}

/** Short-lived deterministic world feedback rendered by every client. */
export interface Explosion {
  id: string;
  x: number;
  y: number;
  z: number;
  tick: number;
  skin: string;
  kind: "shark" | "bite" | "frenzy";
}

export type RoundPhase = "active" | "apex" | "result";

export interface RoundResult {
  roundNumber: number;
  winner: ScoreEntry | null;
  endedTick: number;
}

export interface RoundState {
  number: number;
  phase: RoundPhase;
  startTick: number;
  apexStartTick: number;
  endTick: number;
  resultEndTick: number;
  apexId: string | null;
  result: RoundResult | null;
}

export interface RoomState {
  id: string;
  seed: string;
  tick: number;
  rngState: number;
  ocean: OceanVolume;
  sharks: Record<string, Shark>;
  food: Prey[];
  explosions: Explosion[];
  frenzyUntilTick: number;
  round: RoundState;
}

/** Player/bot intents applied to authoritative state on the server. */
export type Action =
  | { type: "join"; playerId: string; name?: string; skin?: string; isBot?: boolean }
  | { type: "leave"; playerId: string }
  | { type: "setOrientation"; playerId: string; yaw: number; pitch: number }
  | { type: "setBoost"; playerId: string; on: boolean }
  | { type: "bite"; playerId: string }
  | { type: "respawn"; playerId: string };

export interface ScoreEntry {
  id: string;
  name: string;
  skin: string;
  score: number;
  alive: boolean;
}
