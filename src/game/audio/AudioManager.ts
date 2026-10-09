import { MusicLookaheadScheduler } from "./musicScheduler.js";
import { createUnderwaterBus, type UnderwaterBus } from "./underwaterBus.js";
import { createSfxNoise, SFX_RECIPES, swimTexture } from "./sfxVoices.js";
import { MUSIC_CROSSFADE_SECONDS, MUSIC_MIX, mixAt, type MusicMix, type MusicMode } from "./musicIntensity.js";
import { midiToHz, scoreEventAtStep, type PercussionHit } from "./underwaterScore.js";
import {
  AUDIO_LIMITS,
  spatialMix,
  type AudioPoint,
  type ListenerPose,
  type SpatialMix,
} from "./spatialAudio.js";

export type Sfx =
  | "preyConsume"
  | "boost"
  | "biteImpact"
  | "sharkDeath"
  | "die"
  | "spawn"
  | "evolve"
  | "frenzyStart"
  | "frenzyEnd"
  | "frenzyPulse"
  | "apexStart"
  | "apexPulse"
  | "roundStart"
  | "roundResult"
  | "sharkPresence"
  | "preyActivity";

export const SFX_CAPTION: Record<Sfx, string> = {
  preyConsume: "Prey consumed",
  boost: "Burst",
  biteImpact: "Bite impact",
  sharkDeath: "Shark eliminated",
  die: "You were eliminated",
  spawn: "Respawned",
  evolve: "Shark evolved",
  frenzyStart: "Feeding Frenzy started",
  frenzyEnd: "Feeding Frenzy ended",
  frenzyPulse: "Feeding Frenzy nearby",
  apexStart: "Apex phase started",
  apexPulse: "Apex threat nearby",
  roundStart: "New round started",
  roundResult: "Round complete",
  sharkPresence: "Shark nearby",
  preyActivity: "Prey school nearby",
};

interface Voice {
  stop: () => void;
}

interface PlayOptions {
  key?: string;
  minIntervalMs?: number;
  /** Optional bounded cosmetic pitch multiplier, e.g. local eat streaks. */
  pitch?: number;
}

interface WorldPlayOptions extends PlayOptions {
  range?: number;
}

type LegacyAudioListener = AudioListener & {
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
};

