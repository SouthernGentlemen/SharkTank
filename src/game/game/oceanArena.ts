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
  },
  medium: {
    particulateBudget: 78,
    bubbleBudget: 22,
    lightShaftCount: 2,
    causticBands: 6,
    frenzyRingCount: 2,
    coralPerKindPerSite: 2,
  },
  high: {
    particulateBudget: 132,
    bubbleBudget: 38,
    lightShaftCount: 3,
    causticBands: 8,
    frenzyRingCount: 3,
    coralPerKindPerSite: 4,
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

export interface CoralPlacement {
  kind: CoralKind;
  siteId: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
}

/** Stable transforms, generated only when layout/quality changes; no gameplay RNG. */
export function makeCoralPlacements(sites: readonly ReefSite[], perKindPerSite: number): CoralPlacement[] {
  const count = Math.max(0, Math.min(4, Math.floor(Number.isFinite(perKindPerSite) ? perKindPerSite : 0)));
  const lifts = [1.1, 1.7, 0.45, 0.18, 1.4] as const;
  const placements: CoralPlacement[] = [];
  sites.forEach((site, siteIndex) => {
    CORAL_KINDS.forEach((kind, kindIndex) => {
      for (let index = 0; index < count; index += 1) {
        const seed = siteIndex * 53 + kindIndex * 7 + index;
        const angle = hash01(seed, 1807) * Math.PI * 2;
        const radial = Math.sqrt(hash01(seed, 2197)) * site.radius * 0.69;
        const scale = 0.85 + hash01(seed, 3109) * 0.3;
        placements.push({
          kind,
          siteId: site.id,
          position: {
            x: site.position.x + Math.cos(angle) * radial,
            y: site.position.y + lifts[kindIndex] * scale,
            z: site.position.z + Math.sin(angle) * radial,
          },
          rotationY: hash01(seed, 4201) * Math.PI * 2,
          scale,
        });
      }
    });
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
