import { BiteBuffer } from "../src/game/game/biteBuffer.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TouchControls } from "../src/game/ui/TouchControls.js";
import { DEFAULT_SETTINGS } from "../src/game/settings/SettingsContext.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beginStickPointer,
  canUseAbilityPointer,
  endStickPointer,
  makeTwinStickState,
  moveStickPointer,
  radialStickVector,
  releaseAllTouchInput,
  simpleTouchPitch,
  touchAxesForState,
  touchLayoutForFlightSide,
  touchNeedsLandscape,
} from "../src/game/game/mobileControls.js";
import { advanceCameraLookOffsets } from "../src/game/game/desktopControls.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-117 dual-stick mobile controls", () => {
  it("tracks two independent captured stick pointers and releases each independently", () => {
    const state = makeTwinStickState();
    expect(beginStickPointer(state, "flight", 11)).toBe(true);
    expect(beginStickPointer(state, "look", 22)).toBe(true);
    expect(beginStickPointer(state, "look", 11)).toBe(false);

    expect(moveStickPointer(state, "flight", 11, 56, -28)).not.toBeNull();
    expect(moveStickPointer(state, "look", 22, -28, 56)).not.toBeNull();
    expect(state.flight.pointerId).toBe(11);
    expect(state.look.pointerId).toBe(22);
    expect(state.flight.x).toBeGreaterThan(0);
    expect(state.look.x).toBeLessThan(0);

    expect(endStickPointer(state, "flight", 99)).toBe(false);
    expect(endStickPointer(state, "flight", 11)).toBe(true);
    expect(state.flight).toEqual({ pointerId: null, x: 0, y: 0 });
    expect(state.look.pointerId).toBe(22);
  });

  it("supports both sticks plus independent ability pointers", () => {
    const state = makeTwinStickState();
    beginStickPointer(state, "flight", 1);
    beginStickPointer(state, "look", 2);
    expect(canUseAbilityPointer(state, 1)).toBe(false);
    expect(canUseAbilityPointer(state, 2)).toBe(false);
    expect(canUseAbilityPointer(state, 3)).toBe(true);
    expect(canUseAbilityPointer(state, 4)).toBe(true);
  });

  it("uses a radial dead zone, normalized bounds, and intentional response curve", () => {
    expect(radialStickVector(2, 2)).toEqual({ x: 0, y: 0 });
    const half = radialStickVector(28, 0);
    expect(half.x).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(0.5);
    const outside = radialStickVector(500, 500);
    expect(Math.hypot(outside.x, outside.y)).toBeCloseTo(1, 8);
    expect(Math.abs(outside.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(outside.y)).toBeLessThanOrEqual(1);
  });

  it("maps flight to authoritative pitch/yaw and look to camera-only axes", () => {
    const state = makeTwinStickState();
    state.flight = { pointerId: 1, x: 0.8, y: -0.5 };
    state.look = { pointerId: 2, x: -0.6, y: 0.4 };
    expect(touchAxesForState(state)).toEqual({
      yaw: 0.8,
      pitch: 0.5,
      lookYaw: -0.6,
      lookPitch: 0.4,
    });
    expect(touchAxesForState(state, true, true)).toEqual({
      yaw: -0.48,
      pitch: 0.3,
      lookYaw: -0.6,
      lookPitch: 0.4,
    });
  });

  it("recenters camera look smoothly after the look stick releases", () => {
    let look = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 30; i += 1) {
      look = advanceCameraLookOffsets(look, { lookYaw: 0.8, lookPitch: -0.4 }, 1 / 60);
    }
    const before = Math.hypot(look.yaw, look.pitch);
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 90; i += 1) {
      look = advanceCameraLookOffsets(look, { lookYaw: 0, lookPitch: 0 }, 1 / 60);
    }
    expect(Math.hypot(look.yaw, look.pitch)).toBeLessThan(before * 0.01);
  });

  it("clears stale touch state on cancellation-style cleanup", () => {
    const state = makeTwinStickState();
    beginStickPointer(state, "flight", 3);
    beginStickPointer(state, "look", 4);
    moveStickPointer(state, "flight", 3, 50, 20);
    moveStickPointer(state, "look", 4, -20, -50);
    releaseAllTouchInput(state);
    expect(state).toEqual({
      flight: { pointerId: null, x: 0, y: 0 },
      look: { pointerId: null, x: 0, y: 0 },
    });
  });

  it("mirrors the complete standard/left-handed layout and enforces landscape policy", () => {
    expect(touchLayoutForFlightSide("left")).toEqual({ flight: "left", look: "right", actions: "right" });
    expect(touchLayoutForFlightSide("right")).toEqual({ flight: "right", look: "left", actions: "left" });
    expect(touchNeedsLandscape(844, 390)).toBe(false);
    expect(touchNeedsLandscape(390, 844)).toBe(true);
  });

  it("wires capture, viewport cleanup, safe areas, settings modes and no legacy touch fallback", () => {
    const controls = read("../src/game/ui/TouchControls.tsx");
    const input = read("../src/game/game/useLocalInput.ts");
    const screen = read("../src/game/ui/GameScreen.tsx");
    const settings = read("../src/game/settings/SettingsContext.tsx");
    const css = read("../src/game/ui/theme.css");

    expect(controls).toContain("setPointerCapture(e.pointerId)");
    expect(controls).toContain("onLostPointerCapture={end}");
    expect(controls).toContain('window.addEventListener("orientationchange", release)');
    expect(controls).toContain("window.visualViewport?.addEventListener");
    expect(controls).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(controls).not.toContain("angle: Math.atan2");
    expect(controls).not.toContain("onClick");

    expect(input).toContain("aimAssistEnabled(controls.aimAssist, touchControls)");
    expect(input).toContain("assistAim(");
    expect(settings).toContain("aimAssist: null");
    expect(input).toContain("touchAxesForState");
    expect(input).toContain("applyCameraRelativeSteering");
    expect(input).toContain("advanceCameraLookOffsets");
    expect(input).toContain("releaseAllTouchInput");
    expect(screen).toContain("canUseAbilityPointer");
    expect(screen).toContain("onPointerCancel");
    expect(screen).toContain("portraitLocked");
    expect(settings).toContain('touchControls: "auto"');
    expect(settings).toContain('touchControls: "auto" | "on" | "off"');

    for (const inset of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`env(safe-area-inset-${inset}`);
    }
    expect(css).toContain(".game-screen--flight-left");
    expect(css).toContain(".game-screen--flight-right");
    expect(css).toContain(".touch-rotate-affordance");
    expect(css).not.toContain(".game-screen { touch-action: none; }");
  });
});


