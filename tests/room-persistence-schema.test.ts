import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoom,
  replay,
  spawnBots,
  type GameLogEntry,
  type RoomState,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  GAME_LOG_SCHEMA_VERSION,
  assertSchema8RoomState,
  bootstrapRoomSnapshot,
  shouldRotateGameLogSchema,
} from "../src/worker/room-state-schema.js";

const BOT_COUNT = 24;

function schema7Snapshot(): unknown {
  return {
    schemaVersion: 7,
    id: "room-do-123",
    seed: "legacy-seed",
    tick: 731,
    rngState: 123456,
    arena: { radius: 82 },
    snakes: {
      "legacy-player": {
        id: "legacy-player",
        name: "Legacy",
        skin: "cyan",
        path: [{ x: 10, z: -4 }],
        segments: [{ x: 10, z: -4 }],
        heading: 1.25,
        targetHeading: 1.5,
        length: 19,
        boosting: true,
        chargeTicks: 3,
        lungeTicks: 2,
        dashCooldownTick: 800,
        rocketTicks: 1,
        rocketCooldownTick: 900,
        score: 88,
        alive: true,
        isBot: false,
        respawnTick: 0,
        invulnTick: 0,
      },
    },
    food: [{ id: "legacy-food", x: 3, z: 5, value: 2, r: 0.5 }],
    rockets: [{ id: "legacy-rocket", ownerId: "legacy-player", x: 2, z: 3, heading: 0.4, expiresTick: 900 }],
    explosions: [{ id: "legacy-burst", x: 1, z: 2, tick: 700, skin: "cyan", kind: "rocket" }],
    frenzyUntilTick: 750,
  };
}

function assertVolumetric(room: RoomState): void {
  assertSchema8RoomState(room, room.id);
  expect(room.schemaVersion).toBe(8);
  expect("arena" in room).toBe(false);
  for (const shark of Object.values(room.snakes)) {
    expect(Number.isFinite(shark.yaw)).toBe(true);
    expect(Number.isFinite(shark.pitch)).toBe(true);
    expect(shark.path.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(shark.segments.every((point) => Number.isFinite(point.y))).toBe(true);
    expect("heading" in shark).toBe(false);
  }
  expect(room.food.every((food) => Number.isFinite(food.y))).toBe(true);
  expect(room.rockets.every((rocket) => Number.isFinite(rocket.y) && Number.isFinite(rocket.yaw) && Number.isFinite(rocket.pitch))).toBe(true);
  expect(room.explosions.every((burst) => Number.isFinite(burst.y))).toBe(true);
}

describe("Room persisted-state schema boundary", () => {
  it("boots a representative schema-7 snapshot by deterministically resetting transient gameplay", () => {
    const fallback = createRoom({ id: "room-do-123", seed: "fallback-seed", oceanRadius: 82 });
    const first = bootstrapRoomSnapshot(schema7Snapshot(), fallback);
    const second = bootstrapRoomSnapshot(schema7Snapshot(), createRoom({ id: "room-do-123", seed: "other-fallback", oceanRadius: 82 }));

    expect(first.source).toBe("schema-7-reset");
    expect(first.persistSnapshot).toBe(true);
    expect(first.room.id).toBe("room-do-123");
    expect(first.room.seed).toBe("legacy-seed");
    expect(first.room.tick).toBe(0);
    expect(first.room.snakes["legacy-player"]).toBeUndefined();
    expect(first.room.rockets).toEqual([]);
    expect(first.room.explosions).toEqual([]);
    expect(JSON.stringify(first.room)).toBe(JSON.stringify(second.room));

    spawnBots(first.room, BOT_COUNT);
    assertVolumetric(first.room);
    expect(first.room.snakes["legacy-player"]).toBeUndefined();
    expect(JSON.stringify(first.room)).not.toContain('"heading"');
  });

  it("serializes an upgraded snapshot and restores it only as a complete schema-8 room", () => {
    const fallback = createRoom({ id: "room-do-123", seed: "fallback" });
    const upgraded = bootstrapRoomSnapshot(schema7Snapshot(), fallback).room;
    spawnBots(upgraded, BOT_COUNT);

    const serialized = JSON.stringify(upgraded);
    const restored = bootstrapRoomSnapshot(JSON.parse(serialized), createRoom({ id: "room-do-123", seed: "new-fallback" }));
    expect(restored.source).toBe("schema-8");
    expect(restored.persistSnapshot).toBe(false);
    expect(JSON.stringify(restored.room)).toBe(serialized);
    assertVolumetric(restored.room);
  });

  it("accepts fresh schema-8 rooms and replays only schema-8 actions", () => {
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

  it("rotates unknown or schema-7 replay generations instead of interpreting them as schema 8", () => {
    expect(GAME_LOG_SCHEMA_VERSION).toBe(8);
    expect(shouldRotateGameLogSchema(undefined)).toBe(true);
    expect(shouldRotateGameLogSchema(7)).toBe(true);
    expect(shouldRotateGameLogSchema("8")).toBe(true);
    expect(shouldRotateGameLogSchema(8)).toBe(false);
  });

  it("fails closed on incomplete or mixed schema-8 snapshots", () => {
    const missingY = JSON.parse(JSON.stringify(createRoom({ id: "room-do-bad", seed: "bad" }))) as Record<string, any>;
    delete missingY.food[0].y;
    expect(() => bootstrapRoomSnapshot(missingY, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/schema 8 is invalid: food/);

    const mixed = createRoom({ id: "room-do-bad", seed: "mixed" }) as RoomState & { arena?: unknown };
    mixed.arena = { radius: 82 };
    expect(() => bootstrapRoomSnapshot(mixed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/legacy arena field/);

    const wrongRoom = createRoom({ id: "other-room", seed: "mixed" });
    expect(() => bootstrapRoomSnapshot(wrongRoom, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/id does not match Durable Object/);
  });

  it("wires the Durable Object boot path to snapshot persistence, replay rotation and preserved metadata", () => {
    const source = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    expect(source).toContain('bootstrapRoomSnapshot(storedRoom, this.room)');
    expect(source).toContain('this.ctx.storage.get<number>("gameLogSchemaVersion")');
    expect(source).toContain('this.trackSql("DELETE FROM game_log")');
    expect(source).toContain('this.ctx.storage.put("gameLogSchemaVersion", GAME_LOG_SCHEMA_VERSION)');
    expect(source).toContain('if (snapshotBoot.persistSnapshot) { await this.ctx.storage.put("snapshot", this.room)');
    expect(source).toMatch(/this\.roomName = meta\.roomName/);
    expect(source).toMatch(/this\.maintenance = meta\.maintenance \?\? false/);
    expect(source).toMatch(/this\.activeMs = meta\.activeMs \?\? 0/);
    expect(source).toMatch(/this\.wsMessages = meta\.wsMessages \?\? 0/);
    expect(source).toMatch(/this\.connections = meta\.connections \?\? 0/);
    expect(source).not.toContain("requires ST-113 migration");
  });
});
