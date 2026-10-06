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
  swimSpeedForLungeTicks,
} from "../../engine/index.js";
import type { Vec3 } from "../../engine/index.js";
import type { ClientShark } from "../net/clientState.js";
import type { LocalInput } from "./useLocalInput.js";

const SPEED = MOVE.BASE_SPEED * TICKS_PER_SECOND;
const TURN = MOVE.TURN_RATE * TICKS_PER_SECOND;
const PITCH = MOVE.PITCH_RATE * TICKS_PER_SECOND;
const RECONCILE_PER_SECOND = 5;
const MAX_RECONCILE_SPEED = SPEED * 0.65;
const TELEPORT_ERROR = 8;

export interface PredictionResult {
  position: Vec3;
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
  private yaw = 0;
  private pitch = 0;
  private alive = false;

  reset(): void {
    this.alive = false;
  }

  private seed(auth: ClientShark): void {
    this.head = { ...auth.position! };
    this.yaw = auth.yaw;
    this.pitch = auth.pitch;
    this.alive = true;
  }

  step(
    auth: ClientShark | null | undefined,
    input: LocalInput,
    dt: number,
    staleness: number,
    world?: PredictionWorld,
  ): PredictionResult | null {
    if (!auth || !auth.alive || !auth.position) {
      this.alive = false;
      return null;
    }
    if (!this.alive) {
      this.seed(auth);
      return this.build();
    }

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
      x: auth.position.x + authForward.x * authSpeed * staleness,
      y: auth.position.y + authForward.y * authSpeed * staleness,
      z: auth.position.z + authForward.z * authSpeed * staleness,
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
    return this.build();
  }

  private build(): PredictionResult {
    return { position: this.head, yaw: this.yaw, pitch: this.pitch };
  }
}
