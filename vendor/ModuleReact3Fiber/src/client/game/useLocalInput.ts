// Local input for the shared full-3D flight model.
//
// Desktop owns WASD pitch/yaw plus an independent arrow-key camera-look cluster.
// Mouse movement is an optional mirror for camera look only; it never authors shark
// orientation. Mobile reads the same flight/look semantics from the twin-stick contract.

import { useEffect, useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";
import {
  advanceCameraLookOffsets,
  cameraLookFromPointer,
  desktopAxesForPressed,
  type CameraLook,
} from "./desktopControls.js";
import { applyCameraRelativeSteering } from "./sceneMath.js";
import {
  releaseAllTouchInput,
  touchAxesForState,
  type TwinStickState,
} from "./mobileControls.js";

/** The player's live intent, read by prediction and the presentation camera. */
export interface LocalInput {
  targetYaw: number;
  targetPitch: number;
  boosting: boolean;
  cameraLookYaw: number;
  cameraLookPitch: number;
}

function eventCode(e: KeyboardEvent): string {
  return e.code === "Space" ? "Space" : e.code;
}

function interactive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest("button, a, input, select, textarea, [contenteditable='true'], [role='button'], [role='dialog']"),
  );
}

export function useLocalInput(
  socket: RoomSocket,
  settings: Settings,
  enabled: boolean,
  inputRef?: React.MutableRefObject<LocalInput>,
  surfaceRef?: React.RefObject<HTMLElement | null>,
  touchInputRef?: React.MutableRefObject<TwinStickState>,
  touchControls = false,
): void {
  const { stateRef, youId, setOrientation, setBoost, rocket } = socket;
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const boostRef = useRef(false);
  const pressed = useRef<Set<string>>(new Set());
  const pointerLook = useRef<CameraLook | null>(null);
  const cameraLook = useRef<CameraLook>({ yaw: 0, pitch: 0 });
  const orientationInitialized = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const syncInput = () => {
      if (!inputRef) return;
      inputRef.current = {
        targetYaw: yawRef.current,
        targetPitch: pitchRef.current,
        boosting: boostRef.current,
        cameraLookYaw: cameraLook.current.yaw,
        cameraLookPitch: cameraLook.current.pitch,
      };
    };
    const releaseActiveInput = () => {
      pressed.current.clear();
      pointerLook.current = null;
      cameraLook.current = { yaw: 0, pitch: 0 };
      boostRef.current = false;
      releaseAllTouchInput(touchInputRef?.current);
      syncInput();
      setBoost(false);
    };

    if (!enabled) {
      releaseActiveInput();
      orientationInitialized.current = false;
      return;
    }

    const binds = () => settingsRef.current.controls.keybinds;
    const onKeyDown = (e: KeyboardEvent) => {
      if (interactive(e.target)) return;
      const code = eventCode(e);
      const b = binds();
      const gameplayCodes = [
        b.pitchUp, b.pitchDown, b.yawLeft, b.yawRight,
        b.lookUp, b.lookDown, b.lookLeft, b.lookRight,
        b.boost, b.bite,
      ];
      if (!gameplayCodes.includes(code)) return;
      e.preventDefault();
      pressed.current.add(code);
      if ([b.lookUp, b.lookDown, b.lookLeft, b.lookRight].includes(code)) pointerLook.current = null;
      if (code === b.boost && !e.repeat) {
        boostRef.current = true;
        syncInput();
        setBoost(true);
      }
      if (code === b.bite && !e.repeat) rocket();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const code = eventCode(e);
      pressed.current.delete(code);
      if (code === binds().boost) {
        boostRef.current = false;
        syncInput();
        setBoost(false);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || interactive(e.target)) return;
      const rect = surfaceRef?.current?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      pointerLook.current = cameraLookFromPointer(
        e.clientX - cx,
        e.clientY - cy,
        rect?.width ?? window.innerWidth,
        rect?.height ?? window.innerHeight,
      );
    };
    const clearPointerLook = (e: PointerEvent) => {
      if (e.pointerType === "mouse") pointerLook.current = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseActiveInput();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (interactive(e.target)) releaseActiveInput();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseActiveInput);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusin", onFocusIn);
    const surface = surfaceRef?.current;
    surface?.addEventListener("pointermove", onPointerMove);
    surface?.addEventListener("pointerleave", clearPointerLook);
    surface?.addEventListener("pointercancel", clearPointerLook);
    surface?.addEventListener("lostpointercapture", clearPointerLook);

    let raf = 0;
    let previousFrameAt = performance.now();
    const loop = (frameAt: number) => {
      const controls = settingsRef.current.controls;
      const dt = Math.min(0.05, Math.max(0, (frameAt - previousFrameAt) / 1000));
      previousFrameAt = frameAt;

      if (!orientationInitialized.current) {
        const me = stateRef.current?.snakes.find((snake) => snake.id === youId);
        if (me) {
          yawRef.current = me.yaw;
          pitchRef.current = me.pitch;
          orientationInitialized.current = true;
        }
      }

      const desktop = desktopAxesForPressed(
        pressed.current,
        controls.keybinds,
        controls.turnAssist,
        controls.invertSteer,
      );
      const touch = touchControls && touchInputRef
        ? touchAxesForState(touchInputRef.current, controls.turnAssist, controls.invertSteer)
        : { yaw: 0, pitch: 0, lookYaw: 0, lookPitch: 0 };
      const axes = {
        yaw: clampAxis(desktop.yaw + touch.yaw),
        pitch: clampAxis(desktop.pitch + touch.pitch),
        lookYaw: clampAxis(desktop.lookYaw + touch.lookYaw),
        lookPitch: clampAxis(desktop.lookPitch + touch.lookPitch),
      };

      const steered = applyCameraRelativeSteering(
        yawRef.current,
        pitchRef.current,
        axes.yaw,
        axes.pitch,
        dt,
      );
      yawRef.current = steered.yaw;
      pitchRef.current = steered.pitch;
      const touchLookActive = touchControls && touchInputRef?.current.look.pointerId !== null;
      cameraLook.current = advanceCameraLookOffsets(
        cameraLook.current,
        axes,
        dt,
        touchLookActive ? null : pointerLook.current,
      );

      setOrientation(yawRef.current, pitchRef.current);
      syncInput();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseActiveInput);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusin", onFocusIn);
      surface?.removeEventListener("pointermove", onPointerMove);
      surface?.removeEventListener("pointerleave", clearPointerLook);
      surface?.removeEventListener("pointercancel", clearPointerLook);
      surface?.removeEventListener("lostpointercapture", clearPointerLook);
      releaseActiveInput();
    };
  }, [enabled, stateRef, youId, setOrientation, setBoost, rocket, surfaceRef, inputRef, touchInputRef, touchControls]);
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
