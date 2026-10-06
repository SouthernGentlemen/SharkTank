import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(path, import.meta.url));

const gameScreen = read("../src/game/ui/GameScreen.tsx");
const viewport = read("../src/game/game/GameViewport.tsx");
const scene = read("../src/game/game/Scene.tsx");
const actors = read("../src/game/game/ActorLayer.tsx");
const prey = read("../src/game/game/PreyLayer.tsx");
const fx = read("../src/game/game/FxLayer.tsx");
const world = read("../src/game/game/WorldEnvironment.tsx");
const cameraRig = read("../src/game/game/CameraRig.tsx");
const sceneMath = read("../src/game/game/sceneMath.ts");
const app = read("../src/game/App.tsx");
const main = read("../src/client/main.tsx");
const rendererSources = [viewport, scene, actors, prey, fx, world, cameraRig, sceneMath, app];

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
    expect(exists("../src/game/game/GameCanvas.tsx")).toBe(false);
    expect(exists("../src/game/game/goofySharkSprite.ts")).toBe(false);
    expect(exists("../src/game/index.ts")).toBe(false);
    expect(main).toContain('import { App } from "../game/App.js";');
    expect(app).not.toContain("GameCanvas");
    for (const source of rendererSources) {
      expect(source).not.toContain('getContext("2d"');
      expect(source).not.toContain("CanvasRenderingContext2D");
      expect(source).not.toContain("goofySharkSprite");
    }
  });

  it("renders the volumetric authoritative shape through the same modular R3F layers", () => {
    expect(actors).toContain("LocalPredictor");
    expect(actors).toContain("shark.pitch");
    expect(actors).toContain("predicted.position.y");
    expect(prey).toContain("pose.y");
    expect(fx).toContain('burst.kind === "bite"');
    expect(fx.toLowerCase()).not.toContain("rocket");
    expect(fx).toContain("burst.y");
    const world = read("../src/game/game/WorldEnvironment.tsx");
    expect(world).toContain("frenzyUntilTick");
    expect(world).toContain("state.arenaRadius");
    expect(fx).not.toContain("<ringGeometry");
    expect(actors).toContain("colorblindLabels");
    expect(actors).toContain("frameAt(REMOTE_INTERP_DELAY_MS)");
  });
});
