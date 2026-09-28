// Serializable authoritative gameplay state. Everything here is plain JSON so it can
// live in a Durable Object, be snapshotted, and be replayed deterministically.
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

/** A single living (or recently dead) shark — player or bot. */
export interface Snake {
  id: string;
  name: string;
  skin: string;
  /** Head breadcrumb trail, newest first. */
  path: Vec3[];
  /** Body points, head first. Derived from path each tick. */
  segments: Vec3[];
  /** Yaw rotates around +Y; pitch tilts forward motion toward +Y. */
  yaw: number;
  pitch: number;
  targetYaw: number;
  targetPitch: number;
  length: number;
  boosting: boolean;
  chargeTicks: number;
  lungeTicks: number;
  dashCooldownTick: number;
  rocketTicks: number;
  rocketCooldownTick: number;
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

/** A lethal player-fired projectile retained until the later combat replacement task. */
export interface RocketProjectile {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  expiresTick: number;
}

/** Short-lived deterministic burst rendered by every client. */
export interface Explosion {
  id: string;
  x: number;
  y: number;
  z: number;
  tick: number;
  skin: string;
  kind: "shark" | "rocket";
}

export interface RoomState {
  schemaVersion: 9;
  id: string;
  seed: string;
  tick: number;
  rngState: number;
  ocean: OceanVolume;
  snakes: Record<string, Snake>;
  food: Prey[];
  rockets: RocketProjectile[];
  explosions: Explosion[];
  frenzyUntilTick: number;
}

/** Player/bot intents applied to authoritative state on the server. */
export type Action =
  | { type: "join"; playerId: string; name?: string; skin?: string; isBot?: boolean }
  | { type: "leave"; playerId: string }
  | { type: "setOrientation"; playerId: string; yaw: number; pitch: number }
  | { type: "setBoost"; playerId: string; on: boolean }
  | { type: "rocket"; playerId: string }
  | { type: "respawn"; playerId: string };

export interface ScoreEntry {
  id: string;
  name: string;
  skin: string;
  score: number;
  alive: boolean;
}
