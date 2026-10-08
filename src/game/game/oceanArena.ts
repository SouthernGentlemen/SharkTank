import { resolveQuality } from "./quality.js";
import { FRENZY_RULES, OCEAN, REEF_SITES } from "../../engine/index.js";
import type { ReefSite } from "../../engine/reefs.js";
import type { SceneQuality } from "./sceneMath.js";
import { OCEAN_CUES } from "./sceneMath.js";

export interface AuthoritativeOceanCueInput {
  arenaRadius?: number;
  seabedY?: number;
  surfaceY?: number;
}

export interface OceanArenaCues {
  radius: number;
  seabedY: number;
  surfaceY: number;
  height: number;
  midY: number;
  boundaryWarningRadius: number;
  frenzyRadius: number;
}

export interface OceanEnvironmentQuality {
  particulateBudget: number;
  bubbleBudget: number;
  lightShaftCount: number;
  causticBands: number;
  frenzyRingCount: number;
  coralPerKindPerSite: number;
  kelpPerGap: number;
}

export type EnvironmentLandmarkKind = "reef" | "wreck" | "frenzy";

export interface EnvironmentLandmark {
  id: string;
  kind: EnvironmentLandmarkKind;
  angle: number;
  radialShare: number;
}

export interface EnvironmentSeed {
  angle: number;
  radialShare: number;
  depthShare: number;
  speed: number;
  size: number;
}

export const ENVIRONMENT_LANDMARKS: readonly EnvironmentLandmark[] = [
  ...REEF_SITES.map((site) => ({
    id: site.id,
    kind: "reef" as const,
    angle: Math.atan2(site.position.z, site.position.x),
    radialShare: Math.hypot(site.position.x, site.position.z) / OCEAN.radius,
  })),
  { id: "wreck-east", kind: "wreck", angle: 0.35, radialShare: 0.82 },
  { id: "feeding-frenzy", kind: "frenzy", angle: 0, radialShare: 0 },
];

const ENVIRONMENT_QUALITY: Record<import("./quality.js").ResolvedQuality, OceanEnvironmentQuality> = {
  low: {
    particulateBudget: 36,
    bubbleBudget: 10,
    lightShaftCount: 1,
    causticBands: 4,
    frenzyRingCount: 1,
    coralPerKindPerSite: 1,
    kelpPerGap: 2,
  },
  medium: {
    particulateBudget: 78,
    bubbleBudget: 22,
    lightShaftCount: 2,
    causticBands: 6,
    frenzyRingCount: 2,
    coralPerKindPerSite: 2,
    kelpPerGap: 4,
  },
  high: {
    particulateBudget: 132,
    bubbleBudget: 38,
    lightShaftCount: 3,
    causticBands: 8,
    frenzyRingCount: 3,
    coralPerKindPerSite: 4,
    kelpPerGap: 6,
  },
};

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveOceanArenaCues(input: AuthoritativeOceanCueInput = {}): OceanArenaCues {
  const radius = Math.max(12, finite(input.arenaRadius, OCEAN_CUES.horizontalRadius));
  const seabedY = finite(input.seabedY, OCEAN_CUES.seabedY);
  const candidateSurface = finite(input.surfaceY, OCEAN_CUES.surfaceY);
  const surfaceY = candidateSurface > seabedY + 2 ? candidateSurface : seabedY + 2;
  const height = surfaceY - seabedY;
  return {
    radius,
    seabedY,
    surfaceY,
    height,
    midY: seabedY + height / 2,
    boundaryWarningRadius: radius * 0.91,
    frenzyRadius: radius * FRENZY_RULES.volumeRadiusShare,
  };
}

export function resolveOceanEnvironmentQuality(quality: SceneQuality): OceanEnvironmentQuality {
  return ENVIRONMENT_QUALITY[resolveQuality(quality)];
}

