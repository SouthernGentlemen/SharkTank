import { resolveQuality } from "./quality.js";
import { TICKS_PER_SECOND } from "../../engine/index.js";
import type { PreyKind } from "../../engine/index.js";
import type { SceneQuality } from "./sceneMath.js";

const QUALITY = {
  low: { radialSegments: 6, verticalSegments: 4 },
  medium: { radialSegments: 8, verticalSegments: 6 },
  high: { radialSegments: 12, verticalSegments: 8 },
} as const;

export function resolvePreyPresentationQuality(quality: SceneQuality) {
  return QUALITY[resolveQuality(quality)];
}

export interface PreyVisualProfile {
  mode: "fish" | "drop";
  bodyLength: number;
  bodyHeight: number;
  bodyWidth: number;
  headScale: number;
  tailScale: number;
  dropScale: number;
}

export function preyVisualFor(kind: PreyKind, value: number, radius: number): PreyVisualProfile {
  const rewardScale = Math.max(0.82, Math.min(1.35, 0.9 + value * 0.07));
  if (kind === "bait") {
    return { mode: "fish", bodyLength: 0.72 * rewardScale, bodyHeight: 0.2, bodyWidth: 0.28, headScale: 0.24, tailScale: 0.28, dropScale: 0 };
  }
  if (kind === "reef") {
    return { mode: "fish", bodyLength: 0.92 * rewardScale, bodyHeight: 0.34, bodyWidth: 0.42, headScale: 0.34, tailScale: 0.42, dropScale: 0 };
  }
  return {
    mode: "drop",
    bodyLength: 0,
    bodyHeight: 0,
    bodyWidth: 0,
    headScale: 0,
    tailScale: 0,
    dropScale: Math.max(0.34, radius * (kind === "chum" ? 0.95 : 0.78)),
  };
}

function hash(value: string): number {
  let out = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

export function resolvePreyAnimation({
  seconds,
  id,
  speed,
  reducedMotion,
}: {
  seconds: number;
  id: string;
  speed: number;
  reducedMotion: boolean;
}): { bodyYaw: number; tailYaw: number } {
  if (reducedMotion) return { bodyYaw: 0, tailYaw: 0 };
  const speedFactor = Math.max(0.6, Math.min(2.1, speed / 2.4));
  const phase = seconds * TICKS_PER_SECOND * (0.26 + speedFactor * 0.075) + (hash(id) % 6283) / 1000;
  const amplitude = Math.min(0.52, 0.2 + speedFactor * 0.09);
  return {
    bodyYaw: Math.sin(phase) * amplitude * 0.16,
    tailYaw: Math.sin(phase + 0.65) * amplitude,
  };
}
