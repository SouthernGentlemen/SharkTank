import { isPreyConsumeCandidate, presenceCueInterval, swimSpeedBetween } from "../src/game/audio/spatialAudio.js";
import { createSfxNoise, SFX_RECIPES, swimTexture } from "../src/game/audio/sfxVoices.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { audio } from "../src/game/audio/AudioManager.js";
import { createUnderwaterBus, UNDERWATER_BUS } from "../src/game/audio/underwaterBus.js";
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
    expect(packageJson.version).toBe("2.5.0");
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


class FakeParam {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(value: number): void { this.value = value; this.targets.push(value); }
}
class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  constructor(readonly kind: string) {}
  connect<T extends FakeNode>(target: T): T { this.connections.push(target); return target; }
  disconnect(): void { this.connections = []; this.disconnected = true; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode {
  type = "";
  frequency = new FakeParam();
  Q = new FakeParam();
}
class FakeConvolver extends FakeNode { buffer: FakeBuffer | null = null; }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
}
class FakeBuffer {
  readonly channels: Float32Array[];
  readonly numberOfChannels: number;
  constructor(channels: number, readonly length: number, readonly sampleRate: number) {
    this.numberOfChannels = channels;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array { return this.channels[channel]; }
}
class FakeContext {
  readonly sampleRate = 8000;
  readonly destination = new FakeNode("destination");
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly convolvers: FakeConvolver[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly currentTime = 2;
  readonly state = "running";
  createGain(): FakeGain { const node = new FakeGain("gain"); this.gains.push(node); return node; }
  createBiquadFilter(): FakeFilter { const node = new FakeFilter("filter"); this.filters.push(node); return node; }
  createConvolver(): FakeConvolver { const node = new FakeConvolver("convolver"); this.convolvers.push(node); return node; }
  createDynamicsCompressor(): FakeCompressor { const node = new FakeCompressor("limiter"); this.compressors.push(node); return node; }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    const buffer = new FakeBuffer(channels, length, rate);
    this.buffers.push(buffer);
    return buffer;
  }
  resume(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
}

describe("ST-279 underwater output graph", () => {
  it("runs both music and SFX through one low-pass, dry/wet reverb, and final limiter", () => {
    const ctx = new FakeContext();
    const master = ctx.createGain(), sfx = ctx.createGain(), music = ctx.createGain();
    const graph = createUnderwaterBus(ctx as unknown as AudioContext, music as unknown as GainNode,
      sfx as unknown as GainNode, master as unknown as GainNode);
    const lowpass = ctx.filters[0];
    const convolver = ctx.convolvers[0];
    const limiter = ctx.compressors[0];
    const [dry, wet] = ctx.gains.slice(3);
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.convolvers).toHaveLength(1);
    expect(ctx.compressors).toHaveLength(1);
    expect(music.connections).toEqual([lowpass]);
    expect(sfx.connections).toEqual([lowpass]);
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.value).toBe(UNDERWATER_BUS.lowpassHz);
    expect(lowpass.connections).toEqual([dry, convolver]);
    expect(dry.connections).toEqual([master]);
    expect(convolver.connections).toEqual([wet]);
    expect(wet.connections).toEqual([master]);
    expect(dry.gain.value + wet.gain.value).toBeCloseTo(1);
    expect(master.connections).toEqual([limiter]);
    expect(limiter.connections).toEqual([ctx.destination]);
    expect(limiter.threshold.value).toBeLessThan(0);
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(10);
    expect(limiter.attack.value).toBeGreaterThan(0);
    expect(limiter.release.value).toBeGreaterThan(0);
    graph.disconnect();
    graph.disconnect();
    for (const node of [music, sfx, lowpass, dry, convolver, wet, master, limiter]) {
      expect(node.connections).toHaveLength(0);
      expect(node.disconnected).toBe(true);
    }
    expect(convolver.buffer).toBeNull();
  });

  it("generates a bounded deterministic decaying stereo impulse with no runtime asset", () => {
    const make = () => {
      const ctx = new FakeContext();
      const graph = createUnderwaterBus(ctx as unknown as AudioContext,
        ctx.createGain() as unknown as GainNode, ctx.createGain() as unknown as GainNode,
        ctx.createGain() as unknown as GainNode);
      return { ctx, graph };
    };
    const a = make(), b = make();
    const first = a.ctx.buffers[0], second = b.ctx.buffers[0];
    expect(first.numberOfChannels).toBe(2);
    expect(first.length).toBe(Math.floor(a.ctx.sampleRate * UNDERWATER_BUS.reverbSeconds));
    expect(first.length).toBeLessThanOrEqual(a.ctx.sampleRate);
    expect(first.getChannelData(0).slice(0, 24)).toEqual(second.getChannelData(0).slice(0, 24));
    expect(first.getChannelData(1).slice(0, 24)).toEqual(second.getChannelData(1).slice(0, 24));
    expect(first.getChannelData(0).slice(0, 24)).not.toEqual(first.getChannelData(1).slice(0, 24));
    const average = (values: Float32Array) => values.reduce((sum, x) => sum + Math.abs(x), 0) / values.length;
    expect(average(first.getChannelData(0).slice(0, 100))).toBeGreaterThan(
      average(first.getChannelData(0).slice(-100)) * 10);
    a.graph.disconnect();
    b.graph.disconnect();
  });