function hash01(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** Five instanced coral silhouettes; per-site counts are bounded by the quality preset. */
export const CORAL_KINDS = ["brain", "branching", "plate", "fan", "tube"] as const;
export type CoralKind = (typeof CORAL_KINDS)[number];

export const CORAL_PALETTE = [
  "#fa799e", // pink
  "#ad7edb", // purple
  "#ff9460", // orange
  "#f5d772", // yellow
  "#50beb5", // teal
  "#eb5b5a", // red
] as const;

export interface CoralPlacement {
  kind: CoralKind;
  siteId: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  color: (typeof CORAL_PALETTE)[number];
  depthTint: number;
}

export interface KelpPlacement {
  position: { x: number; y: number; z: number };
  rotationY: number;
  width: number;
  height: number;
}

/** Stable transforms, generated only when layout/quality changes; no gameplay RNG. */
export function makeCoralPlacements(sites: readonly ReefSite[], perKindPerSite: number, surfaceY: number = OCEAN.surfaceY): CoralPlacement[] {
  const count = Math.max(0, Math.min(4, Math.floor(Number.isFinite(perKindPerSite) ? perKindPerSite : 0)));
  const lifts = [1.1, 1.7, 0.45, 0.18, 1.4] as const;
  const placements: CoralPlacement[] = [];
  sites.forEach((site, siteIndex) => {
    CORAL_KINDS.forEach((kind, kindIndex) => {
      for (let index = 0; index < count; index += 1) {
        const seed = siteIndex * 53 + kindIndex * 7 + index;
        const angle = hash01(seed, 1807) * Math.PI * 2;
        const radial = Math.sqrt(hash01(seed, 2197)) * site.radius * 0.69;
        const scale = 0.65 + hash01(seed, 3109) * 0.75;
        const y = site.position.y + lifts[kindIndex] * scale;
        const depth = Math.max(0, Math.min(1, (surfaceY - y) / Math.max(1, surfaceY - site.position.y)));
        placements.push({
          kind,
          siteId: site.id,
          position: {
            x: site.position.x + Math.cos(angle) * radial,
            y,
            z: site.position.z + Math.sin(angle) * radial,
          },
          rotationY: hash01(seed, 4201) * Math.PI * 2,
          scale,
          color: CORAL_PALETTE[Math.floor(hash01(seed, 5333) * CORAL_PALETTE.length)],
          depthTint: 0.06 + depth * 0.26,
        });
      }
    });
  });
  return placements;
}

/** Kelp patches fill the gaps between neighbouring reef anchors. */
export function makeKelpPlacements(sites: readonly ReefSite[], perGap: number): KelpPlacement[] {
  const count = Math.max(0, Math.min(6, Math.floor(Number.isFinite(perGap) ? perGap : 0)));
  if (sites.length < 2) return [];
  const placements: KelpPlacement[] = [];
  sites.forEach((site, siteIndex) => {
    const next = sites[(siteIndex + 1) % sites.length];
    const midX = (site.position.x + next.position.x) / 2;
    const midZ = (site.position.z + next.position.z) / 2;
    const spread = Math.min(site.radius, next.radius) * 0.26;
    for (let index = 0; index < count; index += 1) {
      const seed = siteIndex * 19 + index;
      const angle = hash01(seed, 8101) * Math.PI * 2;
      const radial = Math.sqrt(hash01(seed, 8111)) * spread;
      const height = 2.7 + hash01(seed, 8123) * 2.5;
      placements.push({
        position: {
          x: midX + Math.cos(angle) * radial,
          y: site.position.y - 0.12 + height / 2,
          z: midZ + Math.sin(angle) * radial,
        },
        rotationY: hash01(seed, 8137) * Math.PI * 2,
        width: 0.45 + hash01(seed, 8147) * 0.4,
        height,
      });
    }
  });
  return placements;
}

export function makeEnvironmentSeeds(count: number, salt = 0): EnvironmentSeed[] {
  const safeCount = Math.max(0, Math.min(256, Math.floor(Number.isFinite(count) ? count : 0)));
  return Array.from({ length: safeCount }, (_, index) => ({
    angle: hash01(index, salt + 11) * Math.PI * 2,
    radialShare: Math.sqrt(hash01(index, salt + 29)) * 0.88,
    depthShare: 0.06 + hash01(index, salt + 47) * 0.88,
    speed: 0.018 + hash01(index, salt + 71) * 0.034,
    size: 0.08 + hash01(index, salt + 97) * 0.16,
  }));
}
