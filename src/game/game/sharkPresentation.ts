import { resolveQuality } from "./quality.js";
import { TICKS_PER_SECOND } from "../../engine/index.js";
export type SharkPresentationQuality = import("./quality.js").QualityChoice;

export interface SharkPresentationProfile {
  radialSegments: number;
}

const QUALITY: Record<import("./quality.js").ResolvedQuality, SharkPresentationProfile> = {
  low: { radialSegments: 6 },
  medium: { radialSegments: 8 },
  high: { radialSegments: 10 },
};

export function resolveSharkPresentationQuality(
  quality: SharkPresentationQuality,
): SharkPresentationProfile {
  return QUALITY[resolveQuality(quality)];
}

export function sharkScaleForLength(length: number): number {
  const safeLength = Number.isFinite(length) ? Math.max(0, length) : 0;
  return Math.min(2.5, 0.72 + Math.sqrt(safeLength) * 0.12);
}

export interface SharkAnimationInput {
  seconds: number;
  actorId: string;
  speed: number;
  baseSpeed: number;
  boostSpeed: number;
  boosting: boolean;
  pitch: number;
  reducedMotion: boolean;
}

export interface SharkAnimationPose {
  bodyYaw: number;
  peduncleYaw: number;
  tailYaw: number;
  pectoralSweep: number;
  intensity: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function actorPhase(actorId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < actorId.length; index += 1) {
    hash ^= actorId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 6283) / 1000;
}

export function resolveSharkAnimation(input: SharkAnimationInput): SharkAnimationPose {
  if (input.reducedMotion) {
    return {
      bodyYaw: 0,
      peduncleYaw: 0,
      tailYaw: 0,
      pectoralSweep: 0,
      intensity: 0,
    };
  }

  const baseSpeed = Math.max(0.001, Number.isFinite(input.baseSpeed) ? input.baseSpeed : 0.001);
  const boostSpeed = Math.max(
    baseSpeed + 0.001,
    Number.isFinite(input.boostSpeed) ? input.boostSpeed : baseSpeed + 0.001,
  );
  const speed = Number.isFinite(input.speed) ? input.speed : baseSpeed;
  const speedRatio = clamp01((speed - baseSpeed) / (boostSpeed - baseSpeed));
  const intensity = clamp01(0.28 + speedRatio * 0.58 + (input.boosting ? 0.16 : 0));
  const seconds = Number.isFinite(input.seconds) ? input.seconds : 0;
  const phase = seconds * TICKS_PER_SECOND * (0.3 + speedRatio * 0.09) + actorPhase(input.actorId);
  const pitch = Number.isFinite(input.pitch) ? input.pitch : 0;

  return {
    bodyYaw: Math.sin(phase + 0.55) * (0.018 + intensity * 0.028),
    peduncleYaw: Math.sin(phase - 0.38) * (0.08 + intensity * 0.17),
    tailYaw: Math.sin(phase - 0.85) * (0.16 + intensity * 0.34),
    pectoralSweep: Math.max(
      -0.22,
      Math.min(0.22, -pitch * 0.28 + Math.sin(phase * 0.5) * 0.035 * intensity),
    ),
    intensity,
  };
}
