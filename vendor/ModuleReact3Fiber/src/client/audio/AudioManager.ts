// Procedural audio — no asset files. A tiny Web Audio synth provides SFX (eat, boost,
// die, spawn) and a looping Tron-ish background music arpeggio. Volumes map to the
// systems-menu sliders; everything is gated behind a user gesture (the game is entered
// via a click, so resume() succeeds). Each SFX also names a caption for the captions UI.

export type Sfx = "eat" | "boost" | "die" | "spawn" | "frenzyStart" | "frenzyEnd";

export const SFX_CAPTION: Record<Sfx, string> = {
  eat: "♪ pickup",
  boost: "» boost",
  die: "✖ crash",
  spawn: "✧ spawn",
  frenzyStart: "Feeding Frenzy started",
  frenzyEnd: "Feeding Frenzy ended",
};

// A minor pentatonic-ish arpeggio (Hz) for the loop.
const MELODY = [220.0, 293.66, 329.63, 440.0, 329.63, 293.66];
const STEP_MS = 260;

class AudioManagerImpl {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private seqTimer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private vols = { master: 0.8, sfx: 0.9, music: 0.5 };
  private lifecycleBound = false;

  /** Create/resume the context. Safe to call repeatedly; must follow a user gesture. */
  ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.bindLifecycle();
  }

  /** Silence + release audio when the page is hidden or torn down, so no sound keeps
   *  playing after the tab/window is closed or backgrounded. Bound once. */
  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof document === "undefined") return;
    this.lifecycleBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.stopMusic(); // fully stop the loop, not just suspend
        void this.ctx?.suspend();
      } else {
        void this.ctx?.resume();
      }
    });
    // pagehide + beforeunload fire on tab/window close and navigations; dispose fully so
    // nothing keeps playing after the browser is closed.
    window.addEventListener("pagehide", () => this.dispose());
    window.addEventListener("beforeunload", () => this.dispose());
  }

  /** Stop everything and release the audio graph. */
  dispose(): void {
    this.stopMusic();
    try {
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.master = this.sfxGain = this.musicGain = null;
  }

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.vols = v;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.vols.sfx, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.vols.music * 0.5, t, 0.05);
  }

  startMusic(): void {
    if (!this.ctx || !this.musicGain || this.seqTimer) return;
    // Low drone under the arpeggio.
    this.drone = this.ctx.createOscillator();
    this.drone.type = "sine";
    this.drone.frequency.value = 110;
    const dg = this.ctx.createGain();
    dg.gain.value = 0.12;
    this.drone.connect(dg).connect(this.musicGain);
    this.drone.start();

    this.step = 0;
    this.seqTimer = setInterval(() => this.tickSeq(), STEP_MS);
  }

  stopMusic(): void {
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = null;
    try {
      this.drone?.stop();
    } catch {
      /* already stopped */
    }
    this.drone = null;
  }

  private tickSeq(): void {
    if (!this.ctx || !this.musicGain) return;
    const freq = MELODY[this.step % MELODY.length];
    this.step += 1;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(filt).connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  playSfx(type: Sfx): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.connect(g).connect(this.sfxGain);

    switch (type) {
      case "eat":
        osc.type = "square";
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.exponentialRampToValueAtTime(990, t + 0.08);
        env(g, t, 0.18, 0.1);
        osc.start(t);
        osc.stop(t + 0.12);
        break;
      case "boost":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.16);
        env(g, t, 0.14, 0.18);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      case "die":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.5);
        env(g, t, 0.28, 0.55);
        osc.start(t);
        osc.stop(t + 0.6);
        break;
      case "spawn":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(330, t);
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.14);
        env(g, t, 0.2, 0.18);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      case "frenzyStart":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.3);
        env(g, t, 0.2, 0.34);
        osc.start(t);
        osc.stop(t + 0.36);
        break;
      case "frenzyEnd":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.24);
        env(g, t, 0.16, 0.28);
        osc.start(t);
        osc.stop(t + 0.3);
        break;
    }
  }
}

function env(g: GainNode, t: number, peak: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** Module-global singleton — one audio graph for the whole session. */
export const audio = new AudioManagerImpl();
