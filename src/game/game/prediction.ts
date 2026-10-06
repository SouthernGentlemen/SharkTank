// Client-side prediction for the local shark only. The server remains authoritative.
// Prediction mirrors yaw+pitch movement locally and reconciles X/Y/Z against the latest
// authoritative server snapshot.

import {
  MOVE,
  DASH_TICKS,
  TICKS_PER_SECOND,
  clampPitch,
  glidePitch,
  returningCurrentYaw,
  clampToCurrent,
  distance3,
  forwardFromYawPitch,
  moveToward,
  rotateYawToward,
  swimSpeedForLungeTicks,
} from "../../engine/index.js";
import type { OceanVolume, Vec3 } from "../../engine/index.js";
import type { ClientShark } from "../net/clientState.js";
import type { LocalInput } from "./useLocalInput.js";

const SPEED = MOVE.BASE_SPEED * TICKS_PER_SECOND;
const TURN = MOVE.TURN_RATE * TICKS_PER_SECOND;
const PITCH = MOVE.PITCH_RATE * TICKS_PER_SECOND;
const RECONCILE_PER_SECOND = 5;
const MAX_RECONCILE_SPEED = SPEED * 0.65;
const TELEPORT_ERROR = 8;
const MAX_VISUAL_ERROR = 12;
const VISUAL_HALF_LIFE = 0.12;

export interface PredictionResult {
  position: Vec3;
  yaw: number;
  pitch: number;
}

export interface PredictionWorld {
  arenaRadius?: number;
  seabedY: number;
  surfaceY: number;
  tick: number;
  frenzyUntilTick: number;
}

export class LocalPredictor {
  private ocean: OceanVolume | null = null;
  private head: Vec3 = { x: 0, y: 0, z: 0 };
  private visualOffset: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private alive = false;
  private lastPress = -Infinity;
  private pendingAt: number | null = null;
  private cooldownAtPress = 0;
  private lastTick = -1;
  private sharkId: string | null = null;

  reset(): void {
    this.ocean = null;
    this.visualOffset = { x: 0, y: 0, z: 0 };
    this.alive = false;
    this.pendingAt = null;
    this.lastTick = -1;
    this.sharkId = null;
  }

