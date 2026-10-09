import type { Sfx } from "./AudioManager.js";

/** First-party, peak-limited SFX recipes; no recorded assets or oscillator buzz waves. */
export interface NoiseRecipe {
  type: "lowpass" | "bandpass" | "highpass";
  fromHz: number;
  toHz: number;
  peak: number;
}

export interface SfxRecipe {
  wave: "sine" | "triangle";
  startHz: number;
  endHz: number;
  duration: number;
  peak: number;
  filterHz: number;
  noise?: NoiseRecipe;
  harmonic?: { ratio: number; peak: number };
}

export const SFX_RECIPES: Readonly<Record<Sfx, SfxRecipe>> = {
  preyConsume: { wave: "sine", startHz: 640, endHz: 275, duration: 0.23, peak: 0.085, filterHz: 1450 },
  boost: { wave: "sine", startHz: 110, endHz: 155, duration: 0.28, peak: 0.018, filterHz: 650,
    noise: { type: "bandpass", fromHz: 220, toHz: 970, peak: 0.13 } },
  biteImpact: { wave: "sine", startHz: 140, endHz: 64, duration: 0.23, peak: 0.115, filterHz: 600,
    noise: { type: "lowpass", fromHz: 1400, toHz: 230, peak: 0.13 } },
  sharkDeath: { wave: "sine", startHz: 220, endHz: 105, duration: 0.47, peak: 0.075, filterHz: 720,
    noise: { type: "lowpass", fromHz: 740, toHz: 230, peak: 0.045 } },
  die: { wave: "sine", startHz: 265, endHz: 115, duration: 0.5, peak: 0.09, filterHz: 720,
    noise: { type: "lowpass", fromHz: 680, toHz: 210, peak: 0.045 } },
  spawn: { wave: "triangle", startHz: 315, endHz: 480, duration: 0.32, peak: 0.07, filterHz: 1100 },
  evolve: { wave: "sine", startHz: 520, endHz: 785, duration: 0.62, peak: 0.075, filterHz: 1800,
    harmonic: { ratio: 1.5, peak: 0.052 } },
  frenzyStart: { wave: "triangle", startHz: 230, endHz: 430, duration: 0.34, peak: 0.085, filterHz: 1050 },
  frenzyEnd: { wave: "triangle", startHz: 420, endHz: 240, duration: 0.32, peak: 0.075, filterHz: 900 },
  frenzyPulse: { wave: "sine", startHz: 134, endHz: 164, duration: 0.25, peak: 0.052, filterHz: 640 },
  apexStart: { wave: "triangle", startHz: 145, endHz: 340, duration: 0.4, peak: 0.09, filterHz: 920 },
  apexPulse: { wave: "sine", startHz: 98, endHz: 126, duration: 0.27, peak: 0.048, filterHz: 480 },
  roundStart: { wave: "triangle", startHz: 310, endHz: 465, duration: 0.27, peak: 0.075, filterHz: 1150 },
  roundResult: { wave: "triangle", startHz: 465, endHz: 240, duration: 0.42, peak: 0.085, filterHz: 1000 },
  sharkPresence: { wave: "sine", startHz: 190, endHz: 135, duration: 0.23, peak: 0.046, filterHz: 630 },
  preyActivity: { wave: "sine", startHz: 440, endHz: 340, duration: 0.17, peak: 0.042, filterHz: 1100 },
};

/** A single small deterministic noise buffer is shared by every SFX and the swim loop. */
export function createSfxNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.65), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x53ea280;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  return buffer;
}

/** Swim is a continuously running noise texture, not a periodic ping. */
export function swimTexture(speed: number): { gain: number; filterHz: number } {
  const level = Math.min(1, Math.max(0, Number.isFinite(speed) ? speed / 18 : 0));
  return { gain: level * 0.06, filterHz: 260 + level * 700 };
}
