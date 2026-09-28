import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREY_KINDS,
  applyAction,
  createRoom,
  replay,
  spawnBots,
  type GameLogEntry,
  type RoomState,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  GAME_LOG_SCHEMA_VERSION,
  assertSchema9RoomState,
  bootstrapRoomSnapshot,
  shouldRotateGameLogSchema,
} from "../src/worker/room-state-schema.js";

const BOT_COUNT = 24;

function schema7Snapshot(): unknown {
  return {
    schemaVersion: 7,
    id: "room-do-123",
    seed: "legacy-planar-seed",
    tick: 731,
    rngState: 123456,
    arena: { radius: 82 },
    snakes: {},
    food: [{ id: "legacy-food", x: 3, z: 5, value: 2, r: 0.5 }],
    rockets: [],
    explosions: [],
    frenzyUntilTick: 750,
  };
}

function schema8Snapshot(): unknown {
  return {
    schemaVersion: 8,
    id: "room-do-123",
    seed: "legacy-volumetric-seed",
    tick: 812,
    rngState: 654321,
    ocean: { radius: 74, seabedY: -14, surfaceY: 10 },
    snakes: {},
    food: [{ id: "legacy-pellet", x: 3, y: -2, z: 5, value: 2, r: 0.5 }],
    rockets: [],
    explosions: [],
    frenzyUntilTick: 900,
  };
}

