import { MusicLookaheadScheduler } from "./musicScheduler.js";
import {
  AUDIO_LIMITS,
  spatialMix,
  type AudioPoint,
  type ListenerPose,
  type SpatialMix,
} from "./spatialAudio.js";

export type Sfx =
  | "swimRush"
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
  swimRush: "Swimming",
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

interface ToneSpec {
  wave: OscillatorType;
  startHz: number;
  endHz: number;
  duration: number;
  peak: number;
  filterHz: number;
}

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

const MELODY = [110, 146.83, 164.81, 220, 164.81, 146.83];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function tone(type: Sfx): ToneSpec {
  switch (type) {
    case "swimRush": return { wave: "sine", startHz: 74, endHz: 91, duration: 0.42, peak: 0.035, filterHz: 420 };
    case "preyConsume": return { wave: "square", startHz: 620, endHz: 900, duration: 0.13, peak: 0.12, filterHz: 1500 };
    case "boost": return { wave: "sawtooth", startHz: 145, endHz: 520, duration: 0.2, peak: 0.13, filterHz: 1100 };
    case "biteImpact": return { wave: "square", startHz: 190, endHz: 86, duration: 0.15, peak: 0.2, filterHz: 900 };
    case "sharkDeath": return { wave: "sawtooth", startHz: 260, endHz: 64, duration: 0.5, peak: 0.19, filterHz: 780 };
    case "die": return { wave: "sawtooth", startHz: 410, endHz: 58, duration: 0.58, peak: 0.26, filterHz: 820 };
    case "spawn": return { wave: "triangle", startHz: 290, endHz: 620, duration: 0.22, peak: 0.16, filterHz: 1450 };
    case "evolve": return { wave: "sine", startHz: 410, endHz: 990, duration: 0.45, peak: 0.17, filterHz: 1850 };
    case "frenzyStart": return { wave: "sawtooth", startHz: 170, endHz: 680, duration: 0.36, peak: 0.18, filterHz: 1200 };
    case "frenzyEnd": return { wave: "triangle", startHz: 460, endHz: 180, duration: 0.3, peak: 0.13, filterHz: 1000 };
    case "frenzyPulse": return { wave: "triangle", startHz: 145, endHz: 230, duration: 0.28, peak: 0.08, filterHz: 720 };
    case "apexStart": return { wave: "sawtooth", startHz: 118, endHz: 430, duration: 0.42, peak: 0.21, filterHz: 940 };
    case "apexPulse": return { wave: "sawtooth", startHz: 88, endHz: 126, duration: 0.34, peak: 0.1, filterHz: 620 };
    case "roundStart": return { wave: "triangle", startHz: 250, endHz: 560, duration: 0.28, peak: 0.15, filterHz: 1400 };
    case "roundResult": return { wave: "triangle", startHz: 520, endHz: 220, duration: 0.42, peak: 0.17, filterHz: 1200 };
    case "sharkPresence": return { wave: "sine", startHz: 82, endHz: 68, duration: 0.36, peak: 0.065, filterHz: 520 };
    case "preyActivity": return { wave: "triangle", startHz: 390, endHz: 510, duration: 0.16, peak: 0.055, filterHz: 1250 };
  }
}