describe("Simple touch steering", () => {
  it("renders one flight stick in Simple and both mirrored sticks in Advanced", () => {
    expect(DEFAULT_SETTINGS.controls.touchScheme).toBe("simple");
    for (const flightSide of ["left", "right"] as const) {
      const inputRef = { current: makeTwinStickState() };
      const simple = renderToStaticMarkup(createElement(TouchControls, { inputRef, flightSide, scheme: "simple", enabled: true, portraitLocked: false }));
      const dual = renderToStaticMarkup(createElement(TouchControls, { inputRef, flightSide, scheme: "dual", enabled: true, portraitLocked: false }));
      expect(simple).toContain(`touch-stick-zone--${flightSide} touch-stick-zone--flight`);
      expect(simple).not.toContain("touch-stick-zone--look");
      expect(dual).toContain("touch-stick-zone--look");
      expect(dual).toContain("Release to recenter");
    }
  });
  it("defaults to Simple and exposes a live advanced choice", () => {
    expect(read("../src/game/settings/SettingsContext.tsx")).toContain('touchScheme: "simple"');
    expect(read("../src/game/ui/Settings.tsx")).toContain('update("controls", { touchScheme: v })');
    const controls = read("../src/game/ui/TouchControls.tsx");
    expect(controls).toContain('scheme === "dual" && <TouchStick');
    expect(controls).toContain('key={`${scheme}-${flightSide}`}');
    expect(controls).toContain('floating ? e.clientX - rect.left');
    expect(read("../src/game/game/useLocalInput.ts")).toContain('simpleTouch || touchLookActive ? null : pointerLook.current');
  });
  it("preserves flight intent and suppresses stale look in Simple, retaining Dual look", () => {
    const state = makeTwinStickState();
    state.flight = { pointerId: 1, x: 0.8, y: -0.5 };
    state.look = { pointerId: 2, x: -0.6, y: 0.4 };
    expect(touchAxesForState(state, false, false, "simple")).toEqual({ yaw: 0.8, pitch: 0.5, lookYaw: 0, lookPitch: 0 });
    expect(touchAxesForState(state, false, false, "dual").lookYaw).toBe(-0.6);
    releaseAllTouchInput(state);
    expect(canUseAbilityPointer(state, 2)).toBe(true);
  });
});

