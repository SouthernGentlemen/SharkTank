import { resolveQuality } from "./quality.js";
import { SHARK_GEOMETRY, TICKS_PER_SECOND, shortestYawDelta, clampPitch, lerpYawShortest, normalizeYaw } from "../../engine/index.js";

export type SceneQuality = import("./quality.js").QualityChoice;

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

export interface SwimSteeringRates {
  turnRate: number;
  pitchRate: number;
}

export const SWIM_STEERING: SwimSteeringRates = {
  turnRate: 3.2,
  pitchRate: 2.4,
};

export const CAMERA_LOOK_LIMITS = {
  yaw: Math.PI * 0.42,
  pitch: 0.65,
} as const;

export function clampCameraLookOffsets(yaw: number, pitch: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.max(-CAMERA_LOOK_LIMITS.yaw, Math.min(CAMERA_LOOK_LIMITS.yaw, Number.isFinite(yaw) ? yaw : 0)),
    pitch: Math.max(-CAMERA_LOOK_LIMITS.pitch, Math.min(CAMERA_LOOK_LIMITS.pitch, Number.isFinite(pitch) ? pitch : 0)),
  };
}

export interface ChaseCameraOptions {
  sharkScale?: number;
  speed?: number;
  baseSpeed?: number;
  boostSpeed?: number;
  arenaRadius?: number;
  seabedY?: number;
  surfaceY?: number;
  reducedMotion?: boolean;
  lookYawOffset?: number;
  lookPitchOffset?: number;
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
  horizontalRadius: 82,
  depthReferenceRadius: 42,
} as const;

const QUALITY = {
  low: {
    dpr: [1, 1.25] as [number, number],
    antialias: false,
    geometryDetail: 6,
    ringSegments: 64,
    fogNear: 30,
    fogFar: 60,
    burstParticleBudget: 192,
  },
  medium: {
    dpr: [1, 1.6] as [number, number],
    antialias: true,
    geometryDetail: 8,
    ringSegments: 96,
    fogNear: 38,
    fogFar: 65,
    burstParticleBudget: 320,
  },
  high: {
    dpr: [1, 2] as [number, number],
    antialias: true,
    geometryDetail: 12,
    ringSegments: 128,
    fogNear: 46,
    fogFar: 70,
    burstParticleBudget: 512,
  },
} as const;

export function resolveSceneQuality(quality: SceneQuality) {
  return QUALITY[resolveQuality(quality)];
}

function unitAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Camera-relative flight-stick steering. The chase rig follows the shark's current
 * forward frame, so the shared desktop and mobile axes stay intuitive through arbitrary
 * yaw + pitch.
 */
export function applyCameraRelativeSteering(
  yaw: number,
  pitch: number,
  yawAxis: number,
  pitchAxis: number,
  dt: number,
  rates: SwimSteeringRates = SWIM_STEERING,
): { yaw: number; pitch: number } {
  const frameStep = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  return {
    yaw: normalizeYaw(yaw + unitAxis(yawAxis) * rates.turnRate * frameStep),
    pitch: clampPitch(pitch + unitAxis(pitchAxis) * rates.pitchRate * frameStep),
  };
}

/**
 * World convention for the full-3D rebuild:
 * X/Z are the horizontal plane, +Y is up, yaw rotates around +Y and pitch tilts
 * forward motion toward +Y. Yaw 0 points along +X.
 */
export function forwardFromYawPitch(
  yaw: number,
  pitch: number,
  out: SceneVec3 = { x: 0, y: 0, z: 0 },
): SceneVec3 {
  const safeYaw = normalizeYaw(yaw);
  const safePitch = clampPitch(pitch);
  const cosPitch = Math.cos(safePitch);
  out.x = Math.cos(safeYaw) * cosPitch;
  out.y = Math.sin(safePitch);
  out.z = Math.sin(safeYaw) * cosPitch;
  return out;
}

/** Authoritative snapshot yaw delta in radians per second, including wraparound. */
export function snapshotYawRate(olderYaw: number, newerYaw: number, olderTick: number, newerTick: number): number {
  const span = newerTick - olderTick;
  return span > 0 ? shortestYawDelta(olderYaw, newerYaw) * TICKS_PER_SECOND / span : 0;
}

export function smoothYawRate(current: number, target: number, dt: number): number {
  const step = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  return current + (target - current) * (1 - Math.exp(-8 * step));
}

export function advanceBankRoll(
  currentRoll: number,
  yawRate: number,
  dt: number,
  reducedMotion = false,
): number {
  const maxBank = reducedMotion ? 0.24 : 0.42;
  const target = Math.max(
    -maxBank,
    Math.min(maxBank, -yawRate * (reducedMotion ? 0.09 : 0.16)),
  );
  if (reducedMotion) return Math.abs(target) < 0.0005 ? 0 : target;
  const frameStep = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  const response = Math.abs(target) > 0.01 ? 9 : 6;
  const blend = 1 - Math.exp(-response * frameStep);
  const next = currentRoll + (target - currentRoll) * blend;
  return Math.abs(next) < 0.0005 ? 0 : next;
}

