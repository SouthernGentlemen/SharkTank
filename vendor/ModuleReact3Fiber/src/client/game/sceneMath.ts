import { lerpYawShortest } from "../../engine/index.js";

export type SceneQuality = "low" | "medium" | "high";

export interface SceneVec3 {
  x: number;
  y: number;
  z: number;
}

export interface ChaseCameraPose {
  position: SceneVec3;
  lookAt: SceneVec3;
}

export interface OrientedScenePose extends SceneVec3 {
  yaw: number;
  pitch: number;
}

export function interpolateOrientedPose(
  previous: OrientedScenePose,
  current: OrientedScenePose,
  alpha: number,
  out: OrientedScenePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
): OrientedScenePose {
  const t = Math.max(0, Math.min(1, alpha));
  out.x = previous.x + (current.x - previous.x) * t;
  out.y = previous.y + (current.y - previous.y) * t;
  out.z = previous.z + (current.z - previous.z) * t;
  out.yaw = lerpYawShortest(previous.yaw, current.yaw, t);
  out.pitch = previous.pitch + (current.pitch - previous.pitch) * t;
  return out;
}

export const CAMERA_PROJECTION = {
  fov: 58,
  near: 0.35,
  far: 260,
} as const;

export const OCEAN_CUES = {
  surfaceY: 12,
  seabedY: -12,
  horizontalRadius: 210,
  depthReferenceRadius: 42,
} as const;

const QUALITY = {
  low: {
    dpr: [1, 1.25] as [number, number],
    antialias: false,
    geometryDetail: 6,
    ringSegments: 64,
    fogNear: 30,
    fogFar: 150,
    burstParticleBudget: 192,
  },
  medium: {
    dpr: [1, 1.6] as [number, number],
    antialias: true,
    geometryDetail: 8,
    ringSegments: 96,
    fogNear: 38,
    fogFar: 190,
    burstParticleBudget: 320,
  },
  high: {
    dpr: [1, 2] as [number, number],
    antialias: true,
    geometryDetail: 12,
    ringSegments: 128,
    fogNear: 46,
    fogFar: 230,
    burstParticleBudget: 512,
  },
} as const;

export function resolveSceneQuality(quality: SceneQuality) {
  return QUALITY[quality];
}

/**
 * World convention for the full-3D rebuild:
 * X/Z are the horizontal plane, +Y is up, yaw rotates around +Y and pitch tilts
 * forward motion toward +Y. Yaw 0 points along +X to preserve the planar engine's
 * current heading convention until authority becomes volumetric in ST-112.
 */
export function forwardFromYawPitch(
  yaw: number,
  pitch: number,
  out: SceneVec3 = { x: 0, y: 0, z: 0 },
): SceneVec3 {
  const cosPitch = Math.cos(pitch);
  out.x = Math.cos(yaw) * cosPitch;
  out.y = Math.sin(pitch);
  out.z = Math.sin(yaw) * cosPitch;
  return out;
}

export function makeChaseCameraPose(): ChaseCameraPose {
  return {
    position: { x: 0, y: 18, z: 24 },
    lookAt: { x: 0, y: 0, z: 0 },
  };
}

export function chaseCameraPose(
  target: SceneVec3,
  yaw: number,
  pitch: number,
  out: ChaseCameraPose = makeChaseCameraPose(),
): ChaseCameraPose {
  const forward = forwardFromYawPitch(yaw, pitch);
  const distance = 18;
  const lift = 7;
  const lookAhead = 5;

  out.position.x = target.x - forward.x * distance;
  out.position.y = target.y + lift - forward.y * 5;
  out.position.z = target.z - forward.z * distance;
  out.lookAt.x = target.x + forward.x * lookAhead;
  out.lookAt.y = target.y + 1 + forward.y * lookAhead;
  out.lookAt.z = target.z + forward.z * lookAhead;
  return out;
}
