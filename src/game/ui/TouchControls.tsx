// First-class twin-stick mobile controls.
//
// The flight and look sticks each own an independent captured pointer. They write into a
// mutable ref so render-frame input never depends on React state, while the SVG feedback
// remains declarative. Viewport changes release active gestures so floating geometry is
// always recomputed from the current safe layout instead of retaining stale pixel centers.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TOUCH_STICK,
  beginStickPointer,
  endStickPointer,
  moveStickPointer,
  releaseAllTouchInput,
  touchLayoutForFlightSide,
  touchNeedsLandscape,
  type TouchSide,
  type TouchStickKind,
  type TwinStickState,
} from "../game/mobileControls.js";
import type { Settings } from "../settings/SettingsContext.js";

const BASE_RADIUS = 66;

export function useTouchControls(settings: Settings): boolean {
  const mode = settings.controls.touchControls;
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return coarse;
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function useTouchPortraitLock(active: boolean): boolean {
  const [locked, setLocked] = useState(() => {
    const size = viewportSize();
    return active && touchNeedsLandscape(size.width, size.height);
  });

  useEffect(() => {
    const sync = () => {
      const size = viewportSize();
      setLocked(active && touchNeedsLandscape(size.width, size.height));
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, [active]);

  return locked;
}

export interface TouchControlsProps {
  inputRef: React.MutableRefObject<TwinStickState>;
  flightSide: TouchSide;
  enabled: boolean;
  portraitLocked: boolean;
}

export function TouchControls({
  inputRef,
  flightSide,
  enabled,
  portraitLocked,
}: TouchControlsProps) {
  const layout = touchLayoutForFlightSide(flightSide);

  useEffect(() => {
    if (!enabled || portraitLocked) releaseAllTouchInput(inputRef.current);
  }, [enabled, portraitLocked, inputRef]);
  useEffect(() => () => releaseAllTouchInput(inputRef.current), [inputRef]);

  if (!enabled) return null;
  if (portraitLocked) {
    return (
      <div className="touch-rotate-affordance" role="status" aria-live="polite">
        <div className="touch-rotate-card">
          <strong>Rotate to landscape</strong>
          <span>Twin-stick play needs more horizontal room. Menus and navigation remain available.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="touch-control-surface" aria-label="Touch gameplay controls">
      <TouchStick inputRef={inputRef} kind="flight" side={layout.flight} enabled={enabled} />
      <TouchStick inputRef={inputRef} kind="look" side={layout.look} enabled={enabled} />
    </div>
  );
}

function TouchStick({
  inputRef,
  kind,
  side,
  enabled,
}: {
  inputRef: React.MutableRefObject<TwinStickState>;
  kind: TouchStickKind;
  side: TouchSide;
  enabled: boolean;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [base, setBase] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const release = useCallback(() => {
    const id = pointerId.current;
    if (id !== null) endStickPointer(inputRef.current, kind, id);
    pointerId.current = null;
    setBase(null);
    setKnob({ x: 0, y: 0 });
  }, [inputRef, kind]);

  useEffect(() => {
    if (!enabled) release();
  }, [enabled, release]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release);
    window.addEventListener("resize", release);
    window.addEventListener("orientationchange", release);
    window.visualViewport?.addEventListener("resize", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      window.removeEventListener("resize", release);
      window.removeEventListener("orientationchange", release);
      window.visualViewport?.removeEventListener("resize", release);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [release]);

  if (!enabled) return null;

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== null || !beginStickPointer(inputRef.current, kind, e.pointerId)) return;
    const rect = zoneRef.current?.getBoundingClientRect();
    if (!rect) {
      endStickPointer(inputRef.current, kind, e.pointerId);
      return;
    }
    e.preventDefault();
    pointerId.current = e.pointerId;
    try { zoneRef.current?.setPointerCapture(e.pointerId); } catch { /* pointer ended */ }
    const pad = BASE_RADIUS + 6;
    const x = clamp(e.clientX - rect.left, pad, rect.width - pad);
    const y = clamp(e.clientY - rect.top, pad, rect.height - pad);
    setBase({ x, y });
    setKnob({ x: 0, y: 0 });
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerId.current || !base) return;
    const rect = zoneRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const dx = e.clientX - rect.left - base.x;
    const dy = e.clientY - rect.top - base.y;
    const vector = moveStickPointer(inputRef.current, kind, e.pointerId, dx, dy);
    if (!vector) return;
    setKnob({ x: vector.x * TOUCH_STICK.radius, y: vector.y * TOUCH_STICK.radius });
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerId.current) return;
    e.preventDefault();
    release();
  };

  const label = kind === "flight"
    ? "Flight stick. Drag up or down to pitch and left or right to yaw."
    : "Camera look stick. Drag to look around. Release to recenter behind the shark.";
  const hint = kind === "flight" ? "FLIGHT" : "LOOK";

  return (
    <div
      ref={zoneRef}
      className={`touch-stick-zone touch-stick-zone--${side} touch-stick-zone--${kind}`}
      role="img"
      aria-label={label}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {base ? (
        <svg className="stick-visual" width="100%" height="100%" aria-hidden="true">
          <defs>
            <radialGradient id={`stick-knob-gradient-${kind}`} cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#8ff4ff" />
              <stop offset="1" stopColor="#22a8d8" />
            </radialGradient>
          </defs>
          <g transform={`translate(${base.x} ${base.y})`}>
            <circle className="stick-live-base" cx="0" cy="0" r={BASE_RADIUS} />
            <circle
              className="stick-live-knob"
              cx={knob.x}
              cy={knob.y}
              r="30"
              fill={`url(#stick-knob-gradient-${kind})`}
            />
          </g>
        </svg>
      ) : (
        <div className="stick-base"><div className="stick-knob" /></div>
      )}
      {!base && <p className="stick-hint">{hint}</p>}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}