type LegacyPanner = PannerNode & {
  setPosition?: (x: number, y: number, z: number) => void;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private outputBus: UnderwaterBus | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceNodes: AudioNode[] = [];
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceLevel: GainNode | null = null;
  private sfxNoise: AudioBuffer | null = null;
  private swimSpeed = 0;
  private musicPadGain: GainNode | null = null;
  private musicBassGain: GainNode | null = null;
  private musicPercussionGain: GainNode | null = null;
  private musicLeadGain: GainNode | null = null;
  private musicNoise: AudioBuffer | null = null;
  private musicScheduler: MusicLookaheadScheduler | null = null;
  private musicNotes = new Set<Voice>();
  private musicMode: MusicMode = "calm";
  private musicMix: MusicMix = MUSIC_MIX.calm;
  private musicFade: { from: MusicMix; to: MusicMix; at: number } | null = null;
  private vols = { master: 0.8, sfx: 0.9, music: 0 };
  private voices = new Set<Voice>();
  private lastCueAt = new Map<string, number>();
  private listenerPose: ListenerPose = { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
  private lastListenerAt = -Infinity;
  private lifecycleBound = false;
  private activationBound = false;
  private activated = false;
  private wantsAmbience = false;
  private wantsMusic = false;

  private readonly onVisibilityChange = () => {
    if (!this.ctx) return;
    if (document.hidden) {
      this.stopVoices();
      void this.ctx.suspend();
    } else if (this.activated) {
      void this.ctx.resume().then(() => this.syncDesiredLoops()).catch(() => undefined);
    }
  };

  private readonly onPageHide = () => this.dispose();

  private readonly onActivate = () => {
    if (!this.ctx) return;
    void this.ctx.resume().then(() => {
      this.activated = true;
      this.unbindActivation();
      this.syncDesiredLoops();
    }).catch(() => undefined);
  };

  ensure(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const webkit = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext || webkit.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.connect(this.sfxGain);
      this.outputBus = createUnderwaterBus(this.ctx, this.musicGain, this.sfxGain, this.master);
      this.applyVolumes();
    }
    this.bindLifecycle();
    if (this.ctx.state === "running") {
      this.activated = true;
      this.unbindActivation();
      this.syncDesiredLoops();
      return;
    }
    this.bindActivation();
    void this.ctx.resume().then(() => {
      this.activated = true;
      this.unbindActivation();
      this.syncDesiredLoops();
    }).catch(() => undefined);
  }

  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof document === "undefined") return;
    this.lifecycleBound = true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("beforeunload", this.onPageHide);
  }

  private unbindLifecycle(): void {
    if (!this.lifecycleBound || typeof document === "undefined") return;
    this.lifecycleBound = false;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("beforeunload", this.onPageHide);
  }

  private bindActivation(): void {
    if (this.activationBound || typeof window === "undefined") return;
    this.activationBound = true;
    window.addEventListener("pointerdown", this.onActivate, { passive: true });
    window.addEventListener("keydown", this.onActivate);
  }

  private unbindActivation(): void {
    if (!this.activationBound || typeof window === "undefined") return;
    this.activationBound = false;
    window.removeEventListener("pointerdown", this.onActivate);
    window.removeEventListener("keydown", this.onActivate);
  }

  dispose(): void {
    this.stopSession();
    this.unbindActivation();
    this.unbindLifecycle();
    this.outputBus?.disconnect();
    this.outputBus = null;
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ambienceGain = null;
    this.sfxNoise = null;
    this.activated = false;
  }

  stopSession(): void {
    this.wantsAmbience = false;
    this.wantsMusic = false;
    this.stopAmbienceNodes();
    this.stopMusicNodes();
    this.stopVoices();
    this.swimSpeed = 0;
    this.lastCueAt.clear();
    this.musicMode = "calm";
  }

  private stopVoices(): void {
    for (const voice of [...this.voices]) voice.stop();
  }

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.vols = { master: clamp01(v.master), sfx: clamp01(v.sfx), music: clamp01(v.music) };
    this.applyVolumes();
    this.syncDesiredLoops();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.vols.sfx, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.vols.music * 0.42, t, 0.05);
  }

  getListenerPose(): ListenerPose {
    return {
      position: { ...this.listenerPose.position },
      yaw: this.listenerPose.yaw,
      pitch: this.listenerPose.pitch,
    };
  }

  setListener(position: AudioPoint, yaw: number, pitch: number): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
    this.listenerPose.position.x = position.x;
    this.listenerPose.position.y = position.y;
    this.listenerPose.position.z = position.z;
    this.listenerPose.yaw = Number.isFinite(yaw) ? yaw : 0;
    this.listenerPose.pitch = Number.isFinite(pitch) ? pitch : 0;
    if (!this.ctx || this.ctx.state !== "running") return;
    const nowMs = this.ctx.currentTime * 1000;
    if (nowMs - this.lastListenerAt < AUDIO_LIMITS.listenerUpdateMs) return;
    this.lastListenerAt = nowMs;

    const listener = this.ctx.listener as LegacyAudioListener;
    const t = this.ctx.currentTime;
    const cosPitch = Math.cos(this.listenerPose.pitch);
    const fx = Math.cos(this.listenerPose.yaw) * cosPitch;
    const fy = Math.sin(this.listenerPose.pitch);
    const fz = Math.sin(this.listenerPose.yaw) * cosPitch;
    const ux = -Math.cos(this.listenerPose.yaw) * Math.sin(this.listenerPose.pitch);
    const uy = Math.cos(this.listenerPose.pitch);
    const uz = -Math.sin(this.listenerPose.yaw) * Math.sin(this.listenerPose.pitch);

    if ("positionX" in listener && listener.positionX && "forwardX" in listener && listener.forwardX) {
      listener.positionX.setTargetAtTime(position.x, t, 0.015);
      listener.positionY.setTargetAtTime(position.y, t, 0.015);
      listener.positionZ.setTargetAtTime(position.z, t, 0.015);
      listener.forwardX.setTargetAtTime(fx, t, 0.015);
      listener.forwardY.setTargetAtTime(fy, t, 0.015);
      listener.forwardZ.setTargetAtTime(fz, t, 0.015);
      listener.upX.setTargetAtTime(ux, t, 0.015);
      listener.upY.setTargetAtTime(uy, t, 0.015);
      listener.upZ.setTargetAtTime(uz, t, 0.015);
    } else {
      listener.setPosition?.(position.x, position.y, position.z);
      listener.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  startAmbience(): void {
    this.wantsAmbience = true;
    this.syncDesiredLoops();
  }

  stopAmbience(): void {
    this.wantsAmbience = false;
    this.stopAmbienceNodes();
  }

  /** Continuously blend the swimmer's water noise from server-derived motion. */
  setSwimSpeed(speed: number): void {
    this.swimSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(30, speed)) : 0;
    const texture = swimTexture(this.swimSpeed);
    const at = this.ctx?.currentTime ?? 0;
    this.ambienceLevel?.gain.setTargetAtTime(texture.gain, at, 0.12);
    this.ambienceFilter?.frequency.setTargetAtTime(texture.filterHz, at, 0.12);
  }

  private startAmbienceNodes(): void {
    if (!this.ctx || !this.ambienceGain || this.ambienceNodes.length || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.sfxNoise ?? (this.sfxNoise = createSfxNoise(ctx));
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    const local = ctx.createGain();
    filter.type = "bandpass";
    filter.Q.value = 0.38;
    local.gain.value = 0;
    source.connect(filter).connect(local).connect(this.ambienceGain);
    this.ambienceSource = source;
    this.ambienceFilter = filter;
    this.ambienceLevel = local;
    source.start();
    this.ambienceNodes = [source, filter, local];
    this.setSwimSpeed(this.swimSpeed);
  }

  private stopAmbienceNodes(): void {
    if (this.ambienceSource) {
      try { this.ambienceSource.stop(); } catch { /* already stopped */ }
    }
    for (const node of this.ambienceNodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.ambienceSource = null;
    this.ambienceFilter = null;
    this.ambienceLevel = null;
    this.ambienceNodes = [];
  }

  startMusic(): void {
    this.wantsMusic = true;
    this.syncDesiredLoops();
  }

  stopMusic(): void {
    this.wantsMusic = false;
    this.stopMusicNodes();
  }

  setMusicMode(mode: MusicMode): void {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    this.fadeMusicMix();
  }

  private fadeMusicMix(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicPadGain || !this.musicBassGain || !this.musicPercussionGain || !this.musicLeadGain) return;
    const at = ctx.currentTime;
    const from = this.musicFade
      ? mixAt(this.musicFade.from, this.musicFade.to, at - this.musicFade.at)
      : this.musicMix;
    const to = MUSIC_MIX[this.musicMode];
    const gains = [this.musicPadGain, this.musicBassGain, this.musicPercussionGain, this.musicLeadGain];
    const keys = ["pad", "bass", "percussion", "lead"] as const;
    for (let i = 0; i < gains.length; i++) {
      const gain = gains[i].gain;
      const key = keys[i];
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(from[key], at);
      gain.linearRampToValueAtTime(to[key], at + MUSIC_CROSSFADE_SECONDS);
    }
    this.musicMix = to;
    this.musicFade = { from, to, at };
  }

  private startMusicNodes(): void {
    if (!this.ctx || !this.musicGain || this.musicScheduler || this.ctx.state !== "running") return;
    this.musicPadGain = this.ctx.createGain();
    this.musicBassGain = this.ctx.createGain();
    this.musicPadGain.gain.value = 0.58;
    this.musicBassGain.gain.value = 0.42;
    this.musicPadGain.connect(this.musicGain);
    this.musicBassGain.connect(this.musicGain);
    const ctx = this.ctx;
    this.musicPercussionGain = ctx.createGain();
    this.musicLeadGain = ctx.createGain();
    // ST-278 will fade these opt-in buses in response to game intensity.
    this.musicPercussionGain.gain.value = 0;
    this.musicLeadGain.gain.value = 0;
    this.musicPercussionGain.connect(this.musicGain);
    this.musicLeadGain.connect(this.musicGain);
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate);
    const noise = buffer.getChannelData(0);
    let seed = 0x51eaf00d;
    for (let i = 0; i < noise.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i] = seed / 0x80000000 - 1;
    }
    this.musicNoise = buffer;
    this.musicScheduler = new MusicLookaheadScheduler(
      () => ctx.currentTime,
      () => ctx.state === "running",
      (step, at) => this.scheduleMusicNote(step, at),
    );
    this.musicScheduler.start();
    if (this.musicMode !== "calm") this.fadeMusicMix();
  }

  private stopMusicNodes(): void {
    this.musicScheduler?.stop();
    this.musicScheduler = null;
    for (const note of [...this.musicNotes]) note.stop();
    this.musicPadGain?.disconnect();
    this.musicBassGain?.disconnect();
    this.musicPercussionGain?.disconnect();
    this.musicLeadGain?.disconnect();
    this.musicPadGain = null;
    this.musicBassGain = null;
    this.musicPercussionGain = null;
    this.musicLeadGain = null;
    this.musicNoise = null;
    this.musicFade = null;
    this.musicMix = MUSIC_MIX.calm;
  }

  private syncDesiredLoops(): void {
    if (!this.ctx || this.ctx.state !== "running" || this.vols.master <= 0) {
      this.stopAmbienceNodes();
      this.stopMusicNodes();
      return;
    }
    if (this.wantsAmbience && this.vols.sfx > 0) this.startAmbienceNodes();
    else this.stopAmbienceNodes();
    if (this.wantsMusic && this.vols.music > 0) this.startMusicNodes();
    else this.stopMusicNodes();
  }

  private scheduleMusicNote(step: number, at: number): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const event = scoreEventAtStep(step);
    if (!event) return;
    if (event.padMidi) this.scheduleMusicPad(event.padMidi, at);
    if (event.bassMidi !== null) this.scheduleMusicBass(event.bassMidi, at);
    if (event.percussionHit) this.scheduleMusicPercussion(event.percussionHit, at);
    // Frenzy inserts extra on-grid offbeats; the scheduler's 100 ms window is unchanged.
    if (this.musicMode === "frenzy" && step % 2 === 1) this.scheduleMusicPercussion("shaker", at);
    // Apex adds harmonic tension without changing the deterministic base score.
    if (event.leadMidi !== null) this.scheduleMusicLead(event.leadMidi + (this.musicMode === "apex" ? 1 : 0), at);
  }

  private scheduleMusicPad(midi: readonly number[], at: number): void {
    const ctx = this.ctx;
    const output = this.musicPadGain;
    if (!ctx || !output) return;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 780;
    filter.Q.value = 0.65;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.065, at + 0.52);
    g.gain.setValueAtTime(0.065, at + 1.94);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.55);
    filter.connect(g).connect(output);
    const oscillators: OscillatorNode[] = [];
    for (const noteMidi of midi) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = midiToHz(noteMidi);
        osc.detune.value = detune;
        osc.connect(filter);
        oscillators.push(osc);
      }
    }
    let ended = false;
    const note: Voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        for (const osc of oscillators) {
          try { osc.stop(); } catch { /* note already ended */ }
          osc.disconnect();
        }
        filter.disconnect();
        g.disconnect();
        this.musicNotes.delete(note);
      },
    };
    this.musicNotes.add(note);
    oscillators[oscillators.length - 1].onended = () => note.stop();
    for (const osc of oscillators) {
      osc.start(at);
      osc.stop(at + 2.57);
    }
  }

  private scheduleMusicBass(midi: number, at: number): void {
    const ctx = this.ctx;
    const output = this.musicBassGain;
    if (!ctx || !output) return;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const osc = ctx.createOscillator();
    const upper = ctx.createOscillator();
    const overtone = ctx.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 250;
    filter.Q.value = 0.55;
    osc.type = "sine";
    osc.frequency.value = midiToHz(midi);
    upper.type = "triangle";
    upper.frequency.value = midiToHz(midi + 12);
    overtone.gain.value = 0.18;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.18, at + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.82);
    osc.connect(filter);
    upper.connect(overtone).connect(filter);
    filter.connect(g).connect(output);
    let ended = false;
    const note: Voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        for (const voice of [osc, upper]) {
          try { voice.stop(); } catch { /* note already ended */ }
          voice.disconnect();
        }
        overtone.disconnect();
        filter.disconnect();
        g.disconnect();
        this.musicNotes.delete(note);
      },
    };
    this.musicNotes.add(note);
    upper.onended = () => note.stop();
    osc.start(at);
    upper.start(at);
    osc.stop(at + 0.84);
    upper.stop(at + 0.84);
  }

  private scheduleMusicPercussion(hit: PercussionHit, at: number): void {
    const ctx = this.ctx;
    const output = this.musicPercussionGain;
    const buffer = this.musicNoise;
    if (!ctx || !output || !buffer) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const kick = hit === "kick";
    const duration = kick ? 0.18 : 0.105;
    source.buffer = buffer;
    filter.type = kick ? "lowpass" : "highpass";
    filter.frequency.setValueAtTime(kick ? 180 : 1900, at);
    if (kick) filter.frequency.exponentialRampToValueAtTime(75, at + duration);
    filter.Q.value = 0.65;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(kick ? 0.09 : 0.035, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(output);
    let ended = false;
    const note: Voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        try { source.stop(); } catch { /* already ended */ }
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
        this.musicNotes.delete(note);
      },
    };
    this.musicNotes.add(note);
    source.onended = () => note.stop();
    source.start(at);
    source.stop(at + duration + 0.01);
  }

  private scheduleMusicLead(midi: number, at: number): void {
    const ctx = this.ctx;
    const output = this.musicLeadGain;
    if (!ctx || !output) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiToHz(midi);
    filter.type = "lowpass";
    filter.frequency.value = 1150;
    filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.075, at + 0.035);
    gain.gain.setValueAtTime(0.065, at + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.54);
    osc.connect(filter).connect(gain).connect(output);
    let ended = false;
    const note: Voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        try { osc.stop(); } catch { /* already ended */ }
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
        this.musicNotes.delete(note);
      },
    };
    this.musicNotes.add(note);
    osc.onended = () => note.stop();
    osc.start(at);
    osc.stop(at + 0.56);
  }

  playSfx(type: Sfx, options: PlayOptions = {}): boolean {
    return this.playTone(type, null, options);
  }

  playWorldSfx(type: Sfx, position: AudioPoint, options: WorldPlayOptions = {}): boolean {
    const range = options.range ?? AUDIO_LIMITS.audibleRange;
    const mix = spatialMix(this.listenerPose, position, range);
    if (mix.gain <= 0) return false;
    return this.playTone(type, { position, mix, range }, options);
  }

  private playTone(
    type: Sfx,
    spatial: { position: AudioPoint; mix: SpatialMix; range: number } | null,
    options: PlayOptions,
  ): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== "running" || this.vols.master <= 0 || this.vols.sfx <= 0) return false;
    if (this.voices.size >= AUDIO_LIMITS.maxWorldVoices) return false;

    const nowMs = ctx.currentTime * 1000;
    const key = options.key ?? type;
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    const previous = this.lastCueAt.get(key) ?? -Infinity;
    if (nowMs - previous < minIntervalMs) return false;
    this.lastCueAt.set(key, nowMs);

    const spec = SFX_RECIPES[type];
    const t = ctx.currentTime;
    const pitch = Number.isFinite(options.pitch) ? Math.max(0.8, Math.min(1.6, options.pitch!)) : 1;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const output = ctx.createGain();
    const nodes: AudioNode[] = [osc, filter, gain, output];
    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [osc];

    // Sine/triangle body: low thump, descending soft pluck, or gentle phase sting.
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(spec.startHz * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(spec.endHz * pitch, t + spec.duration);
    filter.type = "lowpass";
    filter.frequency.value = spec.filterHz * (spatial && spatial.mix.front < -0.2 ? 0.72 : 1);
    filter.Q.value = 0.65;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(spec.peak, t + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.duration);
    osc.connect(filter).connect(gain).connect(output);

    if (spec.noise) {
      // Crunch and whoosh use one shared, deterministic noise source with a short sweep.
      const source = ctx.createBufferSource();
      source.buffer = this.sfxNoise ?? (this.sfxNoise = createSfxNoise(ctx));
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      noiseFilter.type = spec.noise.type;
      noiseFilter.Q.value = 0.52;
      noiseFilter.frequency.setValueAtTime(spec.noise.fromHz, t);
      noiseFilter.frequency.exponentialRampToValueAtTime(spec.noise.toHz, t + spec.duration);
      noiseGain.gain.setValueAtTime(0.0001, t);
      noiseGain.gain.exponentialRampToValueAtTime(spec.noise.peak, t + 0.018);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + spec.duration);
      source.connect(noiseFilter).connect(noiseGain).connect(output);
      nodes.push(source, noiseFilter, noiseGain);
      sources.push(source);
      source.start(t);
      source.stop(t + spec.duration + 0.01);
    }
    if (spec.harmonic) {
      // Two sine partials form a soft tier-up chime instead of a high-pitched beep.
      const upper = ctx.createOscillator();
      const upperGain = ctx.createGain();
      upper.type = "sine";
      upper.frequency.setValueAtTime(spec.startHz * spec.harmonic.ratio * pitch, t);
      upper.frequency.exponentialRampToValueAtTime(spec.endHz * spec.harmonic.ratio * pitch, t + spec.duration);
      upperGain.gain.setValueAtTime(0.0001, t);
      upperGain.gain.exponentialRampToValueAtTime(spec.harmonic.peak, t + 0.035);
      upperGain.gain.exponentialRampToValueAtTime(0.0001, t + spec.duration);
      upper.connect(upperGain).connect(output);
      nodes.push(upper, upperGain);
      sources.push(upper);
      upper.start(t);
      upper.stop(t + spec.duration + 0.03);
    }

    output.gain.value = spatial?.mix.gain ?? 1;
    if (spatial && typeof ctx.createPanner === "function") {
      const panner = ctx.createPanner() as LegacyPanner;
      panner.panningModel = "HRTF";
      panner.distanceModel = "linear";
      panner.refDistance = 1;
      panner.maxDistance = spatial.range;
      panner.rolloffFactor = 0;
      if ("positionX" in panner && panner.positionX) {
        panner.positionX.value = spatial.position.x;
        panner.positionY.value = spatial.position.y;
        panner.positionZ.value = spatial.position.z;
      } else {
        panner.setPosition?.(spatial.position.x, spatial.position.y, spatial.position.z);
      }
      output.connect(panner).connect(this.sfxGain);
      nodes.push(panner);
    } else if (spatial && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = spatial.mix.pan;
      output.connect(panner).connect(this.sfxGain);
      nodes.push(panner);
    } else {
      output.connect(this.sfxGain);
    }

    let ended = false;
    let voice: Voice;
    voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        for (const source of sources) {
          try { source.stop(); } catch { /* already stopped */ }
        }
        for (const node of nodes) {
          try { node.disconnect(); } catch { /* already disconnected */ }
        }
        this.voices.delete(voice);
      },
    };
    this.voices.add(voice);
    osc.onended = () => voice.stop();
    osc.start(t);
    osc.stop(t + spec.duration + 0.03);
    return true;
  }

}

export const audio = new AudioManagerImpl();
