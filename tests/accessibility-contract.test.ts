import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoom,
  ROOM_SCHEMA_VERSION,
  step,
} from "../src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";
import { DEFAULT_KEYBINDS } from "../src/game/settings/SettingsContext.js";
import { desktopAxesForPressed } from "../src/game/game/desktopControls.js";
import {
  CAMERA_PROJECTION,
  advanceBankRoll,
  cameraFovForSpeed,
  chaseCameraPose,
  makeChaseCameraPose,
  smoothChaseCameraPose,
} from "../src/game/game/sceneMath.js";
import { resolveSharkAnimation } from "../src/game/game/sharkPresentation.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const worker = read("../src/worker/index.ts");
const routes = read("../src/worker/routes.ts");
const app = read("../src/game/App.tsx");
const focusTrap = read("../src/game/a11y/useFocusTrap.ts");
const input = read("../src/game/game/useLocalInput.ts");
const theme = read("../src/game/ui/theme.css");
const settings = read("../src/game/ui/Settings.tsx");
const protocol = read("../src/protocol/index.ts");
const gameViewport = read("../src/game/game/GameViewport.tsx");
const gameScreen = read("../src/game/ui/GameScreen.tsx");
const help = read("../src/game/ui/HelpOverlay.tsx");
const death = read("../src/game/ui/DeathOverlay.tsx");
const quickA11y = read("../src/game/ui/QuickA11y.tsx");
const touchControls = read("../src/game/ui/TouchControls.tsx");
const leaderboard = read("../src/game/ui/Leaderboard.tsx");
const depthRadar = read("../src/game/ui/DepthRadar.tsx");
const sharkLabels = read("../src/game/ui/SharkLabels.tsx");
const edibility = read("../src/game/ui/edibility.ts");
const captions = read("../src/game/ui/Captions.tsx");
const gameAudio = read("../src/game/audio/useGameAudio.ts");
const cameraRig = read("../src/game/game/CameraRig.tsx");
const actorLayer = read("../src/game/game/ActorLayer.tsx");
const fxLayer = read("../src/game/game/FxLayer.tsx");
const worldEnvironment = read("../src/game/game/WorldEnvironment.tsx");

describe("public accessibility contract", () => {
  it("retires public evidence and operator routes while preserving the game accessibility surface", () => {
    expect(worker).toContain('if (path === "/" || path === "/play") return movedTo(url, "/play/");');
    expect(worker).not.toContain('if (path === "/evidence/")');
    expect(worker).not.toContain('renderOverviewDocument');
    expect(worker).not.toContain('renderNotFoundDocument');
  });

  it("keeps the game operable by keyboard with managed focus and reduced motion", () => {
    expect(app).toContain('className="skip-link" href="#main"');
    expect(app).toContain("regionRef.current?.focus()");
    expect(input).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(input).toContain("preventDefault()");
    expect(focusTrap).toContain('document.addEventListener("keydown", onKeyDown)');
    expect(focusTrap).toContain("last.focus()");
    expect(focusTrap).toContain("first.focus()");
    expect(focusTrap).toContain("previouslyFocused?.focus?.()");
    expect(theme).toContain("@media (prefers-reduced-motion: reduce)");
    expect(theme).toContain(":focus-visible");
    expect(settings).toContain('formatValue={(value) => `${Math.round(value * 100)}%`}');
  });
});

