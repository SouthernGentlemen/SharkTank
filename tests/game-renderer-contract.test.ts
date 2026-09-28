import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(path, import.meta.url));

const gameScreen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
const viewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");
const scene = read("../vendor/ModuleReact3Fiber/src/client/game/Scene.tsx");
const actors = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
const prey = read("../vendor/ModuleReact3Fiber/src/client/game/PreyLayer.tsx");
const fx = read("../vendor/ModuleReact3Fiber/src/client/game/FxLayer.tsx");
const world = read("../vendor/ModuleReact3Fiber/src/client/game/WorldEnvironment.tsx");
const cameraRig = read("../vendor/ModuleReact3Fiber/src/client/game/CameraRig.tsx");
const sceneMath = read("../vendor/ModuleReact3Fiber/src/client/game/sceneMath.ts");
const clientIndex = read("../vendor/ModuleReact3Fiber/src/client/index.ts");
const rendererSources = [viewport, scene, actors, prey, fx, world, cameraRig, sceneMath, clientIndex];

describe("R3F-only gameplay renderer", () => {
  it("mounts one React Three Fiber viewport from the live game screen", () => {
    expect(gameScreen).toContain('import { GameViewport } from "../game/GameViewport.js";');
    expect(gameScreen).toContain("<GameViewport");
    expect(viewport).toContain('import { Canvas } from "@react-three/fiber";');
    expect(viewport).toContain("<Canvas");
    expect(viewport).toContain("<Scene");
    expect(viewport).toContain("useLocalInput(");
  });

  it("splits the live scene into world, actor, prey, FX and camera responsibilities", () => {
    expect(scene).toContain("<WorldEnvironment");
    expect(scene).toContain("<ActorLayer");
    expect(scene).toContain("<PreyLayer");
    expect(scene).toContain("<FxLayer");
    expect(scene).toContain("<CameraRig");
    expect(actors).toContain("useFrame(");
    expect(prey).toContain("useFrame(");
    expect(fx).toContain("useFrame(");
    expect(cameraRig).toContain("useFrame(");
    expect(world).toContain('<fog attach="fog"');
    expect(world).toContain("OCEAN_CUES.surfaceY");
    expect(world).toContain("OCEAN_CUES.seabedY");
    expect(sceneMath).toContain("forwardFromYawPitch");
  });

  it("removes the Canvas2D gameplay path and sprite helper", () => {
    expect(exists("../vendor/ModuleReact3Fiber/src/client/game/GameCanvas.tsx")).toBe(false);
    expect(exists("../vendor/ModuleReact3Fiber/src/client/game/goofySharkSprite.ts")).toBe(false);
    expect(clientIndex).toContain('export { GameViewport } from "./game/GameViewport.js";');
    expect(clientIndex).not.toContain("GameCanvas");
    for (const source of rendererSources) {
      expect(source).not.toContain('getContext("2d"');
      expect(source).not.toContain("CanvasRenderingContext2D");
      expect(source).not.toContain("goofySharkSprite");
    }
  });

  it("renders the volumetric authoritative shape through the same modular R3F layers", () => {
    expect(actors).toContain("LocalPredictor");
    expect(actors).toContain("shark.pitch");
    expect(actors).toContain("predicted.head.y");
    expect(prey).toContain("pellet.y");
    expect(fx).toContain("rocket.y");
    expect(fx).toContain("rocket.pitch");
    expect(fx).toContain("burst.y");
    expect(fx).toContain("frenzyUntilTick");
    expect(fx).toContain("arenaRadius");
    expect(actors).toContain("colorblindLabels");
    expect(actors).toContain("frameAt(INTERP_DELAY_MS)");
  });
});