function assertVolumetric(room: RoomState): void {
  assertSchema9RoomState(room, room.id);
  expect(room.schemaVersion).toBe(9);
  expect("arena" in room).toBe(false);
  for (const shark of Object.values(room.snakes)) {
    expect(Number.isFinite(shark.yaw)).toBe(true);
    expect(Number.isFinite(shark.pitch)).toBe(true);
    expect(shark.path.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(shark.segments.every((point) => Number.isFinite(point.y))).toBe(true);
    expect("heading" in shark).toBe(false);
  }
  expect(room.food.every((prey) => (
    PREY_KINDS.includes(prey.kind)
    && Number.isFinite(prey.y)
    && Number.isFinite(prey.yaw)
    && Number.isFinite(prey.pitch)
    && Number.isInteger(prey.school)
  ))).toBe(true);
  expect(room.rockets.every((rocket) => Number.isFinite(rocket.y) && Number.isFinite(rocket.yaw) && Number.isFinite(rocket.pitch))).toBe(true);
  expect(room.explosions.every((burst) => Number.isFinite(burst.y))).toBe(true);
}

describe("Room persisted-state schema boundary", () => {
  it("resets schema-7 planar state and schema-8 pellet state instead of misreading either as schema 9", () => {
    const fallback = createRoom({ id: "room-do-123", seed: "fallback-seed", oceanRadius: 82 });
    const planar = bootstrapRoomSnapshot(schema7Snapshot(), fallback);
    expect(planar.source).toBe("schema-7-reset");
    expect(planar.persistSnapshot).toBe(true);
    expect(planar.room.id).toBe("room-do-123");
    expect(planar.room.seed).toBe("legacy-planar-seed");
    expect(planar.room.tick).toBe(0);
    assertVolumetric(planar.room);

    const volumetric = bootstrapRoomSnapshot(schema8Snapshot(), createRoom({ id: "room-do-123", seed: "other-fallback" }));
    expect(volumetric.source).toBe("schema-8-reset");
    expect(volumetric.persistSnapshot).toBe(true);
    expect(volumetric.room.seed).toBe("legacy-volumetric-seed");
    expect(volumetric.room.ocean).toEqual({ radius: 74, seabedY: -14, surfaceY: 10 });
    expect(volumetric.room.tick).toBe(0);
    expect(volumetric.room.food.some((prey) => prey.kind === "bait" || prey.kind === "reef")).toBe(true);
    expect(JSON.stringify(volumetric.room)).not.toContain("legacy-pellet");
    assertVolumetric(volumetric.room);
  });

  it("serializes and restores only complete schema-9 room state", () => {
    const upgraded = bootstrapRoomSnapshot(schema8Snapshot(), createRoom({ id: "room-do-123", seed: "fallback" })).room;
    spawnBots(upgraded, BOT_COUNT);

    const serialized = JSON.stringify(upgraded);
    const restored = bootstrapRoomSnapshot(JSON.parse(serialized), createRoom({ id: "room-do-123", seed: "new-fallback" }));
    expect(restored.source).toBe("schema-9");
    expect(restored.persistSnapshot).toBe(false);
    expect(JSON.stringify(restored.room)).toBe(serialized);
    assertVolumetric(restored.room);
  });

  it("accepts fresh schema-9 rooms and replays only schema-9 actions", () => {
    const fresh = bootstrapRoomSnapshot(undefined, createRoom({ id: "room-do-fresh", seed: "fresh-seed" }));
    expect(fresh.source).toBe("fresh");
    assertVolumetric(fresh.room);

    const events: GameLogEntry[] = [
      { tick: 0, action: { type: "join", playerId: "pilot", name: "Pilot" } },
      { tick: 0, action: { type: "setOrientation", playerId: "pilot", yaw: 0.75, pitch: 0.2 } },
      { tick: 1, action: { type: "setBoost", playerId: "pilot", on: true } },
    ];
    const replayed = replay({ id: "room-do-fresh", seed: "fresh-seed", botCount: 0 }, events, 3);
    assertVolumetric(replayed);

    const restored = bootstrapRoomSnapshot(JSON.parse(JSON.stringify(replayed)), createRoom({ id: "room-do-fresh", seed: "fallback" }));
    expect(JSON.stringify(restored.room)).toBe(JSON.stringify(replayed));
  });

  it("rotates unknown, schema-7 and schema-8 replay generations instead of interpreting them as schema 9", () => {
    expect(GAME_LOG_SCHEMA_VERSION).toBe(9);
    expect(shouldRotateGameLogSchema(undefined)).toBe(true);
    expect(shouldRotateGameLogSchema(7)).toBe(true);
    expect(shouldRotateGameLogSchema(8)).toBe(true);
    expect(shouldRotateGameLogSchema("9")).toBe(true);
    expect(shouldRotateGameLogSchema(9)).toBe(false);
  });

  it("fails closed on incomplete or mixed schema-9 snapshots", () => {
    const missingKind = JSON.parse(JSON.stringify(createRoom({ id: "room-do-bad", seed: "bad" }))) as Record<string, any>;
    delete missingKind.food[0].kind;
    expect(() => bootstrapRoomSnapshot(missingKind, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/schema 9 is invalid: prey/);

    const mixed = createRoom({ id: "room-do-bad", seed: "mixed" }) as RoomState & { arena?: unknown };
    mixed.arena = { radius: 82 };
    expect(() => bootstrapRoomSnapshot(mixed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/legacy arena field/);

    const wrongRoom = createRoom({ id: "other-room", seed: "mixed" });
    expect(() => bootstrapRoomSnapshot(wrongRoom, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/id does not match Durable Object/);
  });

  it("wires the Durable Object boot path to snapshot persistence, replay rotation and preserved metadata", () => {
    const source = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    expect(source).toContain("bootstrapRoomSnapshot(storedRoom, this.room)");
    expect(source).toContain('this.ctx.storage.get<number>("gameLogSchemaVersion")');
    expect(source).toContain('this.trackSql("DELETE FROM game_log")');
    expect(source).toContain('this.ctx.storage.put("gameLogSchemaVersion", GAME_LOG_SCHEMA_VERSION)');
    expect(source).toContain('if (snapshotBoot.persistSnapshot) { await this.ctx.storage.put("snapshot", this.room)');
    expect(source).toContain('snapshotBoot.source.endsWith("-reset")');
    expect(source).toMatch(/this\.roomName = meta\.roomName/);
    expect(source).toMatch(/this\.maintenance = meta\.maintenance \?\? false/);
    expect(source).toMatch(/this\.activeMs = meta\.activeMs \?\? 0/);
    expect(source).toMatch(/this\.wsMessages = meta\.wsMessages \?\? 0/);
    expect(source).toMatch(/this\.connections = meta\.connections \?\? 0/);
  });
});
