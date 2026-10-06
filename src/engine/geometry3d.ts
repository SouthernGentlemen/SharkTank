import type { OceanVolume, Vec3 } from "./types.js";

export const MAX_PITCH = Math.PI / 2 - 0.05;
const EPSILON = 1e-12;

export function normalizeYaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = (value + Math.PI) % (Math.PI * 2);
  return (wrapped < 0 ? wrapped + Math.PI * 2 : wrapped) - Math.PI;
}

export function shortestYawDelta(from: number, to: number): number {
  return normalizeYaw(normalizeYaw(to) - normalizeYaw(from));
}

export function lerpYawShortest(from: number, to: number, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  return normalizeYaw(normalizeYaw(from) + shortestYawDelta(from, to) * t);
}

export function rotateYawToward(current: number, target: number, maxStep: number): number {
  const diff = shortestYawDelta(current, target);
  if (Math.abs(diff) <= maxStep) return normalizeYaw(target);
  return normalizeYaw(current + Math.sign(diff) * maxStep);
}

export function moveToward(current: number, target: number, maxStep: number): number {
  const delta = target - current;
  return Math.abs(delta) <= maxStep ? target : current + Math.sign(delta) * maxStep;
}

export function clampPitch(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, value));
}


export function forwardFromYawPitch(
  yaw: number,
  pitch: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  const safeYaw = normalizeYaw(yaw);
  const safePitch = clampPitch(pitch);
  const cosPitch = Math.cos(safePitch);
  out.x = Math.cos(safeYaw) * cosPitch;
  out.y = Math.sin(safePitch);
  out.z = Math.sin(safeYaw) * cosPitch;
  return out;
}

export function distanceSquared3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance3(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSquared3(a, b));
}

export function horizontalRadiusSquared(point: Pick<Vec3, "x" | "z">): number {
  return point.x * point.x + point.z * point.z;
}

export function clampToOceanVolume(
  point: Vec3,
  ocean: OceanVolume,
  margin = 0,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  const radius = Math.max(0, ocean.radius - margin);
  const radialSq = horizontalRadiusSquared(point);
  let x = Number.isFinite(point.x) ? point.x : 0;
  let z = Number.isFinite(point.z) ? point.z : 0;
  if (radialSq > radius * radius && radialSq > EPSILON) {
    const scale = radius / Math.sqrt(radialSq);
    x *= scale;
    z *= scale;
  }
  const low = ocean.seabedY + margin;
  const high = ocean.surfaceY - margin;
  const fallbackY = (ocean.seabedY + ocean.surfaceY) / 2;
  const y = Number.isFinite(point.y)
    ? (low <= high ? Math.max(low, Math.min(high, point.y)) : fallbackY)
    : fallbackY;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function yawPitchToward(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  return {
    yaw: normalizeYaw(Math.atan2(dz, dx)),
    pitch: clampPitch(Math.atan2(dy, horizontal)),
  };
}
