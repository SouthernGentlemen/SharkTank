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
  { id: "reef-north", kind: "reef", angle: -1.28, radialShare: 1.12 },
  { id: "reef-west", kind: "reef", angle: 2.52, radialShare: 1.13 },
  { id: "reef-south", kind: "reef", angle: 1.42, radialShare: 1.11 },
  { id: "wreck-east", kind: "wreck", angle: 0.35, radialShare: 1.14 },
  { id: "feeding-frenzy", kind: "frenzy", angle: 0, radialShare: 0 },
] as const;

const ENVIRONMENT_QUALITY: Record<SceneQuality, OceanEnvironmentQuality> = {
  low: {
    particulateBudget: 36,
    bubbleBudget: 10,
    lightShaftCount: 1,
    causticBands: 4,
  },
  medium: {
    particulateBudget: 78,
    bubbleBudget: 22,
    lightShaftCount: 2,
    causticBands: 6,
  },
  high: {
    particulateBudget: 132,
    bubbleBudget: 38,
    lightShaftCount: 3,
    causticBands: 8,
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
    frenzyRadius: radius * 0.3,
  };
}

export function resolveOceanEnvironmentQuality(quality: SceneQuality): OceanEnvironmentQuality {
  return ENVIRONMENT_QUALITY[quality];
}

function hash01(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
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