describe("Simple target pitch", () => {
  it("maps up/down proportionally to bounded angles without accumulating", () => {
    expect(simpleTouchPitch(-1)).toBe(0.85);
    expect(simpleTouchPitch(1)).toBe(-0.85);
    expect(simpleTouchPitch(-0.5)).toBe(0.425);
    expect(simpleTouchPitch(5)).toBe(-0.85);
    expect(simpleTouchPitch(-5)).toBe(0.85);
    for (let frame = 0; frame < 120; frame += 1) expect(simpleTouchPitch(-0.5)).toBe(0.425);
    expect(simpleTouchPitch(NaN)).toBeCloseTo(0);
  });
  it("levels on pointer release and cleanup while preserving yaw rate and Dual axes", () => {
    const state = makeTwinStickState();
    beginStickPointer(state, "flight", 1);
    moveStickPointer(state, "flight", 1, 28, -40);
    expect(simpleTouchPitch(state.flight.y)).toBeGreaterThan(0);
    expect(touchAxesForState(state, false, false, "simple").yaw).toBe(state.flight.x);
    endStickPointer(state, "flight", 1);
    expect(simpleTouchPitch(state.flight.y)).toBeCloseTo(0);
    beginStickPointer(state, "flight", 2);
    moveStickPointer(state, "flight", 2, 0, 56);
    releaseAllTouchInput(state);
    expect(simpleTouchPitch(state.flight.y)).toBeCloseTo(0);
    const input = read("../src/game/game/useLocalInput.ts");
    expect(input).toContain('controls.touchScheme === "simple"');
    expect(input).toContain("simplePitch ? 0 : axes.pitch");
    expect(input).toContain("simpleTouchPitch(touchInputRef.current.flight.y)");
  });
});

// Authoritative tick readiness, a bounded single slot, and lifecycle cancellation.
describe("bite intent buffer", () => {
  it("buffers only the final 200 ms and consumes exactly once", () => {
    const buffer = new BiteBuffer();
    expect(buffer.press(0, 201)).toBe(false);
    expect(buffer.consume(201, 0)).toBe(false);
    expect(buffer.press(300, 200)).toBe(false);
    expect(buffer.press(310, 100)).toBe(false);
    expect(buffer.consume(400, 50)).toBe(false);
    expect(buffer.consume(500, 0)).toBe(true);
    expect(buffer.consume(501, 0)).toBe(false);
    expect(buffer.press(600, 0)).toBe(true);
  });
  it("drops stale and cancelled presses", () => {
    const buffer = new BiteBuffer();
    buffer.press(0, 100);
    expect(buffer.consume(301, 0)).toBe(false);
    buffer.press(400, 100);
    buffer.clear();
    expect(buffer.consume(500, 0)).toBe(false);
  });
  it("keeps the arc below the HUD and board at the acceptance sizes", () => {
    const css = read("../src/game/ui/theme.css");
    expect(css).toContain("bottom:calc(144px + var(--safe-b))");
    expect(css).toContain("max-height:calc(100dvh - 244px)");
    expect(css).toContain("width:88px;height:88px;min-height:88px");
    for (const [width, height] of [[740,360],[844,390]]) {
      // Advanced is the highest arc. Its upper Dash is inward of the HUD;
      // the outer Bite starts below the HUD. Dash is inward of the board.
      const arcTop = height - 144 - 172;
      const dashInnerEdge = width - 12 - 204;
      expect(arcTop + 84).toBeGreaterThan(96);
      expect(height - 244 + 6).toBeLessThan(arcTop + 84);
      expect(dashInnerEdge + 72).toBeLessThan(width - 12 - 124);
      expect(dashInnerEdge).toBeGreaterThan(width * .56);
    }
  });
});
