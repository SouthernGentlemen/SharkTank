import { forwardFromYawPitch } from "./geometry3d.js";
import type { Vec3 } from "./types.js";

/** Rest-pose longitudinal landmarks in unscaled model units. */
export const SHARK_GEOMETRY = Object.freeze({ mouth: 1.9, snoutTip: 2.56, tail: -2.45, snoutRadius: 0.48 });

export function sharkScaleForLength(length: number): number {
  const safeLength = Number.isFinite(length) ? Math.max(0, length) : 0;
  return Math.min(2.5, 0.72 + Math.sqrt(safeLength) * 0.12);
}

export interface SharkGeometryPose {
  position: Vec3;
  yaw: number;
  pitch: number;
  length: number;
}

function pointAhead(shark: SharkGeometryPose, offset: number, out: Vec3): Vec3 {
  forwardFromYawPitch(shark.yaw, shark.pitch, out);
  const distance = offset * sharkScaleForLength(shark.length);
  out.x = shark.position.x + out.x * distance;
  out.y = shark.position.y + out.y * distance;
  out.z = shark.position.z + out.z * distance;
  return out;
}

/** Mouth centre on the oriented rest-pose axis. */
export function mouthPoint(shark: SharkGeometryPose, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  return pointAhead(shark, SHARK_GEOMETRY.mouth, out);
}

/** Body axis from snout tip to tail, independent of decorative swim flex. */
export function bodySegment(shark: SharkGeometryPose): { start: Vec3; end: Vec3 } {
  return {
    start: pointAhead(shark, SHARK_GEOMETRY.snoutTip, { x: 0, y: 0, z: 0 }),
    end: pointAhead(shark, SHARK_GEOMETRY.tail, { x: 0, y: 0, z: 0 }),
  };
}
