import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NetPrey, NetSnake, NetState } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  buildDepthNavigation,
  cueDescription,
  describeRelativeTarget,
} from "../vendor/ModuleReact3Fiber/src/client/ui/DepthRadar.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function shark(id: string, x: number, y: number, z: number, overrides: Partial<NetSnake> = {}): NetSnake {
  return {
    id,
    name: id,
    skin: "reef",
    segments: [{ x, y, z }],
    yaw: 0,
    pitch: 0,
    length: 10,
    boosting: false,
    chargeTicks: 0,
    lungeTicks: 0,
    dashCooldownTick: 0,
    health: 100,
    biteCooldownTick: 0,
    score: 0,
    alive: true,
    ...overrides,
  };
}

function prey(id: string, x: number, y: number, z: number, kind: NetPrey["kind"] = "reef"): NetPrey {
  return { id, kind, x, y, z, value: kind === "chum" ? 3 : 1, r: 0.6, yaw: 0, pitch: 0 };
}

function state(): NetState {
  return {
    schemaVersion: 11,
    tick: 100,
    arenaRadius: 120,
    seabedY: -60,
    surfaceY: 20,
    snakes: [shark("you", 0, -8, 0)],
    food: [],
    explosions: [],
    frenzyUntilTick: 0,
    round: {
      number: 1,
      phase: "active",
      startTick: 0,
      apexStartTick: 5100,
      endTick: 6000,
      resultEndTick: 6200,
      apexId: null,
      result: null,
    },
  };
}

describe("ST-126 depth-aware competitive cues", () => {
  it("describes heading-relative direction, vertical relationship and proximity in full XYZ", () => {
    expect(describeRelativeTarget(
      { x: 0, y: 0, z: 0 },
      0,
      { x: 10, y: 8, z: 10 },
    )).toMatchObject({ bearing: "ahead-right", vertical: "above", proximity: "near" });

    expect(describeRelativeTarget(
      { x: 0, y: 0, z: 0 },
      0,
      { x: -10, y: -8, z: 0 },
    )).toMatchObject({ bearing: "behind", vertical: "below", proximity: "near" });

    expect(describeRelativeTarget(
      { x: 0, y: 0, z: 0 },
      Math.PI / 2,
      { x: 0, y: 8, z: 12 },
    )).toMatchObject({ bearing: "ahead", vertical: "above" });
  });

  it("derives Apex, Frenzy, rival and prey cues only from authoritative snapshot truth", () => {
    const snapshot = state();
    snapshot.snakes.push(
      shark("Apex", -34, 10, 0, { length: 15, score: 90 }),
      shark("Hunter", 12, -15, 8, { length: 13 }),
    );
    snapshot.food.push(prey("reef-1", 10, 3, 2));
    snapshot.round.phase = "apex";
    snapshot.round.apexId = "Apex";
    snapshot.frenzyUntilTick = 400;

    const nav = buildDepthNavigation(snapshot, "you", false);
    expect(nav.depth).toBe(28);
    expect(nav.cues.map((item) => item.kind)).toEqual(expect.arrayContaining(["apex", "frenzy", "rival", "prey"]));
    expect(nav.cues.find((item) => item.kind === "apex")).toMatchObject({
      label: "Apex",
      bearing: "behind",
      vertical: "above",
    });
    expect(cueDescription(nav.cues.find((item) => item.kind === "rival")!)).toMatch(/larger rival: Hunter.*below/i);
  });

  it("keeps the touch view bounded while preserving the same information hierarchy", () => {
    const snapshot = state();
    snapshot.round.phase = "apex";
    snapshot.round.apexId = "apex";
    snapshot.snakes.push(
      shark("apex", -45, 6, 0, { score: 100 }),
      shark("rival-1", 8, 0, 8, { length: 14 }),
      shark("rival-2", 14, -18, 2, { length: 12 }),
    );
    snapshot.food.push(prey("food-1", 6, 8, 3), prey("food-2", 18, -22, 2));
    snapshot.frenzyUntilTick = 300;

    const desktop = buildDepthNavigation(snapshot, "you", false);
    const touch = buildDepthNavigation(snapshot, "you", true);
    expect(desktop.cues.length).toBeLessThanOrEqual(5);
    expect(touch.cues.length).toBeLessThanOrEqual(3);
    expect(touch.cues[0]?.kind).toBe("apex");
    expect(touch.cues[1]?.kind).toBe("frenzy");
  });

  it("marks the local Apex without inventing another target or requiring color", () => {
    const snapshot = state();
    snapshot.round.phase = "apex";
    snapshot.round.apexId = "you";
    const nav = buildDepthNavigation(snapshot, "you");
    expect(nav.apexSelf).toBe(true);
    expect(nav.cues.some((item) => item.kind === "apex")).toBe(false);

    const radar = read("../vendor/ModuleReact3Fiber/src/client/ui/DepthRadar.tsx");
    expect(radar).toContain("◆ YOU ARE APEX");
    expect(radar).toContain("ABOVE ↑");
    expect(radar).toContain("BELOW ↓");
    expect(radar).toContain('aria-label="3D navigation cues"');
    expect(radar).not.toContain("getContext");
    expect(radar).not.toContain("socket.send");
  });

  it("removes the planar minimap, bounds labels and keeps touch radar clear of edge controls", () => {
    const screen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
    const actor = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
    const labels = read("../vendor/ModuleReact3Fiber/src/client/ui/SnakeLabels.tsx");
    const settings = read("../vendor/ModuleReact3Fiber/src/client/ui/Settings.tsx");
    const css = read("../vendor/ModuleReact3Fiber/src/client/ui/theme.css");
    const plan = read("../implementation_plan.md");

    expect(screen).toContain("<DepthRadar");
    expect(screen).not.toContain("<Minimap");
    expect(settings).toContain('label="Show depth radar"');
    expect(actor).toContain("camera.getWorldDirection(cameraForward)");
    expect(actor).toContain("labelDistance <= 54");
    expect(actor).toContain("labels.length = 7");
    expect(labels).toContain('l.apex ? " · APEX" : ""');
    expect(css).toContain(".game-screen--touch .game-depth-radar");
    expect(css).toContain("width:min(300px,36vw)");
    expect(css).toContain("bottom:calc(12px + var(--safe-b))");
    expect(css).not.toContain(".game-minimap");
    expect(plan).not.toContain("### ST-126");
    expect(plan).not.toContain("### ST-127");
    expect(plan).not.toContain("### ST-128");
    expect(plan).not.toContain("### ST-129");
    expect(plan).not.toContain("### ST-131");
    expect(plan).not.toContain("### ST-132");
    expect(plan).toContain("The queue is empty. Select no implementation task.");
  });

  it("keeps wire identity at 11 while the RoomState persistence schema field is retired", () => {
    const protocol = read("../vendor/ModuleReact3Fiber/src/protocol/index.ts");
    const engineTypes = read("../vendor/ModuleReact3Fiber/src/engine/types.ts");
    const pkg = JSON.parse(read("../package.json")) as { version: string };
    expect(protocol).toContain("REALTIME_PROTOCOL_VERSION = 11");
    expect(protocol).toContain("schemaVersion: 11;");
    expect(engineTypes).not.toContain("schemaVersion: 11");
    expect(pkg.version).toBe("2.0.1");
  });
});
