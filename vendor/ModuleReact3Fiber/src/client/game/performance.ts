import { PREY_BUDGET, TICKS_PER_SECOND } from "../../engine/index.js";
import { resolveOceanEnvironmentQuality } from "./oceanArena.js";
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

export const CLIENT_PERFORMANCE_BUDGETS = {
  maxSharks: 32,
  maxPrey: PREY_BUDGET.max,
  networkSnapshotEveryTicks: 2,
  networkSnapshotHz: TICKS_PER_SECOND / 2,
  maxSnapshotBytes: 60_000,
  maxSnapshotBytesPerSecond: 600_000,
  desktopTargetFrameMs: 1000 / 60,
  mobileLowTargetFrameMs: 1000 / 30,
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

export interface SceneRenderCost {
  drawCalls: number;
  geometries: number;
  materials: number;
}

/**
 * Maximum visible mesh/material surfaces for the current procedural scene.
 * Instanced actors count once per geometry/material family, not once per actor.
 * This is a deterministic structural inventory, not an FPS claim.
 */
export function estimateSceneRenderCost(quality: SceneQuality): SceneRenderCost {
  const environment = resolveOceanEnvironmentQuality(quality);
  const actorDraws = 11; // ten instanced shark parts + the Apex marker
  const preyDraws = 4; // three fish parts + one drop family
  const fxDraws = 3; // frenzy ring, boundary ring, instanced burst particles
  const environmentDraws =
    26 // fixed seabed/surface/bounds, batched markers/reefs/shafts, wreck, frenzy, particles
    + environment.causticBands
    + environment.frenzyRingCount;
  const drawCalls = actorDraws + preyDraws + fxDraws + environmentDraws;
  return { drawCalls, geometries: drawCalls, materials: drawCalls };
}

/** Pre-ST-127 structural inventory, retained only as reproducible optimization evidence. */
export function estimateBaselineSceneRenderCost(quality: SceneQuality): SceneRenderCost {
  const environment = resolveOceanEnvironmentQuality(quality);
  const actorDraws = 11;
  const preyDraws = 4;
  const fxDraws = 3;
  const environmentDraws =
    42 // repeated boundary markers and reef parts were separate meshes
    + environment.causticBands
    + environment.frenzyRingCount
    + environment.lightShaftCount;
  const drawCalls = actorDraws + preyDraws + fxDraws + environmentDraws;
  return { drawCalls, geometries: drawCalls, materials: drawCalls };
}
