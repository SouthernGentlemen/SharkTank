import { resolveQuality } from "./quality.js";
import { resolveSceneQuality, type SceneQuality } from "./sceneMath.js";

export interface ClientPerformanceProfile {
  preyUpdateHz: number;
  environmentUpdateHz: number;
  effectUpdateHz: number;
  labelUpdateHz: number;
  preyUpdateMs: number;
  environmentUpdateMs: number;
  effectUpdateMs: number;
  labelUpdateMs: number;
  desktopDprCap: number;
  touchDprCap: number;
}

const QUALITY_HZ = {
  low: { prey: 30, environment: 15, effects: 30, labels: 5, touchDpr: 1 },
  medium: { prey: 45, environment: 30, effects: 45, labels: 8, touchDpr: 1.25 },
  high: { prey: 60, environment: 45, effects: 60, labels: 10, touchDpr: 1.5 },
} as const;

function intervalMs(hz: number): number {
  return 1000 / Math.max(1, hz);
}

export function resolveClientPerformanceProfile(quality: SceneQuality): ClientPerformanceProfile {
  const hz = QUALITY_HZ[resolveQuality(quality)];
  const desktopDprCap = resolveSceneQuality(quality).dpr[1];
  return {
    preyUpdateHz: hz.prey,
    environmentUpdateHz: hz.environment,
    effectUpdateHz: hz.effects,
    labelUpdateHz: hz.labels,
    preyUpdateMs: intervalMs(hz.prey),
    environmentUpdateMs: intervalMs(hz.environment),
    effectUpdateMs: intervalMs(hz.effects),
    labelUpdateMs: intervalMs(hz.labels),
    desktopDprCap,
    touchDprCap: Math.min(desktopDprCap, hz.touchDpr),
  };
}

export function resolveRenderDpr(
  quality: SceneQuality,
  touchControls: boolean,
  devicePixelRatio: number,
): number {
  const profile = resolveClientPerformanceProfile(quality);
  const cap = touchControls ? profile.touchDprCap : profile.desktopDprCap;
  const requested = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(1, Math.min(cap, requested));
}

export function cadenceDue(lastUpdateMs: number, nowMs: number, interval: number): boolean {
  if (!Number.isFinite(lastUpdateMs)) return true;
  if (!Number.isFinite(nowMs) || !Number.isFinite(interval) || interval <= 0) return false;
  return nowMs - lastUpdateMs + 0.0001 >= interval;
}

/** Resolution alone adapts; quality, actors and semantic cues stay intact. */
export class FrameTimeMonitor {
  private samples: number[] = [];
  private elapsed = 0;
  private headroom = 0;
  private cooldown = 0;

  constructor(public dpr: number, readonly cap: number, readonly targetMs = 1000 / 60) {}

  sample(frameMs: number): number {
    // Ignore suspension gaps and invalid deltas rather than treating them as GPU load.
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
      this.samples = [];
      this.elapsed = this.headroom = this.cooldown = 0;
      return this.dpr;
    }
    this.samples.push(frameMs);
    this.elapsed += frameMs;
    while (this.elapsed - this.samples[0]! >= 2000) this.elapsed -= this.samples.shift()!;
    this.cooldown = Math.max(0, this.cooldown - frameMs);
    const average = this.elapsed / this.samples.length;
    this.headroom = average < this.targetMs * 0.8 ? this.headroom + frameMs : 0;
    if (this.elapsed >= 2000 && average > this.targetMs * 1.25 && this.cooldown === 0) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.cooldown = 2000;
      this.headroom = 0;
    } else if (this.headroom >= 10000 && this.cooldown === 0) {
      this.dpr = Math.min(this.cap, this.dpr + 0.25);
      this.headroom = 0;
      this.cooldown = 2000;
    }
    return this.dpr;
  }
}
