// Client-side prediction for the local shark only. The server remains authoritative.
// Prediction mirrors yaw+pitch movement locally and reconciles X/Y/Z against the latest
// authoritative server snapshot.

import {
  MOVE,
  TICKS_PER_SECOND,
  clampPitch,
  distance3,
  forwardFromYawPitch,
  moveToward,
  rotateYawToward,
  sampleTrail,
  segmentCount,
  swimSpeedForLungeTicks,
} from "../../engine/index.js";
import type { Vec3 } from "../../engine/index.js";
import type { NetSnake } from "../../protocol/index.js";
import type { LocalInput } from "./useLocalInput.js";

const SPEED = MOVE.BASE_SPEED * TICKS_PER_SECOND;
const TURN = MOVE.TURN_RATE * TICKS_PER_SECOND;
const PITCH = MOVE.PITCH_RATE * TICKS_PER_SECOND;
const CRUMB_STEP = MOVE.SEGMENT_SPACING * 0.5;
const RECONCILE_PER_SECOND = 5;
const MAX_RECONCILE_SPEED = SPEED * 0.65;
const TELEPORT_ERROR = 8;

export interface PredictionResult {
  segments: Vec3[];
  head: Vec3;
  yaw: number;
  pitch: number;
}

export interface PredictionWorld {
  seabedY: number;
  surfaceY: number;
  tick: number;
  frenzyUntilTick: number;
}

export class LocalPredictor {
  private head: Vec3 = { x: 0, y: 0, z: 0 };
  private crumbs: Vec3[] = [];
  private yaw = 0;
  private pitch = 0;
  private length: number = MOVE.MIN_LENGTH;
  private alive = false;

  reset(): void {
    this.alive = false;
    this.crumbs = [];
  }

  private seed(auth: NetSnake): void {
    this.head = { ...auth.segments[0] };
    this.crumbs = auth.segments.slice(1).map((s) => ({ ...s }));
    this.yaw = auth.yaw;
    this.pitch = auth.pitch;
    this.length = auth.length;
    this.alive = true;
  }

  step(
    auth: NetSnake | null | undefined,
    input: LocalInput,
    dt: number,
    staleness: number,
    world?: PredictionWorld,
  ): PredictionResult | null {
    if (!auth || !auth.alive || auth.segments.length === 0) {
      this.alive = false;
      return null;
    }
    if (!this.alive) {
      this.seed(auth);
      return this.build();
    }

    this.length = auth.length;
    const frameStep = Math.min(dt, 0.05);
    this.yaw = rotateYawToward(this.yaw, input.targetYaw, TURN * frameStep);
    this.pitch = clampPitch(moveToward(this.pitch, input.targetPitch, PITCH * frameStep));
    const frenzyMultiplier = world && world.frenzyUntilTick > world.tick ? MOVE.FRENZY_SPEED : 1;
    const speed = swimSpeedForLungeTicks(auth.lungeTicks) * TICKS_PER_SECOND * frenzyMultiplier;
    const forward = forwardFromYawPitch(this.yaw, this.pitch);
    const next: Vec3 = {
      x: this.head.x + forward.x * speed * frameStep,
      y: this.head.y + forward.y * speed * frameStep,
      z: this.head.z + forward.z * speed * frameStep,
    };
    if (world) {
      const boundedY = Math.max(world.seabedY, Math.min(world.surfaceY, next.y));
      if (boundedY !== next.y) this.pitch = 0;
      next.y = boundedY;
    }

    const authSpeed = swimSpeedForLungeTicks(auth.lungeTicks) * TICKS_PER_SECOND * frenzyMultiplier;
    const authForward = forwardFromYawPitch(auth.yaw, auth.pitch);
    const authNow: Vec3 = {
      x: auth.segments[0].x + authForward.x * authSpeed * staleness,
      y: auth.segments[0].y + authForward.y * authSpeed * staleness,
      z: auth.segments[0].z + authForward.z * authSpeed * staleness,
    };
    const error = distance3(authNow, next);
    if (error > TELEPORT_ERROR) {
      this.seed(auth);
      return this.build();
    }
    if (error > 0.001) {
      const eased = 1 - Math.exp(-RECONCILE_PER_SECOND * frameStep);
      const correction = Math.min(eased, MAX_RECONCILE_SPEED * frameStep / error);
      next.x += (authNow.x - next.x) * correction;
      next.y += (authNow.y - next.y) * correction;
      next.z += (authNow.z - next.z) * correction;
    }

    this.head = next;
    const lead = this.crumbs[0];
    if (!lead || distance3(next, lead) >= CRUMB_STEP) this.crumbs.unshift({ ...next });

    const needLen = (segmentCount(this.length) + 2) * MOVE.SEGMENT_SPACING;
    let acc = 0;
    let cut = this.crumbs.length;
    for (let i = 1; i < this.crumbs.length; i += 1) {
      acc += distance3(this.crumbs[i], this.crumbs[i - 1]);
      if (acc >= needLen) {
        cut = i + 1;
        break;
      }
    }
    if (this.crumbs.length > cut) this.crumbs.length = cut;
    return this.build();
  }

  private build(): PredictionResult {
    const path = [this.head, ...this.crumbs];
    const segments = sampleTrail(path, segmentCount(this.length), this.yaw, this.pitch);
    return { segments, head: this.head, yaw: this.yaw, pitch: this.pitch };
  }
}
