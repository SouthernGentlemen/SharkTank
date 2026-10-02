import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createRoom,
  ROOM_SCHEMA_VERSION,
  step,
} from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";
import { DEFAULT_KEYBINDS } from "../vendor/ModuleReact3Fiber/src/client/settings/SettingsContext.js";
import { desktopAxesForPressed } from "../vendor/ModuleReact3Fiber/src/client/game/desktopControls.js";
import {
  CAMERA_PROJECTION,
  advanceBankRoll,
  cameraFovForSpeed,
  chaseCameraPose,
  makeChaseCameraPose,
  smoothChaseCameraPose,
} from "../vendor/ModuleReact3Fiber/src/client/game/sceneMath.js";
import { resolveSharkAnimation } from "../vendor/ModuleReact3Fiber/src/client/game/sharkPresentation.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const worker = read("../src/worker/index.ts");
const presentation = read("../src/worker/presentation.ts");
const reactPresentation = read("../src/worker/presentation-react.tsx");
const humanDocs = read("../src/client/human-docs.ts");
const routes = read("../src/worker/routes.ts");
const app = read("../vendor/ModuleReact3Fiber/src/client/App.tsx");
const focusTrap = read("../vendor/ModuleReact3Fiber/src/client/a11y/useFocusTrap.ts");
const input = read("../vendor/ModuleReact3Fiber/src/client/game/useLocalInput.ts");
const theme = read("../vendor/ModuleReact3Fiber/src/client/ui/theme.css");
const settings = read("../vendor/ModuleReact3Fiber/src/client/ui/Settings.tsx");
const lobby = read("../src/worker/lobby-do.ts");
const presentationData = read("../src/worker/presentation-data.ts");
const protocol = read("../vendor/ModuleReact3Fiber/src/protocol/index.ts");
const gameViewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");
const gameScreen = read("../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx");
const help = read("../vendor/ModuleReact3Fiber/src/client/ui/HelpOverlay.tsx");
const death = read("../vendor/ModuleReact3Fiber/src/client/ui/DeathOverlay.tsx");
const quickA11y = read("../vendor/ModuleReact3Fiber/src/client/ui/QuickA11y.tsx");
const touchControls = read("../vendor/ModuleReact3Fiber/src/client/ui/TouchControls.tsx");
const leaderboard = read("../vendor/ModuleReact3Fiber/src/client/ui/Leaderboard.tsx");
const depthRadar = read("../vendor/ModuleReact3Fiber/src/client/ui/DepthRadar.tsx");
const captions = read("../vendor/ModuleReact3Fiber/src/client/ui/Captions.tsx");
const gameAudio = read("../vendor/ModuleReact3Fiber/src/client/audio/useGameAudio.ts");
const cameraRig = read("../vendor/ModuleReact3Fiber/src/client/game/CameraRig.tsx");
const actorLayer = read("../vendor/ModuleReact3Fiber/src/client/game/ActorLayer.tsx");
const fxLayer = read("../vendor/ModuleReact3Fiber/src/client/game/FxLayer.tsx");
const worldEnvironment = read("../vendor/ModuleReact3Fiber/src/client/game/WorldEnvironment.tsx");

