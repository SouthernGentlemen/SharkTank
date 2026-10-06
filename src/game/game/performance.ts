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
  const hz = QUALITY_HZ[quality];
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
