import { clampPitch, forwardFromYawPitch, normalizeYaw } from "../../engine/geometry3d.js";
import type { Vec3 } from "../../engine/types.js";

export const AIM_ASSIST = { cone: 20 * Math.PI / 180, range: 14, radiansPerSecond: 0.25, edibleRatio: 1.5 } as const;

type Heading = { yaw: number; pitch: number };
type Shark = { id: string; position: Vec3; length: number; alive: boolean };
type Targets = { food: readonly Vec3[]; sharks: readonly Shark[] };

export function aimAssistEnabled(choice: boolean | null, touch: boolean): boolean {
  return choice ?? touch;
}

/** Client intent only: rotate along the shortest 3D arc, never author a hit or score. */
export function assistAim(heading: Heading, me: Shark, state: Targets, dt: number, enabled: boolean): Heading {
  if (!enabled || !me.alive || !Number.isFinite(dt) || dt <= 0) return heading;
  const forward = forwardFromYawPitch(heading.yaw, heading.pitch);
  let target: Vec3 | null = null;
  let bestDot = Math.cos(AIM_ASSIST.cone);
  let bestDistance = Infinity;
  const consider = (position: Vec3) => {
    const x = position.x - me.position.x;
    const y = position.y - me.position.y;
    const z = position.z - me.position.z;
    const distance = Math.hypot(x, y, z);
    if (!Number.isFinite(distance) || distance <= 1e-6 || distance > AIM_ASSIST.range) return;
    const dot = (x * forward.x + y * forward.y + z * forward.z) / distance;
    if (dot < bestDot || (dot === bestDot && distance >= bestDistance)) return;
    bestDot = Math.min(1, dot);
    bestDistance = distance;
    target = { x: x / distance, y: y / distance, z: z / distance };
  };
  for (const prey of state.food) consider(prey);
  for (const shark of state.sharks) {
    if (shark.id !== me.id && shark.alive && me.length >= shark.length * AIM_ASSIST.edibleRatio) consider(shark.position);
  }
  if (!target) return heading;
  const direction: Vec3 = target;
  const angle = Math.acos(bestDot);
  if (angle < 1e-6) return heading;
  const step = Math.min(angle, AIM_ASSIST.radiansPerSecond * Math.min(dt, 0.05));
  const a = Math.sin(angle - step) / Math.sin(angle);
  const b = Math.sin(step) / Math.sin(angle);
  const x = a * forward.x + b * direction.x;
  const y = a * forward.y + b * direction.y;
  const z = a * forward.z + b * direction.z;
  return { yaw: normalizeYaw(Math.atan2(z, x)), pitch: clampPitch(Math.atan2(y, Math.hypot(x, z))) };
}
