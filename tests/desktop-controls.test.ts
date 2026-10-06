import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEYBINDS,
  normalizeKeybinds,
  rebindKeybinds,
} from "../src/game/settings/SettingsContext.js";
import {
  advanceCameraLookOffsets,
  cameraLookFromPointer,
  desktopAxesForPressed,
} from "../src/game/game/desktopControls.js";
import {
  CAMERA_LOOK_LIMITS,
  chaseCameraPose,
  makeChaseCameraPose,
} from "../src/game/game/sceneMath.js";

describe("ST-116 desktop full-3D controls", () => {
  it("ships a complete conflict-free keyboard-first default map", () => {
    expect(DEFAULT_KEYBINDS).toEqual({
      pitchUp: "KeyW",
      pitchDown: "KeyS",
      yawLeft: "KeyA",
      yawRight: "KeyD",
      lookUp: "ArrowUp",
      lookDown: "ArrowDown",
      lookLeft: "ArrowLeft",
      lookRight: "ArrowRight",
      boost: "Space",
      bite: "KeyF",
      pause: "Escape",
    });
    const values = Object.values(DEFAULT_KEYBINDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("keeps flight and camera-look clusters independent under simultaneous input", () => {
    const pressed = new Set(["KeyW", "KeyD", "ArrowUp", "ArrowLeft"]);
    expect(desktopAxesForPressed(pressed, DEFAULT_KEYBINDS)).toEqual({
      yaw: 1,
      pitch: 1,
      lookYaw: -1,
      lookPitch: -1,
    });
    const assisted = desktopAxesForPressed(new Set(["KeyA", "KeyS"]), DEFAULT_KEYBINDS, true, true);
    expect(assisted.yaw).toBe(0.6);
    expect(assisted.pitch).toBe(-0.6);
    expect(assisted.lookYaw).toBe(0);
  });

  it("advances bounded camera look frame-rate independently and recenters smoothly", () => {
    const axes = { lookYaw: 0.5, lookPitch: -0.25 };
    let sixty = { yaw: 0, pitch: 0 };
    let thirty = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 12; i += 1) sixty = advanceCameraLookOffsets(sixty, axes, 1 / 60);
    for (let i = 0; i < 6; i += 1) thirty = advanceCameraLookOffsets(thirty, axes, 1 / 30);
    expect(sixty.yaw).toBeCloseTo(thirty.yaw, 8);
    expect(sixty.pitch).toBeCloseTo(thirty.pitch, 8);

    let bounded = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 240; i += 1) bounded = advanceCameraLookOffsets(bounded, { lookYaw: 1, lookPitch: -1 }, 1 / 60);
    expect(Math.abs(bounded.yaw)).toBeLessThanOrEqual(CAMERA_LOOK_LIMITS.yaw);
    expect(Math.abs(bounded.pitch)).toBeLessThanOrEqual(CAMERA_LOOK_LIMITS.pitch);

    const before = Math.hypot(bounded.yaw, bounded.pitch);
    for (let i = 0; i < 120; i += 1) bounded = advanceCameraLookOffsets(bounded, { lookYaw: 0, lookPitch: 0 }, 1 / 60);
    expect(Math.hypot(bounded.yaw, bounded.pitch)).toBeLessThan(before * 0.01);
  });

  it("maps mouse movement to camera look only and preserves the shark-facing look target", () => {
    const pointer = cameraLookFromPointer(300, -160, 1000, 700);
    expect(pointer).not.toBeNull();
    expect(pointer!.yaw).toBeGreaterThan(0);
    expect(pointer!.pitch).toBeLessThan(0);

    const target = { x: 5, y: 0, z: -3 };
    const base = chaseCameraPose(target, 0.4, 0.15, makeChaseCameraPose());
    const looked = chaseCameraPose(target, 0.4, 0.15, makeChaseCameraPose(), {
      lookYawOffset: 0.8,
      lookPitchOffset: -0.3,
    });
    expect(looked.position).not.toEqual(base.position);
    expect(looked.lookAt).toEqual(base.lookAt);
  });

  it("rejects blank/conflicting remaps and repairs conflicting stored settings", () => {
    expect(rebindKeybinds(DEFAULT_KEYBINDS, "bite", "Space")).toBeNull();
    expect(rebindKeybinds(DEFAULT_KEYBINDS, "bite", "ShiftLeft")).toBeNull();
    expect(rebindKeybinds(DEFAULT_KEYBINDS, "bite", "KeyG")?.bite).toBe("KeyG");

    const repaired = normalizeKeybinds({ yawLeft: "KeyQ", yawRight: "KeyQ", pitchUp: "" });
    expect(repaired).toEqual(DEFAULT_KEYBINDS);
  });

  it("clears gameplay state across focus loss and uses a real pause dialog", () => {
    const input = readFileSync(new URL("../src/game/game/useLocalInput.ts", import.meta.url), "utf8");
    const screen = readFileSync(new URL("../src/game/ui/GameScreen.tsx", import.meta.url), "utf8");
    expect(input).toContain('window.addEventListener("blur", releaseActiveInput)');
    expect(input).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(input).toContain('document.addEventListener("focusin", onFocusIn)');
    expect(input).not.toContain('addEventListener("pointerdown"');
    expect(screen).toContain("<PauseMenu");
    expect(screen).toContain("settingsOpen || helpOpen || paused");
    expect(screen).not.toContain("else { e.preventDefault(); handleQuit(); }");
  });
});