describe("full-3D accessibility re-proof", () => {
  it("keeps a complete keyboard-only path through one authoritative round loop", () => {
    const flight = desktopAxesForPressed(
      new Set([DEFAULT_KEYBINDS.pitchUp, DEFAULT_KEYBINDS.yawRight, DEFAULT_KEYBINDS.lookLeft]),
      DEFAULT_KEYBINDS,
    );
    expect(flight).toMatchObject({ pitch: 1, yaw: 1, lookYaw: -1 });

    const state = createRoom({ id: "st-128-keyboard", seed: "st-128-keyboard" });
    applyAction(state, { type: "join", playerId: "pilot", name: "Pilot" });
    applyAction(state, {
      type: "setOrientation",
      playerId: "pilot",
      yaw: flight.yaw * 0.35,
      pitch: flight.pitch * 0.25,
    });
    applyAction(state, { type: "setBoost", playerId: "pilot", on: true });
    applyAction(state, { type: "bite", playerId: "pilot" });
    expect(state.sharks.pilot.targetYaw).toBeCloseTo(0.35);
    expect(state.sharks.pilot.targetPitch).toBeCloseTo(0.25);

    state.tick = state.round.apexStartTick - 1;
    step(state);
    expect(state.round.phase).toBe("apex");
    state.tick = state.round.endTick - 1;
    step(state);
    expect(state.round.phase).toBe("result");
    state.tick = state.round.resultEndTick - 1;
    step(state);
    expect(state.round).toMatchObject({ number: 2, phase: "active" });

    expect(input).toContain("b.pitchUp, b.pitchDown, b.yawLeft, b.yawRight");
    expect(input).toContain("b.lookUp, b.lookDown, b.lookLeft, b.lookRight");
    expect(input).toContain("if (code === b.boost && !e.repeat)");
    expect(input).toContain("if (code === b.bite && !e.repeat) bite()");
    expect(gameScreen).toContain("settings.controls.keybinds.pause");
    expect(gameScreen).toContain("<PauseMenu");
    expect(death).toContain("respawnRef.current?.focus()");
    expect(death).toContain("Back to menu");
    expect(quickA11y).toContain('label="Exit to menu"');
    expect(quickA11y).not.toContain("Exit to menu (Escape)");
  });

  it("reduces 3D presentation motion without removing state, steering, or camera orientation", () => {
    const goal = chaseCameraPose(
      { x: 12, y: -9, z: 7 },
      0.6,
      0.24,
      makeChaseCameraPose(),
      {
        reducedMotion: true,
        lookYawOffset: 0.3,
        lookPitchOffset: -0.2,
        arenaRadius: 120,
        seabedY: -60,
        surfaceY: 20,
      },
    );
    const snapped = smoothChaseCameraPose(
      makeChaseCameraPose(),
      goal,
      1 / 60,
      true,
      makeChaseCameraPose(),
    );
    for (const axis of ["x", "y", "z"] as const) {
      expect(snapped.position[axis]).toBeCloseTo(goal.position[axis], 12);
      expect(snapped.lookAt[axis]).toBeCloseTo(goal.lookAt[axis], 12);
    }
    expect(cameraFovForSpeed(28, 11, 28, true)).toBe(CAMERA_PROJECTION.fov);
    expect(Math.abs(advanceBankRoll(0, 10, 1 / 60, true))).toBeLessThanOrEqual(0.24);
    expect(resolveSharkAnimation({
      seconds: 5,
      actorId: "pilot",
      speed: 28,
      baseSpeed: 11,
      boostSpeed: 28,
      boosting: true,
      pitch: 0.3,
      reducedMotion: true,
    })).toEqual({ bodyYaw: 0, peduncleYaw: 0, tailYaw: 0, pectoralSweep: 0, intensity: 0 });

    expect(cameraRig).toContain("smoothChaseCameraPose(current, goal, dt, reducedMotion");
    expect(actorLayer).toContain("const alpha = reducedMotion ? 1 : frame.alpha");
    expect(fxLayer).toContain("reducedMotion ? 0.35");
    expect(worldEnvironment).toContain("const t = reducedMotion ? 0 : clock.elapsedTime");
    expect(worldEnvironment).toContain("kelpSway.value = reducedMotion ? 0 : 0.28");
    expect(worldEnvironment).toContain("transformed.x += kelpSway * kelpTip * kelpTip");
    expect(gameScreen).toContain('settings.a11y.motion === "reduced"');
  });

  it("keeps meaningful 3D state in semantic DOM with correct modal and touch ownership", () => {
    expect(gameViewport).toContain('role="img"');
    expect(gameViewport).toContain("keyLabel(k.pitchUp)");
    expect(gameViewport).toContain("surrounding DOM interface");
    expect(help).toContain('label="Fly"');
    expect(help).toContain('label="Look"');
    expect(help).toContain("Up/down pitches to climb or dive");
    expect(touchControls).toContain("setPointerCapture(e.pointerId)");
    expect(touchControls).toContain('aria-label={label}');

    expect(gameScreen).toContain("useFocusTrap(ref, true, onContinue)");
    expect(gameScreen).toContain("useFocusTrap(ref, true, onBack)");
    expect(gameScreen).toContain("Tank full — you'll join when a spot opens");
    expect(gameScreen).toContain("Can't reach the tank");
    expect(gameScreen).toContain('"assertive"');
    expect(gameScreen).toContain('aria-modal="true"');
    expect(gameScreen).toContain('aria-describedby="round-result-summary round-result-next"');
    expect(gameScreen).toContain("dismissedResultRound !== roundUi.number && !dialogOpen");
    expect(theme).toContain("position: fixed; inset: 0; z-index: 200");
    expect(theme).toContain(".scrim--respawn{z-index:100");
    expect(theme).toContain(".round-result-layer{position:absolute;inset:0;z-index:200");
    expect(theme).toContain("--tap-min: 44px");
    expect(theme).toContain(".game-screen--touch .ability-button{position:absolute;width:88px;height:88px;min-height:88px");
    for (const inset of ["top", "right", "bottom", "left"]) {
      expect(theme).toContain(`env(safe-area-inset-${inset}`);
    }

    expect(depthRadar).toContain('aria-label="3D navigation cues"');
    expect(depthRadar).toContain("game-depth-radar--semantic-only");
    expect(depthRadar).toContain("◆ YOU ARE APEX");
    expect(depthRadar).toContain("edibilityText(edibility)");
    expect(sharkLabels).toContain("relation.glyph");
    expect(edibility).toContain('glyph: "▼"');
    expect(edibility).toContain('glyph: "■"');
    expect(edibility).toContain('glyph: "▲"');
    expect(leaderboard).toContain("Apex target");
    expect(settings).toContain("Show shark name labels");
    expect(theme).toContain(':root[data-contrast="high"]');
  });

  it("keeps announcements bounded and captions available when audible playback is unavailable", () => {
    expect(leaderboard).toContain("rank <= 3");
    expect(leaderboard).toContain("rank < lastRank.current");
    expect(gameAudio).toContain("captionReachable");
    expect(gameAudio).toContain("return played || captioned");
    expect(gameAudio).toContain("AUDIO_LIMITS.captionRepeatMs");
    expect(captions).toContain('aria-hidden="true"');
    expect(app).toContain("<AnnouncerProvider>");
  });

  it("preserves the R3F-only renderer and state identities", () => {
    const pkg = JSON.parse(read("../package.json")) as { version: string };
    expect(gameViewport).toContain("<Canvas");
    expect(gameViewport).not.toContain("CanvasRenderingContext2D");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    expect(pkg.version).toBe("2.4.0");
  });
});

