import { resolveQuality } from "./quality.js";
import { TICKS_PER_SECOND } from "../../engine/index.js";
import type { PreyKind } from "../../engine/index.js";
import type { NetPrey } from "../../protocol/index.js";
import type { SceneQuality } from "./sceneMath.js";

const QUALITY = {
  low: { radialSegments: 6, verticalSegments: 4 },
  medium: { radialSegments: 8, verticalSegments: 6 },
  high: { radialSegments: 12, verticalSegments: 8 },
} as const;

export function resolvePreyPresentationQuality(quality: SceneQuality) {
  return QUALITY[resolveQuality(quality)];
}

type SchoolSpecies = Extract<NonNullable<NetPrey["species"]>,
  "sardine" | "anchovy" | "silverside" | "clownfish" | "blue-tang" |
  "yellow-tang" | "angelfish" | "parrotfish">;

interface SchoolLook {
  bodyLength: number;
  bodyHeight: number;
  bodyWidth: number;
  headScale: number;
  tailScale: number;
  bodyColor: string;
  headColor: string;
  tailColor: string;
  stripeColor: string;
  stripeCount: 0 | 1 | 2;
}

/** Eight silhouettes and markings keyed solely from protocol-12 species identity. */
export const SCHOOL_LOOKS: Record<SchoolSpecies, SchoolLook> = {
  sardine:     { bodyLength: 0.76, bodyHeight: 0.19, bodyWidth: 0.22, headScale: 0.23, tailScale: 0.26, bodyColor: "#9fc9db", headColor: "#c2e6ee", tailColor: "#7095bd", stripeColor: "#467794", stripeCount: 1 },
  anchovy:     { bodyLength: 0.83, bodyHeight: 0.15, bodyWidth: 0.18, headScale: 0.20, tailScale: 0.21, bodyColor: "#497d91", headColor: "#9bd0d2", tailColor: "#365c77", stripeColor: "#d4eee6", stripeCount: 1 },
  silverside:  { bodyLength: 0.68, bodyHeight: 0.18, bodyWidth: 0.20, headScale: 0.21, tailScale: 0.27, bodyColor: "#d0dfe0", headColor: "#f1e7b2", tailColor: "#9ac4ce", stripeColor: "#80b5cf", stripeCount: 1 },
  clownfish:   { bodyLength: 0.67, bodyHeight: 0.38, bodyWidth: 0.36, headScale: 0.30, tailScale: 0.40, bodyColor: "#ff8b32", headColor: "#ffb458", tailColor: "#eb602c", stripeColor: "#f8f3e6", stripeCount: 2 },
  "blue-tang": { bodyLength: 0.86, bodyHeight: 0.39, bodyWidth: 0.33, headScale: 0.33, tailScale: 0.48, bodyColor: "#2869cc", headColor: "#438eeb", tailColor: "#f9d349", stripeColor: "#172d72", stripeCount: 2 },
  "yellow-tang": { bodyLength: 0.77, bodyHeight: 0.42, bodyWidth: 0.29, headScale: 0.31, tailScale: 0.44, bodyColor: "#f7d645", headColor: "#ffe578", tailColor: "#e9a939", stripeColor: "#e9ae35", stripeCount: 1 },
  angelfish:   { bodyLength: 0.61, bodyHeight: 0.55, bodyWidth: 0.22, headScale: 0.32, tailScale: 0.40, bodyColor: "#806fc3", headColor: "#c7b3e7", tailColor: "#6c5ab2", stripeColor: "#e6d2f0", stripeCount: 2 },
  parrotfish:  { bodyLength: 0.96, bodyHeight: 0.32, bodyWidth: 0.38, headScale: 0.36, tailScale: 0.41, bodyColor: "#3cc6aa", headColor: "#ff8eb4", tailColor: "#2897c3", stripeColor: "#ef72ae", stripeCount: 2 },
};

type PremiumKind = Extract<PreyKind, "tuna" | "squid" | "ray" | "golden">;

/** Silhouettes remain stable across quality presets, using protocol-12 species codes 12–15. */
export const PREMIUM_LOOKS: Record<PremiumKind, SchoolLook> = {
  tuna: { bodyLength: 1.48, bodyHeight: 0.25, bodyWidth: 0.27, headScale: 0.27, tailScale: 0.46, bodyColor: "#769cb4", headColor: "#bfd9e2", tailColor: "#315d7f", stripeColor: "#d7e8ee", stripeCount: 0 },
  squid: { bodyLength: 0.96, bodyHeight: 0.34, bodyWidth: 0.32, headScale: 0.22, tailScale: 0.64, bodyColor: "#d9cee4", headColor: "#f5e6ed", tailColor: "#aa81b7", stripeColor: "#fcf1ef", stripeCount: 0 },
  ray: { bodyLength: 0.72, bodyHeight: 0.12, bodyWidth: 1.18, headScale: 0.22, tailScale: 0.76, bodyColor: "#487c8c", headColor: "#9fb9ab", tailColor: "#365968", stripeColor: "#b6d5cc", stripeCount: 0 },
  golden: { bodyLength: 0.92, bodyHeight: 0.32, bodyWidth: 0.34, headScale: 0.29, tailScale: 0.44, bodyColor: "#ffd342", headColor: "#fff2a3", tailColor: "#f6a51d", stripeColor: "#fff5bc", stripeCount: 0 },
};

