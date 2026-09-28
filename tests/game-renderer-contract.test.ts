import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(path, import.meta.url));

const gameScreen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
const viewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");
const scene = read("../vendor/ModuleReact3Fiber/src/client/game/Scene.tsx");
const clientIndex = read("../vendor/ModuleReact3Fiber/src/client/index.ts");

describe("R3F-only gameplay renderer", () => {
  it("mounts one React Three Fiber viewport from the live game screen", () => {
    expect(gameScreen).toContain('import { GameViewport } from "../game/GameViewport.js";');
    expect(gameScreen).toContain("<GameViewport");
    expect(viewport).toContain('import { Canvas } from "@react-three/fiber";');
    expect(viewport).toContain("<Canvas");
    expect(viewport).toContain("<Scene");
    expect(viewport).toContain("useLocalInput(");
  });

  it("removes the Canvas2D gameplay path and sprite helper", () => {
    expect(exists("../vendor/ModuleReact3Fiber/src/client/game/GameCanvas.tsx")).toBe(false);
    expect(exists("../vendor/ModuleReact3Fiber/src/client/game/goofySharkSprite.ts")).toBe(false);
    expect(clientIndex).toContain('export { GameViewport } from "./game/GameViewport.js";');
    expect(clientIndex).not.toContain("GameCanvas");
    for (const source of [gameScreen, viewport, scene, clientIndex]) {
      expect(source).not.toContain('getContext("2d"');
      expect(source).not.toContain("CanvasRenderingContext2D");
      expect(source).not.toContain("goofySharkSprite");
    }
  });

  it("keeps the planar parity cues inside the R3F scene until later gameplay tasks", () => {
    expect(scene).toContain("LocalPredictor");
    expect(scene).toContain("state.rockets");
    expect(scene).toContain("state.explosions");
    expect(scene).toContain("frenzyUntilTick");
    expect(scene).toContain("arenaRadius");
    expect(scene).toContain("colorblindLabels");
    expect(scene).toContain("frameAt(INTERP_DELAY_MS)");
  });
});
