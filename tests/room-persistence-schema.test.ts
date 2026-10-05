import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREY_KINDS,
  applyAction,
  createRoom,
  spawnBots,
  type RoomState,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import {
  assertSchema11RoomState,
  bootstrapRoomSnapshot,
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

  it("accepts fresh schema-11 rooms and live schema-11 bite actions", () => {
    const fresh = bootstrapRoomSnapshot(undefined, createRoom({ id: "room-do-fresh", seed: "fresh-seed" }));
    expect(fresh.source).toBe("fresh");
    applyAction(fresh.room, { type: "join", playerId: "pilot", name: "Pilot" });
    applyAction(fresh.room, { type: "setOrientation", playerId: "pilot", yaw: 0.75, pitch: 0.2 });
    applyAction(fresh.room, { type: "setBoost", playerId: "pilot", on: true });
    applyAction(fresh.room, { type: "bite", playerId: "pilot" });
    assertCombatRoom(fresh.room);
  });

  it("fails closed on incomplete, mixed or wrong-room schema-11 snapshots", () => {
    const room = createRoom({ id: "room-do-bad", seed: "with-shark" });
    applyAction(room, { type: "join", playerId: "p", name: "P" });
    const malformed = JSON.parse(JSON.stringify(room)) as Record<string, any>;
    delete malformed.snakes.p.health;
    expect(() => bootstrapRoomSnapshot(malformed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/schema 11 is invalid: shark p health/);

    const mixed = JSON.parse(JSON.stringify(createRoom({ id: "room-do-bad", seed: "bad" }))) as Record<string, any>;
    mixed.rockets = [];
    expect(() => bootstrapRoomSnapshot(mixed, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/retired projectile field/);

    const wrongRoom = createRoom({ id: "other-room", seed: "mixed" });
    expect(() => bootstrapRoomSnapshot(wrongRoom, createRoom({ id: "room-do-bad", seed: "fallback" }))).toThrow(/id does not match Durable Object/);
  });

  it("wires the Durable Object boot path to snapshot persistence without log/replay storage", () => {
    const source = readFileSync(new URL("../src/worker/room-do.ts", import.meta.url), "utf8");
    expect(source).toContain("bootstrapRoomSnapshot(storedRoom, this.room)");
    expect(source).toContain('if (snapshotBoot.persistSnapshot) await this.ctx.storage.put("snapshot", this.room)');
    expect(source).toContain('const ROOM_NAME = "SharkTank"');
    expect(source).toMatch(/this\.roomName = ROOM_NAME/);
    expect(source).not.toMatch(/this\.roomName = meta\.roomName/);
    expect(source).toMatch(/this\.maintenance = meta\.maintenance \?\? false/);
    expect(source).not.toContain("game_log");
    expect(source).not.toContain("gameLogSchemaVersion");
    expect(source).not.toContain("reportToLobby");
    expect(source).not.toContain("emitEvent");
  });
});
