import type { Keybinds } from "../settings/SettingsContext.js";
import { CAMERA_LOOK_LIMITS, clampCameraLookOffsets } from "./sceneMath.js";

export interface DesktopAxes {
  yaw: number;
  pitch: number;
  lookYaw: number;
  lookPitch: number;
}

export interface CameraLook {
  yaw: number;
  pitch: number;
}

export const CAMERA_LOOK_RATES = {
  yaw: 1.9,
  pitch: 1.45,
  recenter: 5.5,
  pointerFollow: 10,
} as const;

function axis(positive: boolean, negative: boolean): number {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

export function desktopAxesForPressed(
  pressed: ReadonlySet<string>,
  binds: Keybinds,
  turnAssist = false,
  invertSteer = false,
): DesktopAxes {
  const assist = turnAssist ? 0.6 : 1;
  const yawDirection = invertSteer ? -1 : 1;
  return {
    yaw: axis(pressed.has(binds.yawRight), pressed.has(binds.yawLeft)) * assist * yawDirection,
    pitch: axis(pressed.has(binds.pitchUp), pressed.has(binds.pitchDown)) * assist,
    lookYaw: axis(pressed.has(binds.lookRight), pressed.has(binds.lookLeft)),
    // Negative camera pitch raises the chase camera, matching "look up" on screen.
    lookPitch: axis(pressed.has(binds.lookDown), pressed.has(binds.lookUp)),
  };
}

export function cameraLookFromPointer(
  dx: number,
  dy: number,
  width: number,
  height: number,
): CameraLook | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) < 18) return { yaw: 0, pitch: 0 };
  const xRange = Math.max(80, Math.abs(width) * 0.32);
  const yRange = Math.max(80, Math.abs(height) * 0.32);
  return clampCameraLookOffsets(
    (dx / xRange) * CAMERA_LOOK_LIMITS.yaw,
    (dy / yRange) * CAMERA_LOOK_LIMITS.pitch,
  );
}

export function advanceCameraLookOffsets(
  current: CameraLook,
  axes: Pick<DesktopAxes, "lookYaw" | "lookPitch">,
  dt: number,
  pointerTarget: CameraLook | null = null,
): CameraLook {
  const frameStep = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  const keyboardActive = axes.lookYaw !== 0 || axes.lookPitch !== 0;
  if (keyboardActive) {
    return clampCameraLookOffsets(
      current.yaw + axes.lookYaw * CAMERA_LOOK_RATES.yaw * frameStep,
      current.pitch + axes.lookPitch * CAMERA_LOOK_RATES.pitch * frameStep,
    );
  }

  const target = pointerTarget ?? { yaw: 0, pitch: 0 };
  const response = pointerTarget ? CAMERA_LOOK_RATES.pointerFollow : CAMERA_LOOK_RATES.recenter;
  const blend = 1 - Math.exp(-response * frameStep);
  return clampCameraLookOffsets(
    current.yaw + (target.yaw - current.yaw) * blend,
    current.pitch + (target.pitch - current.pitch) * blend,
  );
}

/** Linear keyboard attack/release ramps, independent of the camera-look keys. */
export function advanceKeyboardSteering(
  current: Pick<DesktopAxes, "yaw" | "pitch">,
  target: Pick<DesktopAxes, "yaw" | "pitch">,
  dt: number,
): Pick<DesktopAxes, "yaw" | "pitch"> {
  const step = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  const advance = (value: number, goal: number) => {
    const duration = goal === 0 ? 0.08 : 0.12;
    const delta = goal - value;
    return value + Math.sign(delta) * Math.min(Math.abs(delta), step / duration);
  };
  return { yaw: advance(current.yaw, target.yaw), pitch: advance(current.pitch, target.pitch) };
}

/** Level idle flight intent without changing server-owned orientation. */
export function autoLevelPitch(pitch: number, pitchAxis: number, dt: number, enabled: boolean): number {
  if (!enabled || pitchAxis !== 0) return pitch;
  const step = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  return Math.sign(pitch) * Math.max(0, Math.abs(pitch) - 1.2 * step);
}