  it("preserves independent 0–1 user volume mapping and cleans up on dispose", () => {
    let ctx: FakeContext | null = null;
    class Context extends FakeContext {
      constructor() { super(); ctx = this; }
    }
    vi.stubGlobal("window", {
      AudioContext: Context,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("document", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    try {
      audio.ensure();
      expect(ctx).not.toBeNull();
      const runtime = ctx!;
      expect(runtime.gains).toHaveLength(6);
      audio.setVolumes({ master: -4, sfx: 1.7, music: 0.6 });
      expect(runtime.gains[0].gain.targets.at(-1)).toBe(0);
      expect(runtime.gains[1].gain.targets.at(-1)).toBe(1);
      expect(runtime.gains[2].gain.targets.at(-1)).toBeCloseTo(0.6 * 0.42);
      audio.setVolumes({ master: 1, sfx: -1, music: 7 });
      expect(runtime.gains[0].gain.targets.at(-1)).toBe(1);
      expect(runtime.gains[1].gain.targets.at(-1)).toBe(0);
      expect(runtime.gains[2].gain.targets.at(-1)).toBeCloseTo(0.42);
      audio.dispose();
      expect(runtime.compressors[0].disconnected).toBe(true);
      expect(runtime.convolvers[0].buffer).toBeNull();
    } finally {
      audio.dispose();
      vi.unstubAllGlobals();
    }
  });
});


// ST-280: voice shapes, deterministic samples, peak headroom and sparse spatial cues.
describe("ST-280 natural SFX and continuous swim", () => {
  it("uses bounded, non-buzzy synth voices with crunch, whoosh, pluck and chime", () => {
    const recipes = Object.values(SFX_RECIPES);
    expect(recipes).toHaveLength(16);
    for (const voice of recipes) {
      expect(["sine", "triangle"]).toContain(voice.wave);
      expect(voice.duration).toBeGreaterThan(0.1);
      expect(voice.duration).toBeLessThanOrEqual(0.65);
      expect(voice.peak).toBeLessThanOrEqual(0.12);
      expect(voice.peak + (voice.noise?.peak ?? 0) + (voice.harmonic?.peak ?? 0))
        .toBeLessThanOrEqual(0.26);
    }
    expect(SFX_RECIPES.biteImpact.noise?.type).toBe("lowpass");
    expect(SFX_RECIPES.biteImpact.endHz).toBeLessThan(SFX_RECIPES.biteImpact.startHz);
    expect(SFX_RECIPES.boost.noise?.toHz).toBeGreaterThan(SFX_RECIPES.boost.noise!.fromHz);
    expect(SFX_RECIPES.preyConsume.endHz).toBeLessThan(SFX_RECIPES.preyConsume.startHz);
    expect(SFX_RECIPES.evolve.harmonic?.ratio).toBeGreaterThan(1);
    expect(SFX_RECIPES.die.peak).toBeLessThan(SFX_RECIPES.biteImpact.peak);
    expect(SFX_RECIPES.spawn.peak).toBeLessThan(SFX_RECIPES.biteImpact.peak);
  });

  it("reuses a short deterministic first-party noise texture without clipping", () => {
    const first = createSfxNoise(new FakeContext() as unknown as AudioContext);
    const second = createSfxNoise(new FakeContext() as unknown as AudioContext);
    expect(first.length).toBeLessThanOrEqual(first.sampleRate);
    expect(Array.from(first.getChannelData(0).slice(0, 80)))
      .toEqual(Array.from(second.getChannelData(0).slice(0, 80)));
    expect(Array.from(first.getChannelData(0).slice(0, 80)).every((x) => Math.abs(x) <= 1)).toBe(true);
  });

  it("follows authoritative swim speed continuously and rejects stale jumps", () => {
    const start = { tick: 100, position: { x: 0, y: 0, z: 0 } };
    const cruise = { tick: 102, position: { x: 1.2, y: 0, z: 0 } };
    expect(swimSpeedBetween(null, start)).toBe(0);
    expect(swimSpeedBetween(start, cruise)).toBeCloseTo(12);
    expect(swimSpeedBetween(cruise, cruise)).toBe(0);
    expect(swimSpeedBetween(cruise, start)).toBe(0);
    expect(swimSpeedBetween(start, { tick: 103, position: { x: 30, y: 0, z: 0 } })).toBe(0);
    expect(swimSpeedBetween(start, { tick: 120, position: { x: 1, y: 0, z: 0 } })).toBe(0);
    expect(swimTexture(0).gain).toBe(0);
    expect(swimTexture(18).gain).toBeGreaterThan(swimTexture(6).gain);
    expect(swimTexture(40).gain).toBeLessThanOrEqual(0.06);
    expect(swimTexture(NaN).gain).toBe(0);
  });

  it("makes shark-presence sounds occasional, distance-spaced and caption-independent", () => {
    expect(presenceCueInterval(0)).toBeGreaterThanOrEqual(2000);
    expect(presenceCueInterval(24)).toBe(5600);
    expect(presenceCueInterval(18)).toBeGreaterThan(presenceCueInterval(5));
    const hook = read("../src/game/audio/useGameAudio.ts");
    const manager = read("../src/game/audio/AudioManager.ts");
    expect(hook).toContain("audio.setSwimSpeed(");
    expect(hook).toContain("presenceCueInterval(");
    expect(hook).toContain('"Shark nearby — " + directionCaption');
    expect(hook).not.toContain('"swimRush"');
    expect(manager).toContain("source.loop = true");
    expect(manager).toContain("source.connect(filter).connect(local).connect(this.ambienceGain)");
    expect(manager).toContain("this.stopAmbienceNodes()");
    expect(manager).toContain("AUDIO_LIMITS.maxWorldVoices");
    expect(manager).toContain("source.connect(noiseFilter).connect(noiseGain).connect(output)");
    expect(manager).toContain("output.connect(panner).connect(this.sfxGain)");
    expect(manager).toContain("this.sfxNoise = null");
  });
});