  private seed(auth: ClientShark): void {
    this.pendingAt = null;
    this.sharkId = auth.id;
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
    nowMs = performance.now(),
    dashPressedAt = -Infinity,
  ): PredictionResult | null {
    if (!auth || !auth.alive || !auth.position) {
      this.reset();
      this.lastPress = dashPressedAt;
      return null;
    }
    if (auth.id !== this.sharkId || (world && world.tick < this.lastTick)) this.reset();
    this.ocean = world?.arenaRadius === undefined ? null : { radius: world.arenaRadius, seabedY: world.seabedY, surfaceY: world.surfaceY };
    this.lastTick = world?.tick ?? this.lastTick;
    if (!this.alive) {
      this.seed(auth);
      this.lastPress = dashPressedAt;
      return this.build();
    }

    if (dashPressedAt !== this.lastPress) {
      this.lastPress = dashPressedAt;
      if (world && world.tick >= auth.dashCooldownTick && auth.lungeTicks === 0
        && nowMs - dashPressedAt < 250 && this.pendingAt === null) {
        this.pendingAt = dashPressedAt;
        this.cooldownAtPress = auth.dashCooldownTick;
      }
    }
    if (this.pendingAt !== null && (auth.lungeTicks > 0
      || auth.dashCooldownTick > this.cooldownAtPress || nowMs - this.pendingAt >= 250)) {
      this.pendingAt = null;
    }
    const predictedTicks = this.pendingAt === null ? auth.lungeTicks
      : Math.max(0, DASH_TICKS - Math.floor((nowMs - this.pendingAt) / 1000 * TICKS_PER_SECOND));

    const frameStep = Math.min(dt, 0.05);
    this.yaw = rotateYawToward(this.yaw, input.targetYaw, TURN * frameStep);
    if (world?.arenaRadius !== undefined) this.yaw = returningCurrentYaw(this.yaw, this.head, world.arenaRadius, frameStep);
    this.pitch = clampPitch(moveToward(this.pitch, input.targetPitch, PITCH * frameStep));
    if (world) this.pitch = glidePitch(this.pitch, this.head.y, world);
    const frenzyMultiplier = world && world.frenzyUntilTick > world.tick ? MOVE.FRENZY_SPEED : 1;
    const speed = swimSpeedForLungeTicks(predictedTicks) * TICKS_PER_SECOND * frenzyMultiplier;
    const forward = forwardFromYawPitch(this.yaw, this.pitch);
    const next: Vec3 = {
      x: this.head.x + forward.x * speed * frameStep,
      y: this.head.y + forward.y * speed * frameStep,
      z: this.head.z + forward.z * speed * frameStep,
    };
    if (world) {
      const boundedY = Math.max(world.seabedY, Math.min(world.surfaceY, next.y));
      next.y = boundedY;
    }

    if (this.ocean) Object.assign(next, clampToCurrent(next, this.ocean));

    const authSpeed = swimSpeedForLungeTicks(auth.lungeTicks) * TICKS_PER_SECOND * frenzyMultiplier;
    const authForward = forwardFromYawPitch(auth.yaw, auth.pitch);
    const authNow: Vec3 = {
      x: auth.position.x + authForward.x * authSpeed * staleness,
      y: auth.position.y + authForward.y * authSpeed * staleness,
      z: auth.position.z + authForward.z * authSpeed * staleness,
    };
    if (world?.arenaRadius !== undefined) Object.assign(authNow, clampToCurrent(authNow, { radius: world.arenaRadius, ...world }));
    // Decay presentation independently of simulation reconciliation. Preserve ordinary
    // movement while cancelling only the correction applied on this frame.
    const decay = Math.pow(0.5, Math.max(0, dt) / VISUAL_HALF_LIFE);
    this.visualOffset.x *= decay;
    this.visualOffset.y *= decay;
    this.visualOffset.z *= decay;
    const beforeCorrection = { ...next };
    const error = distance3(authNow, next);
    if (error > TELEPORT_ERROR) {
      this.seed(auth);
      this.preserveVisualPosition(beforeCorrection, error);
      return this.build();
    }
    if (error > 0.001) {
      const eased = 1 - Math.exp(-RECONCILE_PER_SECOND * frameStep);
      const correction = Math.min(eased, MAX_RECONCILE_SPEED * frameStep / error);
      next.x += (authNow.x - next.x) * correction;
      next.y += (authNow.y - next.y) * correction;
      next.z += (authNow.z - next.z) * correction;
    }

    this.head = world?.arenaRadius === undefined ? next : clampToCurrent(next, { radius: world.arenaRadius, ...world });
    this.preserveVisualPosition(beforeCorrection, error);
    return this.build();
  }

  /** Shared presentation position for the local mesh, labels and camera target. */
  renderPosition(): Vec3 {
    const position = {
      x: this.head.x + this.visualOffset.x,
      y: this.head.y + this.visualOffset.y,
      z: this.head.z + this.visualOffset.z,
    };
    return this.ocean ? clampToCurrent(position, this.ocean) : position;
  }

  private preserveVisualPosition(before: Vec3, error: number): void {
    if (error > MAX_VISUAL_ERROR) {
      this.visualOffset = { x: 0, y: 0, z: 0 };
      return;
    }
    this.visualOffset.x += before.x - this.head.x;
    this.visualOffset.y += before.y - this.head.y;
    this.visualOffset.z += before.z - this.head.z;
  }

  private build(): PredictionResult {
    return { position: this.head, yaw: this.yaw, pitch: this.pitch };
  }
}
