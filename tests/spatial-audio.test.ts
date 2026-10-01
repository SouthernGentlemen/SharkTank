import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOM_SCHEMA_VERSION } from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import {
  AUDIO_LIMITS,
  attenuationForDistance,
  directionCaption,
  emitterCapForQuality,
  isFreshAudioEvent,
  selectSpatialEmitters,
  spatialMix,
} from "../vendor/ModuleReact3Fiber/src/client/audio/spatialAudio.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-125 spatial underwater game audio", () => {
  const listener = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };

  it("uses deterministic bounded distance attenuation", () => {
    expect(attenuationForDistance(0, 40)).toBe(1);
    expect(attenuationForDistance(20, 40)).toBeCloseTo(0.25);
    expect(attenuationForDistance(40, 40)).toBe(0);
    expect(attenuationForDistance(80, 40)).toBe(0);
  });

  it("resolves left/right, front/back and depth from a 3D listener pose", () => {
    expect(spatialMix(listener, { x: 8, y: 0, z: 8 }).pan).toBeGreaterThan(0);
    expect(spatialMix(listener, { x: 8, y: 0, z: -8 }).pan).toBeLessThan(0);
    expect(spatialMix(listener, { x: -8, y: 0, z: 0 }).front).toBeLessThan(0);
    expect(spatialMix(listener, { x: 8, y: 10, z: 0 }).vertical).toBeGreaterThan(0);
    expect(directionCaption(listener, { x: 5, y: 8, z: 8 })).toContain("right");
    expect(directionCaption(listener, { x: 5, y: 8, z: 8 })).toContain("above");
  });

  it("prioritizes representative emitters and caps them by quality", () => {
    const selected = selectSpatialEmitters(listener.position, [
      { id: "far-high", position: { x: 20, y: 0, z: 0 }, priority: 10 },
      { id: "near-low", position: { x: 2, y: 0, z: 0 }, priority: 1 },
      { id: "outside", position: { x: 99, y: 0, z: 0 }, priority: 99 },
    ], 2, 30);
    expect(selected.map((item) => item.id)).toEqual(["far-high", "near-low"]);
    expect(emitterCapForQuality("low")).toBeLessThan(emitterCapForQuality("high"));
    expect(emitterCapForQuality("high")).toBeLessThanOrEqual(6);
  });

  it("rejects stale transient world events on late join or reconnect", () => {
    expect(isFreshAudioEvent(100, 105)).toBe(true);
    expect(isFreshAudioEvent(100, 100 + AUDIO_LIMITS.freshEventTicks + 1)).toBe(false);
    expect(isFreshAudioEvent(110, 100)).toBe(false);
  });

  it("keeps the browser graph bounded, lifecycle-safe and user-gesture safe", () => {
    const manager = read("../vendor/ModuleReact3Fiber/src/client/audio/AudioManager.ts");
    expect(manager).toContain('panner.panningModel = "HRTF"');
    expect(manager).toContain("AUDIO_LIMITS.maxWorldVoices");
    expect(manager).toContain("AUDIO_LIMITS.listenerUpdateMs");
    expect(manager).toContain('document.addEventListener("visibilitychange"');
    expect(manager).toContain('window.addEventListener("pointerdown"');
    expect(manager).toContain("this.ctx.suspend()");
    expect(manager).toContain("stopSession()");
    expect(manager).toContain("startAmbience");
  });

  it("drives cues only from existing authoritative snapshot truth", () => {
    const hook = read("../vendor/ModuleReact3Fiber/src/client/audio/useGameAudio.ts");
    expect(hook).toContain("state.explosions");
    expect(hook).toContain('burst.kind === "bite"');
    expect(hook).toContain("state.round.phase");
    expect(hook).toContain("state.frenzyUntilTick");
    expect(hook).toContain("selectSpatialEmitters");
    expect(hook).toContain("settings.graphics.quality");
    expect(hook).not.toContain("socket.send");
    expect(hook).not.toContain("applyAction(");
  });

  it("keeps listener orientation tied to the actual chase camera", () => {
    const camera = read("../vendor/ModuleReact3Fiber/src/client/game/CameraRig.tsx");
    expect(camera).toContain("audio.setListener(");
    expect(camera).toContain("current.lookAt.x - current.position.x");
  });

  it("keeps music opt-in and state identities unchanged", () => {
    const settings = read("../vendor/ModuleReact3Fiber/src/client/settings/SettingsContext.tsx");
    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    expect(settings).toContain("audio: { master: 0.8, sfx: 0.9, music: 0, captions: false }");
    expect(packageJson.version).toBe("2.0.0");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
  });

  it("removes only ST-125 from the current-only queue", () => {
    const plan = read("../implementation_plan.md");
    expect(plan).not.toContain("### ST-125");
    expect(plan).toContain("### ST-126");
    expect(plan.indexOf("### ST-126")).toBeLessThan(plan.indexOf("### ST-127"));
  });
});