describe("canonical game surface", () => {
  it("routes the game explicitly and leaves retired paths unmatched", () => {
    expect(routes).toContain('path === "/play/"');
    expect(worker).toContain('if (path === "/" || path === "/play") return movedTo(url, "/play/");');
    expect(worker).toContain("if (!gameShell && !isStaticAssetPath(path)) return null");
    expect(worker).not.toContain('if (path === "/admin/status.json")');
    expect(worker).not.toContain('if (path === "/robots.txt")');
    expect(worker).not.toContain('if (path === "/sitemap.xml")');
    expect(protocol).not.toContain('leaderboard: "/api/leaderboard"');
    expect(worker).not.toContain('export { Lobby }');
  });
});


describe("ST-264 species motion accessibility", () => {
  it("keeps species shape and markings when reduced motion removes wobble", async () => {
    const { preyVisualFor, resolvePreyAnimation } = await import("../src/game/game/preyPresentation.js");
    const full = preyVisualFor("reef", 2, 0.58, "clownfish");
    const reduced = preyVisualFor("reef", 2, 0.58, "clownfish");
    expect(reduced).toEqual(full);
    expect(full.stripeCount).toBe(2);
    expect(resolvePreyAnimation({ seconds: 1.4, id: "fish-1", speed: 2, reducedMotion: true }).wobbleY).toBe(0);
    const layer = read("../src/game/game/PreyLayer.tsx");
    expect(layer).toContain('settings.a11y.motion === "reduced"');
    expect(layer).toContain("animation.wobbleY");
  });
});

it("ST-267 shows a bounded nearby-gold semantic caption and retains reduced-motion cues", () => {
  expect(gameScreen).toContain("<GoldenFishCaption socket={socket} />");
  expect(captions).toContain('role="status" aria-live="polite"');
  expect(captions).toContain("goldenFishNearby(state.food, self?.position)");
  expect(captions).toContain("setInterval(update, 250)");
  expect(captions).toContain("Golden fish nearby · 12 points");
  expect(theme).toContain(".game-golden-caption");
  expect(theme).toContain(':root[data-contrast="high"] .game-golden-caption');
  const preyRenderer = read("../src/game/game/PreyLayer.tsx");
  expect(preyRenderer).toContain("rayWingFlap(clock.elapsedTime, actor.id, reducedMotion)");
  expect(preyRenderer).toContain("const spin = reducedMotion ? 0 :");
});
