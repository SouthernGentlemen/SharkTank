import { PREY_KINDS, ROOM_SCHEMA_VERSION, createRoom, type RoomState } from "module-react3fiber/engine";

export const PREVIOUS_ROOM_SCHEMA_VERSION = 8 as const;
export const OLDEST_SUPPORTED_ROOM_SCHEMA_VERSION = 7 as const;
export const GAME_LOG_SCHEMA_VERSION = ROOM_SCHEMA_VERSION;

export type RoomSnapshotSource = "fresh" | "schema-7-reset" | "schema-8-reset" | "schema-9";

export interface RoomSnapshotBootResult {
  room: RoomState;
  source: RoomSnapshotSource;
  persistSnapshot: boolean;
}

const PREY_KIND_SET = new Set<string>(PREY_KINDS);

export function bootstrapRoomSnapshot(stored: unknown, fallback: RoomState): RoomSnapshotBootResult {
  assertSchema9RoomState(fallback, fallback.id);

  if (stored === undefined || stored === null) {
    return { room: fallback, source: "fresh", persistSnapshot: false };
  }

  const record = asRecord(stored);
  const version = record?.schemaVersion;

  if (record && (version === OLDEST_SUPPORTED_ROOM_SCHEMA_VERSION || version === PREVIOUS_ROOM_SCHEMA_VERSION)) {
    const id = requiredString(record.id, `schema-${String(version)} room id`);
    const seed = requiredString(record.seed, `schema-${String(version)} room seed`);
    if (id !== fallback.id) throw new Error(`room snapshot id ${id} does not match Durable Object ${fallback.id}`);

    // Schema 7 is planar. Schema 8 has volumetric sharks/food but anonymous stationary
    // pellet records, so neither generation can be interpreted as schema-9 prey actors.
    // Reset only transient gameplay while retaining stable Room identity/seed and, when
    // trustworthy, the schema-8 ocean volume. Room metadata is stored separately.
    const legacyOcean = version === PREVIOUS_ROOM_SCHEMA_VERSION ? asRecord(record.ocean) : null;
    const radius = legacyOcean && finite(legacyOcean.radius) ? legacyOcean.radius as number : fallback.ocean.radius;
    const seabedY = legacyOcean && finite(legacyOcean.seabedY) ? legacyOcean.seabedY as number : fallback.ocean.seabedY;
    const surfaceY = legacyOcean && finite(legacyOcean.surfaceY) ? legacyOcean.surfaceY as number : fallback.ocean.surfaceY;
    const room = createRoom({ id, seed, oceanRadius: radius, seabedY, surfaceY });
    assertSchema9RoomState(room, fallback.id);
    return {
      room,
      source: version === PREVIOUS_ROOM_SCHEMA_VERSION ? "schema-8-reset" : "schema-7-reset",
      persistSnapshot: true,
    };
  }

  if (record && version === ROOM_SCHEMA_VERSION) {
    assertSchema9RoomState(stored, fallback.id);
    return { room: stored, source: "schema-9", persistSnapshot: false };
  }

  throw new Error(`unsupported room snapshot schema ${String(version)}`);
}

export function shouldRotateGameLogSchema(storedVersion: unknown): boolean {
  return storedVersion !== GAME_LOG_SCHEMA_VERSION;
}

export function assertSchema9RoomState(value: unknown, expectedId?: string): asserts value is RoomState {
  const room = asRecord(value);
  if (!room || room.schemaVersion !== ROOM_SCHEMA_VERSION) invalid("schemaVersion");
  if (typeof room.id !== "string" || !room.id) invalid("id");
  if (expectedId && room.id !== expectedId) invalid("id does not match Durable Object");
  if (typeof room.seed !== "string" || !room.seed) invalid("seed");
  if (!finite(room.tick) || !finite(room.rngState)) invalid("tick/rngState");
  if ("arena" in room) invalid("legacy arena field");

  const ocean = asRecord(room.ocean);
  if (!ocean || !finite(ocean.radius) || !finite(ocean.seabedY) || !finite(ocean.surfaceY)) invalid("ocean");
  if ((ocean.radius as number) < 8 || (ocean.surfaceY as number) - (ocean.seabedY as number) < 4) invalid("ocean bounds");

  const snakes = asRecord(room.snakes);
  if (!snakes) invalid("snakes");
  for (const [id, candidate] of Object.entries(snakes)) {
    const shark = asRecord(candidate);
    if (!shark) invalid(`shark ${id}`);
    if ("heading" in shark || "targetHeading" in shark) invalid(`shark ${id} legacy heading`);
    if (typeof shark.id !== "string" || typeof shark.name !== "string" || typeof shark.skin !== "string") invalid(`shark ${id} identity`);
    if (!Array.isArray(shark.path) || !shark.path.every(isVec3)) invalid(`shark ${id} path`);
    if (!Array.isArray(shark.segments) || !shark.segments.every(isVec3)) invalid(`shark ${id} segments`);
    for (const field of ["yaw", "pitch", "targetYaw", "targetPitch", "length", "chargeTicks", "lungeTicks", "dashCooldownTick", "rocketTicks", "rocketCooldownTick", "score", "respawnTick", "invulnTick"]) {
      if (!finite(shark[field])) invalid(`shark ${id} ${field}`);
    }
    for (const field of ["boosting", "alive", "isBot"]) {
      if (typeof shark[field] !== "boolean") invalid(`shark ${id} ${field}`);
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

  if (!Array.isArray(room.rockets) || !room.rockets.every((candidate) => {
    const rocket = asRecord(candidate);
    return Boolean(rocket && !("heading" in rocket) && isVec3(rocket) && typeof rocket.id === "string" && typeof rocket.ownerId === "string" && finite(rocket.yaw) && finite(rocket.pitch) && finite(rocket.expiresTick));
  })) invalid("rockets");

  if (!Array.isArray(room.explosions) || !room.explosions.every((candidate) => {
    const explosion = asRecord(candidate);
    return Boolean(explosion && isVec3(explosion) && typeof explosion.id === "string" && finite(explosion.tick) && typeof explosion.skin === "string" && (explosion.kind === "shark" || explosion.kind === "rocket"));
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
