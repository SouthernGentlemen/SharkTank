import { isPreyConsumeCandidate } from "../src/game/audio/spatialAudio.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOM_SCHEMA_VERSION, sharkScaleForLength } from "../src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";
import {
  AUDIO_LIMITS,
  attenuationForDistance,
  directionCaption,
  emitterCapForQuality,
  isFreshAudioEvent,
  selectSpatialEmitters,
  spatialMix,
} from "../src/game/audio/spatialAudio.js";

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
    const manager = read("../src/game/audio/AudioManager.ts");
    expect(manager).toContain('panner.panningModel = "HRTF"');
    expect(manager).toContain("AUDIO_LIMITS.maxWorldVoices");
    expect(manager).toContain("AUDIO_LIMITS.listenerUpdateMs");
    expect(manager).toContain('document.addEventListener("visibilitychange"');
    expect(manager).toContain('window.addEventListener("pointerdown"');
    expect(manager).toContain("this.ctx.suspend()");
    expect(manager).toContain("stopSession()");
    expect(manager).toContain("startAmbience");
    expect(manager).toContain("new MusicLookaheadScheduler(");
    expect(manager).toContain("this.musicScheduler?.stop()");
    expect(manager).toContain("for (const note of [...this.musicNotes]) note.stop()");
    expect(manager).toContain("osc.start(at)");
    expect(manager).not.toContain("this.seqTimer = setInterval");
  });

  it("drives cues only from existing authoritative snapshot truth", () => {
    const hook = read("../src/game/audio/useGameAudio.ts");
    expect(hook).toContain("state.explosions");
    expect(hook).toContain('burst.kind === "bite"');
    expect(hook).toContain("state.round.phase");
    expect(hook).toContain("state.frenzyUntilTick");
    expect(hook).toContain("selectSpatialEmitters");
    expect(hook).toContain("settings.graphics.quality");
    expect(hook).toContain("captionReachable");
    expect(hook).toContain("return played || captioned");
    expect(hook).not.toContain("socket.send");
    expect(hook).not.toContain("applyAction(");
  });

  it("keeps listener orientation tied to the actual chase camera", () => {
    const camera = read("../src/game/game/CameraRig.tsx");
    expect(camera).toContain("audio.setListener(");
    expect(camera).toContain("current.lookAt.x - current.position.x");
  });

  it("pins 35% gesture-gated default music and state identities unchanged", () => {
    const settings = read("../src/game/settings/SettingsContext.tsx");
    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    expect(settings).toContain("audio: { master: 0.8, sfx: 0.9, music: 0.35, captions: false }");
    expect(packageJson.version).toBe("2.4.0");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
  });

});


it("ST-241 ignores distant culling and tests mouth distance in all three axes", () => {
  const shark = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, length: 0, alive: true };
  const mouthX = 2.6 * sharkScaleForLength(shark.length);
  expect(isPreyConsumeCandidate({ x: mouthX + 12, y: 0, z: 0 }, [shark])).toBe(true);
  expect(isPreyConsumeCandidate({ x: mouthX + 12.01, y: 0, z: 0 }, [shark])).toBe(false);
  expect(isPreyConsumeCandidate({ x: 72, y: 0, z: 0 }, [shark])).toBe(false);
  expect(isPreyConsumeCandidate({ x: mouthX, y: 12.01, z: 0 }, [shark])).toBe(false);
  expect(isPreyConsumeCandidate({ x: mouthX, y: 0, z: 0 }, [{ ...shark, alive: false }])).toBe(false);
  expect(isPreyConsumeCandidate({ x: 0, y: mouthX + 12, z: 0 }, [{ ...shark, pitch: Math.PI / 2 }])).toBe(true);
  const hook = read("../src/game/audio/useGameAudio.ts");
  expect(hook).toContain("!isPreyConsumeCandidate(previousPrey, state.sharks)");
});
