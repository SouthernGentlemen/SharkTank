import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREY_KINDS,
  createRoom,
  replay,
  spawnBots,
  type GameLogEntry,
  type RoomState,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  GAME_LOG_SCHEMA_VERSION,
  assertSchema11RoomState,
  bootstrapRoomSnapshot,
  shouldRotateGameLogSchema,
} from "../src/worker/room-state-schema.js";

const BOT_COUNT = 24;

function legacySnapshot(version: 7 | 8 | 9 | 10): unknown {
  return {
    schemaVersion: version,
    id: "room-do-123",
    seed: `legacy-schema-${version}`,
    tick: 731,
    rngState: 123456,
    ...(version === 7 ? { arena: { radius: 82 } } : { ocean: { radius: 74, seabedY: -14, surfaceY: 10 } }),
    snakes: {},
    food: [],
    rockets: version === 9 ? [{ id: "legacy-projectile" }] : [],
    explosions: [],
    frenzyUntilTick: 750,
  };
}

function assertCombatRoom(room: RoomState): void {
  assertSchema11RoomState(room, room.id);
  expect(room.schemaVersion).toBe(11);
  expect("arena" in room).toBe(false);
  expect("rockets" in room).toBe(false);
  for (const shark of Object.values(room.snakes)) {
    expect(Number.isFinite(shark.yaw)).toBe(true);
    expect(Number.isFinite(shark.pitch)).toBe(true);
    expect(shark.path.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(shark.segments.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(shark.health).toBeGreaterThanOrEqual(0);
    expect(shark.health).toBeLessThanOrEqual(100);
    expect(Number.isFinite(shark.biteCooldownTick)).toBe(true);
    expect("rocketTicks" in shark).toBe(false);
  }
  expect(room.food.every((prey) => PREY_KINDS.includes(prey.kind) && Number.isFinite(prey.y) && Number.isFinite(prey.yaw) && Number.isFinite(prey.pitch) && Number.isInteger(prey.school))).toBe(true);
  expect(room.explosions.every((burst) => ["shark", "bite", "frenzy"].includes(burst.kind))).toBe(true);
}

describe("Room persisted-state schema boundary", () => {
  it("resets schemas 7, 8, 9 and 10 rather than reinterpreting old combat state as schema 11", () => {
    for (const version of [7, 8, 9, 10] as const) {
      const fallback = createRoom({ id: "room-do-123", seed: "fallback-seed", oceanRadius: 82 });
      const boot = bootstrapRoomSnapshot(legacySnapshot(version), fallback);
      expect(boot.source).toBe(`schema-${version}-reset`);
      expect(boot.persistSnapshot).toBe(true);
      expect(boot.room.id).toBe("room-do-123");
      expect(boot.room.seed).toBe(`legacy-schema-${version}`);
      expect(boot.room.tick).toBe(0);
      if (version >= 8) expect(boot.room.ocean).toEqual({ radius: 74, seabedY: -14, surfaceY: 10 });
      assertCombatRoom(boot.room);
    }
  });

  it("serializes and restores only complete schema-11 combat state", () => {
    const room = createRoom({ id: "room-do-123", seed: "combat" });
    spawnBots(room, BOT_COUNT);
    const serialized = JSON.stringify(room);
    const restored = bootstrapRoomSnapshot(JSON.parse(serialized), createRoom({ id: "room-do-123", seed: "fallback" }));
    expect(restored.source).toBe("schema-11");
    expect(restored.persistSnapshot).toBe(false);
    expect(JSON.stringify(restored.room)).toBe(serialized);
    assertCombatRoom(restored.room);
  });

  it("accepts fresh schema-11 rooms and replays schema-11 bite actions deterministically", () => {
    const fresh = bootstrapRoomSnapshot(undefined, createRoom({ id: "room-do-fresh", seed: "fresh-seed" }));
    expect(fresh.source).toBe("fresh");
    assertCombatRoom(fresh.room);

    const events: GameLogEntry[] = [
      { tick: 0, action: { type: "join", playerId: "pilot", name: "Pilot" } },
      { tick: 0, action: { type: "setOrientation", playerId: "pilot", yaw: 0.75, pitch: 0.2 } },
      { tick: 1, action: { type: "setBoost", playerId: "pilot", on: true } },
      { tick: 2, action: { type: "bite", playerId: "pilot" } },
    ];
    const first = replay({ id: "room-do-fresh", seed: "fresh-seed", botCount: 0 }, events, 4);
    const second = replay({ id: "room-do-fresh", seed: "fresh-seed", botCount: 0 }, events, 4);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    assertCombatRoom(first);
  });

  it("rotates every older replay generation and keeps only schema 11 current", () => {
    expect(GAME_LOG_SCHEMA_VERSION).toBe(11);
    expect(shouldRotateGameLogSchema(undefined)).toBe(true);
    expect(shouldRotateGameLogSchema(7)).toBe(true);
    expect(shouldRotateGameLogSchema(8)).toBe(true);
    expect(shouldRotateGameLogSchema(9)).toBe(true);
    expect(shouldRotateGameLogSchema("11")).toBe(true);
    expect(shouldRotateGameLogSchema(10)).toBe(true);
    expect(shouldRotateGameLogSchema(11)).toBe(false);
  });

  it("fails closed on incomplete, mixed or wrong-room schema-11 snapshots", () => {
    const replayed = replay({ id: "room-do-bad", seed: "with-shark", botCount: 0 }, [{ tick: 0, action: { type: "join", playerId: "p", name: "P" } }], 0);
    const malformed = JSON.parse(JSON.stringify(replayed)) as Record<string, any>;
    delete malformed.snakes.p.health;
    expect(() => bootstrapRoomSnapshot(malformed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/schema 11 is invalid: shark p health/);

    const mixed = JSON.parse(JSON.stringify(createRoom({ id: "room-do-bad", seed: "bad" }))) as Record<string, any>;
    mixed.rockets = [];
    expect(() => bootstrapRoomSnapshot(mixed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/retired projectile field/);

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
    expect(source).toContain('const ROOM_NAME = "SharkTank"');
    expect(source).toMatch(/this\.roomName = ROOM_NAME/);
    expect(source).not.toMatch(/this\.roomName = meta\.roomName/);
    expect(source).toMatch(/this\.maintenance = meta\.maintenance \?\? false/);
    expect(source).toMatch(/this\.activeMs = meta\.activeMs \?\? 0/);
  });
});
