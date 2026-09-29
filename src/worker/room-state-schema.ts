import { PREY_KINDS, ROOM_SCHEMA_VERSION, createRoom, type RoomState } from "module-react3fiber/engine";

export const PREVIOUS_ROOM_SCHEMA_VERSION = 9 as const;
export const OLDEST_SUPPORTED_ROOM_SCHEMA_VERSION = 7 as const;
export const GAME_LOG_SCHEMA_VERSION = ROOM_SCHEMA_VERSION;

export type RoomSnapshotSource =
  | "fresh"
  | "schema-7-reset"
  | "schema-8-reset"
  | "schema-9-reset"
  | "schema-10";

export interface RoomSnapshotBootResult {
  room: RoomState;
  source: RoomSnapshotSource;
  persistSnapshot: boolean;
}

const PREY_KIND_SET = new Set<string>(PREY_KINDS);
const DEATH_ACTIONS = new Set(["bite", "boundary", "retire"]);
const RESETTABLE_SCHEMAS = new Set([7, 8, 9]);

export function bootstrapRoomSnapshot(stored: unknown, fallback: RoomState): RoomSnapshotBootResult {
  assertSchema10RoomState(fallback, fallback.id);

  if (stored === undefined || stored === null) {
    return { room: fallback, source: "fresh", persistSnapshot: false };
  }

  const record = asRecord(stored);
  const version = record?.schemaVersion;

  if (record && typeof version === "number" && RESETTABLE_SCHEMAS.has(version)) {
    const id = requiredString(record.id, `schema-${String(version)} room id`);
    const seed = requiredString(record.seed, `schema-${String(version)} room seed`);
    if (id !== fallback.id) throw new Error(`room snapshot id ${id} does not match Durable Object ${fallback.id}`);

    // Schema 10 replaces contact/projectile combat with health + directional bites.
    // Earlier snapshots cannot be reinterpreted safely. Reset only transient gameplay,
    // retaining stable Room identity/seed and trustworthy volumetric ocean bounds.
    const legacyOcean = version >= 8 ? asRecord(record.ocean) : null;
    const radius = legacyOcean && finite(legacyOcean.radius) ? legacyOcean.radius as number : fallback.ocean.radius;
    const seabedY = legacyOcean && finite(legacyOcean.seabedY) ? legacyOcean.seabedY as number : fallback.ocean.seabedY;
    const surfaceY = legacyOcean && finite(legacyOcean.surfaceY) ? legacyOcean.surfaceY as number : fallback.ocean.surfaceY;
    const room = createRoom({ id, seed, oceanRadius: radius, seabedY, surfaceY });
    assertSchema10RoomState(room, fallback.id);
    return {
      room,
      source: `schema-${version}-reset` as RoomSnapshotSource,
      persistSnapshot: true,
    };
  }

  if (record && version === ROOM_SCHEMA_VERSION) {
    assertSchema10RoomState(stored, fallback.id);
    return { room: stored, source: "schema-10", persistSnapshot: false };
  }

  throw new Error(`unsupported room snapshot schema ${String(version)}`);
}

export function shouldRotateGameLogSchema(storedVersion: unknown): boolean {
  return storedVersion !== GAME_LOG_SCHEMA_VERSION;
}

export function assertSchema10RoomState(value: unknown, expectedId?: string): asserts value is RoomState {
  const room = asRecord(value);
  if (!room || room.schemaVersion !== ROOM_SCHEMA_VERSION) invalid("schemaVersion");
  if (typeof room.id !== "string" || !room.id) invalid("id");
  if (expectedId && room.id !== expectedId) invalid("id does not match Durable Object");
  if (typeof room.seed !== "string" || !room.seed) invalid("seed");
  if (!finite(room.tick) || !finite(room.rngState)) invalid("tick/rngState");
  if ("arena" in room) invalid("legacy arena field");
  if ("rockets" in room) invalid("retired projectile field");

  const ocean = asRecord(room.ocean);
  if (!ocean || !finite(ocean.radius) || !finite(ocean.seabedY) || !finite(ocean.surfaceY)) invalid("ocean");
  if ((ocean.radius as number) < 8 || (ocean.surfaceY as number) - (ocean.seabedY as number) < 4) invalid("ocean bounds");

  const snakes = asRecord(room.snakes);
  if (!snakes) invalid("snakes");
  for (const [id, candidate] of Object.entries(snakes)) {
    const shark = asRecord(candidate);
    if (!shark) invalid(`shark ${id}`);
    if ("heading" in shark || "targetHeading" in shark) invalid(`shark ${id} legacy heading`);
    if ("rocketTicks" in shark || "rocketCooldownTick" in shark) invalid(`shark ${id} retired projectile state`);
    if (typeof shark.id !== "string" || typeof shark.name !== "string" || typeof shark.skin !== "string") invalid(`shark ${id} identity`);
    if (!Array.isArray(shark.path) || !shark.path.every(isVec3)) invalid(`shark ${id} path`);
    if (!Array.isArray(shark.segments) || !shark.segments.every(isVec3)) invalid(`shark ${id} segments`);
    for (const field of ["yaw", "pitch", "targetYaw", "targetPitch", "length", "chargeTicks", "lungeTicks", "dashCooldownTick", "health", "biteCooldownTick", "score", "respawnTick", "invulnTick"]) {
      if (!finite(shark[field])) invalid(`shark ${id} ${field}`);
    }
    if ((shark.health as number) < 0 || (shark.health as number) > 100) invalid(`shark ${id} health bounds`);
    for (const field of ["boosting", "alive", "isBot"]) {
      if (typeof shark[field] !== "boolean") invalid(`shark ${id} ${field}`);
    }
    if (shark.lastDeath !== null) {
      const death = asRecord(shark.lastDeath);
      if (
        !death
        || (death.killerId !== null && typeof death.killerId !== "string")
        || death.victimId !== shark.id
        || typeof death.action !== "string"
        || !DEATH_ACTIONS.has(death.action)
        || !finite(death.tick)
      ) invalid(`shark ${id} lastDeath`);
    }
  }

  if (!Array.isArray(room.food) || !room.food.every((candidate) => {
    const prey = asRecord(candidate);
    return Boolean(
      prey
      && isVec3(prey)
      && typeof prey.id === "string"
      && typeof prey.kind === "string"
      && PREY_KIND_SET.has(prey.kind)
      && finite(prey.value)
      && finite(prey.r)
      && finite(prey.yaw)
      && finite(prey.pitch)
      && finite(prey.school)
      && Number.isInteger(prey.school),
    );
  })) invalid("prey");

  if (!Array.isArray(room.explosions) || !room.explosions.every((candidate) => {
    const explosion = asRecord(candidate);
    return Boolean(
      explosion
      && isVec3(explosion)
      && typeof explosion.id === "string"
      && finite(explosion.tick)
      && typeof explosion.skin === "string"
      && (explosion.kind === "shark" || explosion.kind === "bite" || explosion.kind === "frenzy")
    );
  })) invalid("explosions");

  if (!finite(room.frenzyUntilTick)) invalid("frenzyUntilTick");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isVec3(value: unknown): boolean {
  const point = asRecord(value);
  return Boolean(point && finite(point.x) && finite(point.y) && finite(point.z));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is invalid`);
  return value;
}

function invalid(reason: string): never {
  throw new Error(`room snapshot schema ${ROOM_SCHEMA_VERSION} is invalid: ${reason}`);
}