export function makeChaseCameraPose(): ChaseCameraPose {
  return {
    position: { x: 0, y: 18, z: 24 },
    lookAt: { x: 0, y: 0, z: 0 },
  };
}

function speedRatio(options: ChaseCameraOptions): number {
  if (options.reducedMotion) return 0;
  const base = options.baseSpeed ?? 11;
  const boost = Math.max(base + 0.001, options.boostSpeed ?? 28);
  const speed = options.speed ?? base;
  return Math.max(0, Math.min(1, (speed - base) / (boost - base)));
}

function clampCameraPoint(
  point: SceneVec3,
  options: ChaseCameraOptions,
  verticalMargin: number,
  radialMargin: number,
): void {
  if (typeof options.seabedY === "number" && Number.isFinite(options.seabedY)) {
    point.y = Math.max(options.seabedY + verticalMargin, point.y);
  }
  if (typeof options.surfaceY === "number" && Number.isFinite(options.surfaceY)) {
    point.y = Math.min(options.surfaceY - verticalMargin, point.y);
  }
  const radius = options.arenaRadius;
  if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= radialMargin) return;
  const maxRadius = radius - radialMargin;
  const radial = Math.hypot(point.x, point.z);
  if (radial <= maxRadius || radial <= 1e-6) return;
  const scale = maxRadius / radial;
  point.x *= scale;
  point.z *= scale;
}

export function chaseCameraPose(
  target: SceneVec3,
  yaw: number,
  pitch: number,
  out: ChaseCameraPose = makeChaseCameraPose(),
  options: ChaseCameraOptions = {},
): ChaseCameraPose {
  const forward = forwardFromYawPitch(yaw, pitch);
  const look = clampCameraLookOffsets(options.lookYawOffset ?? 0, options.lookPitchOffset ?? 0);
  const cameraForward = forwardFromYawPitch(yaw + look.yaw, pitch + look.pitch);
  const size = Math.max(0.7, Math.min(2.8, options.sharkScale ?? 1));
  const speed = speedRatio(options);
  const distance = 9 + size * 3.2 + speed * 3.5;
  const lift = 5 + size * 1.4;
  // Preserve the existing framing, measured ahead of the shared mouth landmark.
  const lookBeyondMouth = 7 - size * 1.25 + speed * 3.2;
  const lookAhead = SHARK_GEOMETRY.mouth * size + lookBeyondMouth;

  out.position.x = target.x - cameraForward.x * distance;
  out.position.y = target.y - cameraForward.y * distance + lift;
  out.position.z = target.z - cameraForward.z * distance;
  out.lookAt.x = target.x + forward.x * lookAhead;
  out.lookAt.y = target.y + forward.y * lookAhead + 2.5;
  out.lookAt.z = target.z + forward.z * lookAhead;

  clampCameraPoint(out.position, options, 1.25, 1.5);
  clampCameraPoint(out.lookAt, options, 0.35, 0.35);
  return out;
}

export function smoothChaseCameraPose(
  current: ChaseCameraPose,
  goal: ChaseCameraPose,
  dt: number,
  reducedMotion = false,
  out: ChaseCameraPose = current,
): ChaseCameraPose {
  const frameStep = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  const positionBlend = reducedMotion ? 1 : 1 - Math.exp(-8 * frameStep);
  const lookBlend = reducedMotion ? 1 : 1 - Math.exp(-10 * frameStep);
  for (const axis of ["x", "y", "z"] as const) {
    out.position[axis] = current.position[axis] + (goal.position[axis] - current.position[axis]) * positionBlend;
    out.lookAt[axis] = current.lookAt[axis] + (goal.lookAt[axis] - current.lookAt[axis]) * lookBlend;
  }
  return out;
}

export function cameraFovForSpeed(
  speed: number,
  baseSpeed: number,
  boostSpeed: number,
  reducedMotion = false,
): number {
  if (reducedMotion) return CAMERA_PROJECTION.fov;
  const span = Math.max(0.001, boostSpeed - baseSpeed);
  const ratio = Math.max(0, Math.min(1, (speed - baseSpeed) / span));
  return CAMERA_PROJECTION.fov + ratio * 3.5;
}

/** Preserve a useful horizontal view on tall screens, with bounded distortion. */
export function cameraFovForAspect(fov: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return fov;
  return Math.min(100, 2 * Math.atan(Math.tan(fov * Math.PI / 360) / aspect) * 180 / Math.PI);
}