describe("public accessibility contract", () => {
  it("keeps a keyboard bypass, visible focus, contrast, motion, and hash focus handling on evidence pages", () => {
    expect(reactPresentation).toContain('className="skip-link" href="#main"');
    expect(reactPresentation).toContain('<main id="main" tabIndex={-1}>');
    expect(presentation).toContain(":focus-visible{outline:3px solid var(--focus)");
    expect(presentation).toContain("@media(prefers-reduced-motion:reduce)");
    expect(presentation).toContain("@media(prefers-contrast:more)");
    expect(humanDocs).toContain("target.focus({ preventScroll: true })");
    expect(presentation).toContain('id="status-autoupdate"');
    expect(presentation).toContain("Pause auto-update");
    expect(presentation).toContain("Resume auto-update");
  });

  it("keeps evidence rendering to one status read, one 100-row service-log read, and zero Room reads", () => {
    const route = worker.match(/if \(path === "\/evidence\/"\) \{[\s\S]*?\n      \}\n\n      if \(path === "\/spend\.json"\)/)?.[0] ?? "";
    const start = worker.indexOf("async function publicLogData(env: Env) {");
    const end = worker.indexOf("/* ── State backup", start);
    const logReader = start >= 0 && end > start ? worker.slice(start, end) : "";
    expect(route.match(/lobbyStub\(env\)\.fetch\("https:\/\/lobby\/status"\)/g)).toHaveLength(1);
    expect(route).toContain("publicLogData(env)");
    expect(route).not.toContain("incidentData");
    expect(logReader.match(/lobbyStub\(env\)\.fetch/g)).toHaveLength(1);
    expect(logReader).toContain("https://lobby/audit?limit=${LOG_FETCH_SERVICE}");
    expect(logReader).not.toContain("roomFetch");
    expect(presentation).toContain("const LOG_FETCH_SERVICE = 100;");
    expect(worker).not.toContain("portalAvailability");
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
    expect(state.snakes.pilot.targetYaw).toBeCloseTo(0.35);
    expect(state.snakes.pilot.targetPitch).toBeCloseTo(0.25);

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
    expect(death).toContain("Quit to tank");
    expect(quickA11y).toContain('label="Exit to tank"');
    expect(quickA11y).not.toContain("Exit to tank (Escape)");
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
      tick: 100,
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
    expect(gameScreen).toContain('aria-modal="true"');
    expect(gameScreen).toContain('aria-describedby="round-result-summary round-result-next"');
    expect(gameScreen).toContain("dismissedResultRound !== roundUi.number && !dialogOpen");
    expect(theme).toContain("position: fixed; inset: 0; z-index: 200");
    expect(theme).toContain(".scrim--respawn{z-index:100");
    expect(theme).toContain(".round-result-layer{position:absolute;inset:0;z-index:200");
    expect(theme).toContain("--tap-min: 44px");
    expect(theme).toContain(".game-screen--touch .ability-button{width:76px;min-height:76px");
    for (const inset of ["top", "right", "bottom", "left"]) {
      expect(theme).toContain(`env(safe-area-inset-${inset}`);
    }

    expect(depthRadar).toContain('aria-label="3D navigation cues"');
    expect(depthRadar).toContain("game-depth-radar--semantic-only");
    expect(depthRadar).toContain("◆ YOU ARE APEX");
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
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    expect(pkg.version).toBe("3.0.0");
  });
});

describe("canonical public information architecture", () => {
  it("keeps exactly three primary navigation destinations", () => {
    const nav = reactPresentation.match(/const PRIMARY_NAV = \[[\s\S]*?\n\] as const;/)?.[0] ?? "";
    expect(nav).toContain('["/", "Overview"]');
    expect(nav).toContain('["/evidence/", "Evidence"]');
    expect(nav).toContain('["/play/", "Play"]');
    expect(nav).not.toContain("/controls/");
    expect(nav.match(/^  \[/gm)).toHaveLength(3);
  });

  it("keeps only the canonical slash redirects and retires compatibility aliases", () => {
    expect(routes).not.toContain("HUMAN_REDIRECTS");
    expect(routes).toContain('return path === "/admin" || path.startsWith("/admin/");');

    expect(worker).toContain('if (path === "/play") return movedTo(url, "/play/");');
    expect(worker).toContain('if (path === "/evidence") return movedTo(url, "/evidence/");');
    expect(worker).toContain('if (path === "/favicon.ico") return new Response(null, { status: 404');
    expect(worker).toContain("if (path.startsWith(\"/api/\")) return json({ ok: false, error: \"unknown endpoint\" }, 404);");

    for (const retiredLiteral of [
      'path === "/api/lobby"',
      'path === "/api/leaderboard"',
      'path === "/api/security-report"',
      'path === "/admin/security-report"',
      'path === "/admin/security-resolve"',
      'path === "/admin/test-alert"',
      'path === "/incidents.json"',
      'path === "/logs.json"',
      'path === "/docs/openapi.json"',
      'path === "/openapi.json"',
      'path === "/inquiry.json"',
      'path === "/audit.json"',
      'path === "/audit.jsonl"',
      'path === "/audit/status.json"',
      "(?:admin|audit)",
      "(?:arena|uno|x4|21|game|checkers|battleship|3d|shark-?run)",
    ]) expect(worker).not.toContain(retiredLiteral);

    expect(worker).toContain('if (path === "/admin/status.json")');
    expect(worker).toContain('if (path === "/admin/log.json")');
    expect(worker).toContain('if (path === "/admin/log.jsonl")');
    expect(worker).toContain("path.match(/^\\/admin\\/game\\/");
    expect(worker).toContain("path.match(/^\\/admin\\/replay\\/");
    expect(protocol).not.toContain('leaderboard: "/api/leaderboard"');
    expect(protocol).not.toContain("LeaderboardResponse");
    expect(lobby).not.toContain("mergeGlobal");
    expect(lobby).not.toContain('ctx.storage.put("global"');
    expect(lobby).not.toContain('path.endsWith("/leaderboard")');
    expect(presentationData).toContain("instance: _instance, global: _global");
    for (const retiredControl of ["/admin/security-report", "/admin/security-resolve", "/admin/test-alert", "/api/security-report"]) expect(presentation).not.toContain(retiredControl);
    expect(presentation).toContain('"security-report": "S500"');
    expect(presentation).toContain('"test-alert": "A600"');
  });

});
