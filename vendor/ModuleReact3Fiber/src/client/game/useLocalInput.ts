// Local input → steering. Three fully-independent control schemes, all able to play the
// whole game (WCAG 2.1.1 keyboard operable):
//   • Pointer: the shark heads toward the cursor; click to chomp-dash.
//   • Keyboard: left/right turn keys rotate heading; Space chomp-dashes.
//   • Touch: an on-screen thumbstick sets the heading; ability pads dash and fire.
// Heading is smoothed and pushed to the socket (which throttles the wire traffic).
//
// Mouse and touch are told apart by `pointerType`, not by a device sniff, so a laptop
// with a touchscreen keeps both. That distinction matters: on touch, pointer-down must
// NOT dash — tapping the water to steer used to burn the dash on every single tap.

import { useEffect, useRef } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import type { Settings } from "../settings/SettingsContext.js";

const KEY_TURN_RATE = 3.2; // radians per second while a turn key is held
const POINTER_DEAD_ZONE = 18;

/** The player's live intent, read by client-side prediction. */
export interface LocalInput {
  targetHeading: number;
  boosting: boolean;
}

/** Live virtual-thumbstick state, written by <TouchControls/> on every pointer move. */
export interface StickState {
  /** True while a thumb is down on the stick. */
  active: boolean;
  /** Absolute heading in the X/Z plane, same convention as authoritative Snake.yaw. */
  angle: number;
}

/** Fold an angle into (-π, π] — the range the wire protocol accepts. */
function wrapAngle(angle: number): number {
  const wrapped = (angle + Math.PI) % (Math.PI * 2);
  return (wrapped < 0 ? wrapped + Math.PI * 2 : wrapped) - Math.PI;
}

/** Normalize a KeyboardEvent to the code strings we store in keybinds. */
function eventCode(e: KeyboardEvent): string {
  return e.code === "Space" ? "Space" : e.code;
}

export function useLocalInput(
  socket: RoomSocket,
  settings: Settings,
  enabled: boolean,
  inputRef?: React.MutableRefObject<LocalInput>,
  surfaceRef?: React.RefObject<HTMLElement | null>,
  stickRef?: React.MutableRefObject<StickState>,
  /** True when the on-screen thumbstick owns steering; pointer-to-steer is then
   *  restricted to a real mouse so hybrid laptops keep both schemes. */
  touchControls = false,
): void {
  const { stateRef, youId, setHeading, setBoost, rocket } = socket;
  const headingRef = useRef(0);
  const boostRef = useRef(false);
  const pressed = useRef<Set<string>>(new Set());
  const usingPointer = useRef(false);
  const headingInitialized = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!enabled) {
      pressed.current.clear();
      // A respawn receives a fresh server-selected heading. Forget the previous
      // life's pointer/keyboard direction so reopening gameplay cannot immediately
      // steer the new shark back toward the wall.
      headingInitialized.current = false;
      usingPointer.current = false;
      boostRef.current = false;
      setBoost(false);
      return;
    }

    const binds = () => settingsRef.current.controls.keybinds;
    const syncInput = () => { if (inputRef) inputRef.current = { targetHeading: headingRef.current, boosting: boostRef.current }; };
    const interactive = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest("button, a, input, select, textarea, [role='button']"));

    const onKeyDown = (e: KeyboardEvent) => {
      const code = eventCode(e);
      const b = binds();
      if (interactive(e.target)) return;
      if ((code === "ShiftLeft" || code === "ShiftRight") && !e.repeat) { e.preventDefault(); rocket(); return; }
      if ([b.left, b.right, b.boost].includes(code)) {
        e.preventDefault();
        usingPointer.current = false;
      }
      pressed.current.add(code);
      if (code === b.boost && !e.repeat) {
        boostRef.current = true;
        syncInput();
        setBoost(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const code = eventCode(e);
      if (interactive(e.target)) return;
      pressed.current.delete(code);
      if (code === binds().boost) {
        boostRef.current = false;
        syncInput();
        setBoost(false);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (touchControls && e.pointerType !== "mouse") return;
      usingPointer.current = true;
      // Cursor relative to screen center ≈ direction from the (centered) player head.
      const rect = surfaceRef?.current?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      if (Math.hypot(dx, dy) >= POINTER_DEAD_ZONE) { headingRef.current = Math.atan2(dy, dx); headingInitialized.current = true; }
    };
    const onPointerDown = (e: PointerEvent) => {
      // Touch taps steer nothing and cost nothing — the thumbstick and the dash pad own
      // touch input. Only a real mouse click still chomp-dashes.
      if (touchControls && e.pointerType !== "mouse") return;
      if (e.button === 0) {
        surfaceRef?.current?.setPointerCapture(e.pointerId);
        surfaceRef?.current?.focus({ preventScroll: true });
        boostRef.current = true;
        syncInput();
        setBoost(true);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (touchControls && e.pointerType !== "mouse") return;
      if (e.button === 0) {
        boostRef.current = false;
        syncInput();
        setBoost(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const surface = surfaceRef?.current;
    surface?.addEventListener("pointermove", onPointerMove);
    surface?.addEventListener("pointerdown", onPointerDown);
    surface?.addEventListener("pointerup", onPointerUp);
    surface?.addEventListener("pointercancel", onPointerUp);

    let raf = 0, previousFrameAt = performance.now();
    const loop = (frameAt: number) => {
      const s = settingsRef.current.controls;
      const b = s.keybinds;
      const assist = s.turnAssist ? 0.6 : 1;
      const dir = s.invertSteer ? -1 : 1;
      if (!headingInitialized.current) {
        const me = stateRef.current?.snakes.find((snake) => snake.id === youId);
        if (me) { headingRef.current = me.yaw; headingInitialized.current = true; }
      }
      const dt = Math.min(.05, (frameAt - previousFrameAt) / 1000); previousFrameAt = frameAt;
      const stick = stickRef?.current;
      if (stick?.active) {
        // The stick is an absolute heading, so it wins outright over the incremental
        // turn keys while a thumb is down. Releasing holds the last heading.
        headingRef.current = s.invertSteer ? stick.angle + Math.PI : stick.angle;
        headingInitialized.current = true;
        usingPointer.current = false;
      }
      if (pressed.current.has(b.left)) headingRef.current -= KEY_TURN_RATE * dt * assist * dir;
      if (pressed.current.has(b.right)) headingRef.current += KEY_TURN_RATE * dt * assist * dir;
      // Held turn keys accumulate without bound, and the server *clamps* an out-of-range
      // heading to ±π rather than wrapping it — so turning past half a circle used to
      // pin the shark due west. Wrap here, before anything reads or sends the angle.
      headingRef.current = wrapAngle(headingRef.current);
      setHeading(headingRef.current);
      syncInput();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      surface?.removeEventListener("pointermove", onPointerMove);
      surface?.removeEventListener("pointerdown", onPointerDown);
      surface?.removeEventListener("pointerup", onPointerUp);
      surface?.removeEventListener("pointercancel", onPointerUp);
      setBoost(false);
    };
  }, [enabled, stateRef, youId, setHeading, setBoost, rocket, surfaceRef, inputRef, stickRef, touchControls]);
}
