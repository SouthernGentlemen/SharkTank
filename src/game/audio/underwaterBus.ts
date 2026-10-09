/**
 * Shared underwater output bus for all browser-generated music, SFX and ambience.
 * One bounded, deterministic stereo impulse is created per AudioContext (never per voice).
 */
export const UNDERWATER_BUS = {
  lowpassHz: 2400,
  reverbSeconds: 0.55,
  dry: 0.88,
  wet: 0.12,
  limiterThresholdDb: -9,
  limiterRatio: 12,
} as const;

export interface UnderwaterBus {
  disconnect(): void;
}

export function createUnderwaterBus(
  ctx: AudioContext,
  music: GainNode,
  sfx: GainNode,
  master: GainNode,
): UnderwaterBus {
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = UNDERWATER_BUS.lowpassHz;
  lowpass.Q.value = 0.65;

  const impulse = ctx.createBuffer(
    2,
    Math.max(1, Math.floor(ctx.sampleRate * UNDERWATER_BUS.reverbSeconds)),
    ctx.sampleRate,
  );
  // Seeded noise with a smooth exponential tail. No assets, network, or Math.random.
  let seed = 0x5eab1e;
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0x80000000 - 1;
      data[i] = noise * Math.exp(-8 * i / ctx.sampleRate);
    }
  }

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  const dry = ctx.createGain();
  dry.gain.value = UNDERWATER_BUS.dry;
  const wet = ctx.createGain();
  wet.gain.value = UNDERWATER_BUS.wet;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = UNDERWATER_BUS.limiterThresholdDb;
  limiter.knee.value = 6;
  limiter.ratio.value = UNDERWATER_BUS.limiterRatio;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  music.connect(lowpass);
  sfx.connect(lowpass);
  lowpass.connect(dry).connect(master);
  lowpass.connect(convolver).connect(wet).connect(master);
  master.connect(limiter).connect(ctx.destination);

  let disconnected = false;
  return {
    disconnect: () => {
      if (disconnected) return;
      disconnected = true;
      for (const node of [music, sfx, lowpass, dry, convolver, wet, master, limiter]) node.disconnect();
      convolver.buffer = null;
    },
  };
}
