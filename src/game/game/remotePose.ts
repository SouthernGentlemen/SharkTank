import type { SceneVec3, OrientedScenePose } from "./sceneMath.js";

export const REMOTE_EXTRAPOLATION_MS = 120;

/** Per-actor presentation correction; authoritative snapshots are never modified. */
export class RemotePose {
  private tick = -Infinity;
  private at = 0;
  private extrapolated = false;
  private last: SceneVec3 | null = null;
  private offset: SceneVec3 = { x: 0, y: 0, z: 0 };

  sample(pose: OrientedScenePose, velocity: SceneVec3, extraMs: number, tick: number, now: number): void {
    const seconds = Math.max(0, Math.min(REMOTE_EXTRAPOLATION_MS, extraMs)) / 1000;
    pose.x += velocity.x * seconds;
    pose.y += velocity.y * seconds;
    pose.z += velocity.z * seconds;
    const recovering = tick !== this.tick && this.extrapolated && this.last && tick > this.tick;
    const decay = recovering ? 1 : Math.exp(-Math.max(0, now - this.at) / 120);
    for (const axis of ["x", "y", "z"] as const) {
      if (tick < this.tick) this.offset[axis] = 0;
      else if (recovering) this.offset[axis] = this.last![axis] - pose[axis];
      else this.offset[axis] *= decay;
      pose[axis] += this.offset[axis];
    }
    this.last ??= { x: 0, y: 0, z: 0 };
    Object.assign(this.last, pose);
    this.tick = tick;
    this.at = now;
    this.extrapolated = extraMs > 0;
  }
}