class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceNodes: AudioNode[] = [];
  private drone: OscillatorNode | null = null;
  private musicDroneGain: GainNode | null = null;
  private musicScheduler: MusicLookaheadScheduler | null = null;
  private musicNotes = new Set<Voice>();
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
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
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
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ambienceGain = null;
    this.activated = false;
  }

  stopSession(): void {
    this.wantsAmbience = false;
    this.wantsMusic = false;
    this.stopAmbienceNodes();
    this.stopMusicNodes();
    this.stopVoices();
    this.lastCueAt.clear();
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

  private startAmbienceNodes(): void {
    if (!this.ctx || !this.ambienceGain || this.ambienceNodes.length || this.ctx.state !== "running") return;
    const filter = this.ctx.createBiquadFilter();
    const local = this.ctx.createGain();
    const low = this.ctx.createOscillator();
    const wash = this.ctx.createOscillator();
    filter.type = "lowpass";
    filter.frequency.value = 360;
    filter.Q.value = 0.7;
    local.gain.value = 0.065;
    low.type = "sine";
    low.frequency.value = 54;
    wash.type = "triangle";
    wash.frequency.value = 91;
    wash.detune.value = -8;
    low.connect(filter);
    wash.connect(filter);
    filter.connect(local).connect(this.ambienceGain);
    low.start();
    wash.start();
    this.ambienceNodes = [low, wash, filter, local];
  }

  private stopAmbienceNodes(): void {
    for (const node of this.ambienceNodes) {
      if (node instanceof OscillatorNode) {
        try { node.stop(); } catch { /* already stopped */ }
      }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
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

  private startMusicNodes(): void {
    if (!this.ctx || !this.musicGain || this.musicScheduler || this.ctx.state !== "running") return;
    this.drone = this.ctx.createOscillator();
    this.musicDroneGain = this.ctx.createGain();
    this.drone.type = "sine";
    this.drone.frequency.value = 82;
    this.musicDroneGain.gain.value = 0.09;
    this.drone.connect(this.musicDroneGain).connect(this.musicGain);
    this.drone.start();
    const ctx = this.ctx;
    this.musicScheduler = new MusicLookaheadScheduler(
      () => ctx.currentTime,
      () => ctx.state === "running",
      (step, at) => this.scheduleMusicNote(step, at),
    );
    this.musicScheduler.start();
  }

  private stopMusicNodes(): void {
    this.musicScheduler?.stop();
    this.musicScheduler = null;
    for (const note of [...this.musicNotes]) note.stop();
    try { this.drone?.stop(); } catch { /* already stopped */ }
    try { this.drone?.disconnect(); } catch { /* already disconnected */ }
    try { this.musicDroneGain?.disconnect(); } catch { /* already disconnected */ }
    this.drone = null;
    this.musicDroneGain = null;
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
    if (!this.ctx || !this.musicGain || this.ctx.state !== "running") return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.value = MELODY[step % MELODY.length];
    filter.type = "lowpass";
    filter.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    osc.connect(filter).connect(g).connect(this.musicGain);
    let ended = false;
    const note: Voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        try { osc.stop(); } catch { /* note already ended */ }
        osc.disconnect();
        filter.disconnect();
        g.disconnect();
        this.musicNotes.delete(note);
      },
    };
    this.musicNotes.add(note);
    osc.onended = () => note.stop();
    osc.start(at);
    osc.stop(at + 0.3);
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
    if (!this.ctx || !this.sfxGain || this.ctx.state !== "running" || this.vols.master <= 0 || this.vols.sfx <= 0) return false;
    if (this.voices.size >= AUDIO_LIMITS.maxWorldVoices) return false;

    const nowMs = this.ctx.currentTime * 1000;
    const key = options.key ?? type;
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    const previous = this.lastCueAt.get(key) ?? -Infinity;
    if (nowMs - previous < minIntervalMs) return false;
    this.lastCueAt.set(key, nowMs);

    const spec = tone(type);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const nodes: AudioNode[] = [osc, filter, gain];
    osc.type = spec.wave;
    const pitch = Number.isFinite(options.pitch) ? Math.max(0.8, Math.min(1.6, options.pitch!)) : 1;
    osc.frequency.setValueAtTime(spec.startHz * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.endHz * pitch), t + spec.duration);
    filter.type = "lowpass";
    filter.frequency.value = spec.filterHz * (spatial && spatial.mix.front < -0.2 ? 0.72 : 1);
    filter.Q.value = 0.75;
    const peak = Math.max(0.0002, spec.peak * (spatial?.mix.gain ?? 1));
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.duration);
    osc.connect(filter).connect(gain);

    if (spatial && typeof this.ctx.createPanner === "function") {
      const panner = this.ctx.createPanner() as LegacyPanner;
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
      gain.connect(panner).connect(this.sfxGain);
      nodes.push(panner);
    } else if (spatial && typeof this.ctx.createStereoPanner === "function") {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = spatial.mix.pan;
      gain.connect(panner).connect(this.sfxGain);
      nodes.push(panner);
    } else {
      gain.connect(this.sfxGain);
    }

    let ended = false;
    let voice: Voice;
    voice = {
      stop: () => {
        if (ended) return;
        ended = true;
        try { osc.stop(); } catch { /* already stopped */ }
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