export interface PreyVisualProfile {
  shape: "school" | PremiumKind | "drop";
  mode: "fish" | "drop";
  bodyLength: number;
  bodyHeight: number;
  bodyWidth: number;
  headScale: number;
  tailScale: number;
  dropScale: number;
  bodyColor: string;
  headColor: string;
  tailColor: string;
  stripeColor: string;
  stripeCount: 0 | 1 | 2;
}

export function preyVisualFor(kind: PreyKind, value: number, radius: number, species?: NetPrey["species"]): PreyVisualProfile {
  const rewardScale = Math.max(0.82, Math.min(1.35, 0.9 + value * 0.07));
  if (kind === "bait" || kind === "reef" || kind === "tuna" || kind === "ray" || kind === "squid" || kind === "golden") {
    // Fallback protects legacy/test fixtures without changing the wire or authoritative school.
    const key = species && Object.prototype.hasOwnProperty.call(SCHOOL_LOOKS, species)
      ? species as SchoolSpecies : kind === "bait" || kind === "tuna" ? "sardine" : kind === "squid" ? "anchovy" : kind === "golden" ? "yellow-tang" : kind === "ray" ? "blue-tang" : "clownfish";
    const premium: PremiumKind | null =
      kind === "tuna" || kind === "squid" || kind === "ray" || kind === "golden" ? kind : null;
    const style = premium ? PREMIUM_LOOKS[premium] : SCHOOL_LOOKS[key];
    return {
      mode: "fish",
      shape: premium ?? "school",
      bodyLength: style.bodyLength * rewardScale,
      bodyHeight: style.bodyHeight,
      bodyWidth: style.bodyWidth,
      headScale: style.headScale,
      tailScale: style.tailScale,
      dropScale: 0,
      bodyColor: style.bodyColor,
      headColor: style.headColor,
      tailColor: style.tailColor,
      stripeColor: style.stripeColor,
      stripeCount: style.stripeCount,
    };
  }
  const color = kind === "chum" ? "#ff9b54" : "#d88b64";
  return {
    mode: "drop",
    shape: "drop",
    bodyLength: 0,
    bodyHeight: 0,
    bodyWidth: 0,
    headScale: 0,
    tailScale: 0,
    dropScale: Math.max(0.34, radius * (kind === "chum" ? 0.95 : 0.78)),
    bodyColor: color,
    headColor: color,
    tailColor: color,
    stripeColor: color,
    stripeCount: 0,
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

/** Stable per-fish variation, from -15% to +15%, without simulation RNG. */
export function preySizeVariation(id: string): number {
  return 0.85 + (hash(id) / 0xffff_ffff) * 0.3;
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
}): { bodyYaw: number; tailYaw: number; wobbleY: number } {
  if (reducedMotion) return { bodyYaw: 0, tailYaw: 0, wobbleY: 0 };
  const speedFactor = Math.max(0.6, Math.min(2.1, speed / 2.4));
  const phase = seconds * TICKS_PER_SECOND * (0.26 + speedFactor * 0.075) + (hash(id) % 6283) / 1000;
  const amplitude = Math.min(0.52, 0.2 + speedFactor * 0.09);
  return {
    bodyYaw: Math.sin(phase) * amplitude * 0.16,
    tailYaw: Math.sin(phase + 0.65) * amplitude,
    wobbleY: Math.sin(phase * 0.37) * 0.14,
  };
}

/** Ray fins flap around the forward axis; Reduced motion retains the broad static silhouette. */
export function rayWingFlap(seconds: number, id: string, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.sin(seconds * 3.4 + (hash(id) % 6283) / 1000) * 0.25;
}

/** Cosmetic 18-unit proximity gate; neither distance nor caption changes gameplay truth. */
export function goldenFishNearby(
  food: readonly Pick<NetPrey, "kind" | "x" | "y" | "z">[],
  origin: { x: number; y: number; z: number } | null | undefined,
): boolean {
  if (!origin) return false;
  return food.some((actor) => actor.kind === "golden" &&
    (actor.x - origin.x) ** 2 + (actor.y - origin.y) ** 2 + (actor.z - origin.z) ** 2 <= 18 ** 2);
}
