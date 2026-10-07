// Composes the live R3F gameplay viewport, DOM HUD, abilities, tools, and dialogs. Owns
// the room socket and disables gameplay input only while an interactive overlay is open.
//
// Layout is control-scheme driven, not screen-width driven: touch play uses independent
// flight and look sticks plus separate ability pointers, while desktop uses the keyboard
// flight/look clusters and optional mouse look. The `game-screen--touch` class reflects
// that ownership rather than a media query alone.

import { useCallback, useEffect, useRef, useState } from "react";
import { FRENZY_RULES, TICKS_PER_SECOND, frenzyTiming, roundTicksLeft } from "../../engine/index.js";
import { BiteBuffer } from "../game/biteBuffer.js";
import { GameViewport } from "../game/GameViewport.js";
import type { SharkLabel } from "../game/Scene.js";
import {
  canUseAbilityPointer,
  makeTwinStickState,
  touchLayoutForFlightSide,
  type TwinStickState,
} from "../game/mobileControls.js";
import { useRoomSocket } from "../net/useRoomSocket.js";
import { keyLabel, useSettings } from "../settings/SettingsContext.js";
import { useAnnouncer } from "../a11y/announcer.js";
import { useFocusTrap } from "../a11y/useFocusTrap.js";
import { useGameAudio } from "../audio/useGameAudio.js";
import { Hud } from "./Hud.js";
import { Leaderboard } from "./Leaderboard.js";
import { DepthRadar } from "./DepthRadar.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { Settings } from "./Settings.js";
import { QuickA11y } from "./QuickA11y.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { PauseMenu } from "./PauseMenu.js";
import { SharkLabels } from "./SharkLabels.js";
import { Captions } from "./Captions.js";
import { TouchControls, useTouchControls, useTouchPortraitLayout } from "./TouchControls.js";

export interface GameScreenProps {
  room: { id: string; name: string };
  identity: { name: string; skin: string };
  onAuthoritativeResult?: (score: number) => void;
  onQuit: () => void;
}

export function GameScreen({ room, identity, onAuthoritativeResult, onQuit }: GameScreenProps) {
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const socket = useRoomSocket(room.id, identity, room.name);
  const caption = useGameAudio(socket, settings);
  const labelsRef = useRef<SharkLabel[]>([]);
  const touchInputRef = useRef<TwinStickState>(makeTwinStickState());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useTouchControls(settings);
  const stickSide = settings.controls.stickSide;
  const touchLayout = touchLayoutForFlightSide(stickSide);
  const portrait = useTouchPortraitLayout(touch);
  const roundUi = useRoundPresentation(socket, onAuthoritativeResult);
  const [dismissedResultRound, setDismissedResultRound] = useState(0);
  const hasAnnouncedEntry = useRef(false);

  useEffect(() => {
    if (socket.status !== "open" || hasAnnouncedEntry.current) return;
    hasAnnouncedEntry.current = true;
    announce(`Entered ${room.name}. Playing as ${identity.name}.`);
  }, [socket.status, room.name, identity.name, announce]);

  const handleQuit = useCallback(() => {
    announce("Left the tank.");
    onQuit();
  }, [announce, onQuit]);

  // Stable identities. GameScreen re-renders on every leaderboard broadcast (2s), and these
  // are passed straight to dialogs that key effects off them — see useFocusTrap.
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  // Help remains a switchable single-character shortcut. The remappable pause key opens
  // a real dialog instead of immediately quitting the tank.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const interactive = !!target && Boolean(target.closest("button, a, input, select, textarea, [contenteditable='true'], [role='button']"));
      if (e.key === "?" && settings.controls.singleKeyShortcuts && !interactive) {
        e.preventDefault();
        setHelpOpen((h) => !h);
        return;
      }
      if (e.code !== settings.controls.keybinds.pause || interactive || settingsOpen) return;
      e.preventDefault();
      if (helpOpen) setHelpOpen(false);
      else if (!socket.death) setPaused((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.controls.keybinds.pause, settings.controls.singleKeyShortcuts, settingsOpen, helpOpen, socket.death]);

  useEffect(() => {
    if (socket.death || roundUi?.phase === "result") setPaused(false);
  }, [socket.death, roundUi?.phase]);

  // Every modal ownership transition disables gameplay input, which also releases held
  // flight/look/ability state in useLocalInput.
  const dialogOpen = settingsOpen || helpOpen || paused;
  const connectionBlocked = socket.status === "full" || socket.status === "unreachable";
  const inputEnabled = !dialogOpen && !socket.death && socket.status === "open";
  const gameplayEnabled = inputEnabled && roundUi?.phase !== "result";

  return (
    <main
      id="main"
      className={touch
        ? `game-screen game-screen--touch game-screen--flight-${touchLayout.flight} game-screen--actions-${touchLayout.actions} game-screen--scheme-${settings.controls.touchScheme}${portrait ? " game-screen--portrait" : ""}`
        : "game-screen"}
    >
      <GameViewport socket={socket} settings={settings} inputEnabled={gameplayEnabled} labelsRef={labelsRef} touchInputRef={touchInputRef} touchControls={touch} />

      {settings.a11y.colorblindLabels && <SharkLabels labelsRef={labelsRef} quality={settings.graphics.quality} />}

      <Hud socket={socket} />
      <Leaderboard socket={socket} />
      <FrenzyBanner socket={socket} reducedMotion={settings.a11y.motion === "reduced"} />
      <DepthRadar socket={socket} visible={settings.graphics.showMinimap} compact={touch} />
      <QuickA11y onQuit={handleQuit} onHelp={openHelp} onSettings={openSettings} collapsed={touch} />
      <div className="ability-rail">
        <DashButton socket={socket} compact={touch} keyName={keyLabel(settings.controls.keybinds.boost)} touchInputRef={touchInputRef} enabled={gameplayEnabled} />
        <BiteButton socket={socket} compact={touch} keyName={keyLabel(settings.controls.keybinds.bite)} touchInputRef={touchInputRef} enabled={gameplayEnabled} />
      </div>
      {touch && <TouchControls inputRef={touchInputRef} flightSide={stickSide} scheme={settings.controls.touchScheme} enabled={gameplayEnabled} portrait={portrait} />}
      {settings.audio.captions && <Captions caption={caption} />}

      {roundUi?.phase === "result" && dismissedResultRound !== roundUi.number && !dialogOpen && !connectionBlocked && (
        <RoundResult
          round={roundUi}
          onContinue={() => setDismissedResultRound(roundUi.number)}
        />
      )}

      {/* Connection banner. Always mounted — see conn-banner:empty in theme.css. */}
      <div role="status" className="conn-banner">
        {socket.status === "connecting"
          ? "Connecting…"
          : socket.status === "reconnecting"
            ? "Reconnecting…"
            : socket.status === "incompatible"
              ? "Game update required. Reload to reconnect."
              : ""}
      </div>

      {(socket.status === "full" || socket.status === "unreachable") && (
        <ConnectionGate status={socket.status} onRetry={socket.retry} onBack={handleQuit} />
      )}

      {socket.death && roundUi?.phase !== "result" && !connectionBlocked && (
        <DeathOverlay death={socket.death} onRespawn={socket.respawn} onQuit={handleQuit} />
      )}

      {paused && !settingsOpen && !helpOpen && !connectionBlocked && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onSettings={() => setSettingsOpen(true)}
          onQuit={handleQuit}
          pauseLabel={keyLabel(settings.controls.keybinds.pause)}
        />
      )}
      {settingsOpen && !connectionBlocked && <Settings onClose={closeSettings} />}
      {helpOpen && !connectionBlocked && <HelpOverlay onClose={closeHelp} />}
    </main>
  );
}

function ConnectionGate({ status, onRetry, onBack }: {
  status: "full" | "unreachable";
  onRetry: () => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { announce } = useAnnouncer();
  const full = status === "full";
  const title = full ? "Tank full — you'll join when a spot opens" : "Can't reach the tank";

  useFocusTrap(ref, true, onBack);
  useEffect(() => {
    announce(
      full
        ? "Tank full. You'll join when a spot opens. Retrying every 5 seconds."
        : "Can't reach the tank. Retry or go back.",
      "assertive",
    );
  }, [full, announce]);

  return (
    <div className="connection-gate">
      <div
        ref={ref}
        className="panel stack connection-gate__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-gate-title"
        aria-describedby="connection-gate-detail"
      >
        <h2 id="connection-gate-title" className="dialog-title">{title}</h2>
        <p id="connection-gate-detail" className="dialog-note">
          {full ? "Retrying automatically every 5 seconds." : "Three connection attempts failed. Check your connection and try again."}
        </p>
        <div className="stack">
          {!full && <button className="btn btn--primary btn--lg btn--block" onClick={onRetry}>Retry</button>}
          <button className={full ? "btn btn--primary btn--lg btn--block" : "btn btn--block"} onClick={onBack}>Back</button>
        </div>
      </div>
    </div>
  );
}

interface RoundUiState {
  number: number;
  phase: "active" | "apex" | "result";
  secondsLeft: number;
  apexName: string | null;
  winnerName: string | null;
  winnerScore: number | null;
  localScore: number;
}

function useRoundPresentation(
  socket: ReturnType<typeof useRoomSocket>,
  onAuthoritativeResult?: (score: number) => void,
): RoundUiState | null {
  const { announce } = useAnnouncer();
  const [round, setRound] = useState<RoundUiState | null>(null);
  const announcedKey = useRef("");
  const reportedRound = useRef(0);

  useEffect(() => {
    const update = () => {
      const state = socket.stateRef.current;
      if (!state) return;
      const apex = state.round.apexId
        ? state.sharks.find((shark) => shark.id === state.round.apexId)
        : null;
      const winner = state.round.result?.winner ?? null;
      const local = state.sharks.find((shark) => shark.id === socket.youId);
      setRound({
        number: state.round.number,
        phase: state.round.phase,
        secondsLeft: Math.ceil(roundTicksLeft(state) / TICKS_PER_SECOND),
        apexName: apex?.name ?? null,
        winnerName: winner?.name ?? null,
        winnerScore: winner?.score ?? null,
        localScore: local?.score ?? 0,
      });
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [socket.stateRef, socket.youId]);

  useEffect(() => {
    if (!round) return;
    const key = `${round.number}:${round.phase}`;
    if (key === announcedKey.current) return;
    announcedKey.current = key;

    if (round.phase === "active") {
      announce(`Round ${round.number} started. Five minutes on the authoritative round clock.`);
    } else if (round.phase === "apex") {
      announce(
        `Apex climax. ${round.apexName ?? "The current leader"} is marked as the Apex. ${round.secondsLeft} seconds remain.`,
        "assertive",
      );
    } else {
      const result = round.winnerName
        ? `${round.winnerName} wins round ${round.number} with ${round.winnerScore ?? 0} points.`
        : `Round ${round.number} ended with no winner.`;
      announce(`${result} Next round starts in ${round.secondsLeft} seconds.`, "assertive");
      if (reportedRound.current !== round.number) {
        reportedRound.current = round.number;
        onAuthoritativeResult?.(round.localScore);
      }
    }
  }, [round, announce, onAuthoritativeResult]);

  return round;
}

function RoundResult({
  round,
  onContinue,
}: {
  round: RoundUiState;
  onContinue: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, true, onContinue);

  return (
    <div className="round-result-layer">
      <section
        ref={ref}
        className="panel round-result-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-result-title"
        aria-describedby="round-result-summary round-result-next"
      >
        <p className="round-result-kicker">ROUND {round.number} COMPLETE</p>
        <h2 id="round-result-title">
          {round.winnerName ? `${round.winnerName} wins` : "Round complete"}
        </h2>
        <p id="round-result-summary">
          {round.winnerName
            ? `${round.winnerScore ?? 0} points. Your final score: ${round.localScore}.`
            : `Your final score: ${round.localScore}.`}
        </p>
        <p id="round-result-next" className="round-result-next">Next round starts in {round.secondsLeft}s.</p>
        <button type="button" className="btn btn--primary btn--lg" onClick={onContinue}>
          Ready for next round
        </button>
      </section>
    </div>
  );
}

interface AbilityButtonProps {
  socket: ReturnType<typeof useRoomSocket>;
  compact: boolean;
  keyName: string;
  touchInputRef: React.MutableRefObject<TwinStickState>;
  enabled: boolean;
}

function DashButton({ socket, compact, keyName, touchInputRef, enabled }: AbilityButtonProps) {
  const cooldown = useAbilityCooldown(socket, "dashCooldownTick");
  const pointerId = useRef<number | null>(null);
  const lastTouchAt = useRef(-Infinity);

  const release = useCallback(() => {
    if (pointerId.current !== null) socket.setBoost(false);
    pointerId.current = null;
  }, [socket]);

  useEffect(() => {
    if (!enabled) release();
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
  }, [enabled, release]);

  const pointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!compact || e.pointerType === "mouse" || pointerId.current !== null || !enabled) return;
    if (!canUseAbilityPointer(touchInputRef.current, e.pointerId)) return;
    e.preventDefault();
    pointerId.current = e.pointerId;
    lastTouchAt.current = performance.now();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer ended */ }
    socket.setBoost(true);
  };
  const pointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== pointerId.current) return;
    e.preventDefault();
    release();
  };
  const click = () => {
    if (performance.now() - lastTouchAt.current < 800) return;
    if (!enabled) return;
    socket.setBoost(true);
    socket.setBoost(false);
  };

  return <button type="button" className="ability-button dash-button" disabled={!enabled} onPointerDown={pointerDown} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onClick={click} aria-label={cooldown ? `Dash cooling down, ${cooldown.toFixed(1)} seconds` : "Dash"} title={cooldown ? `Dash: ${cooldown.toFixed(1)}s` : `Dash · ${keyName}`}><CooldownRing remaining={cooldown} total={2} /><DashIcon /><span>{cooldown ? `${cooldown.toFixed(1)}s` : "DASH"}</span>{!compact && <small>{keyName}</small>}</button>;
}

function BiteButton({ socket, compact, keyName, touchInputRef, enabled }: AbilityButtonProps) {
  const cooldown = useAbilityCooldown(socket, "biteCooldownTick");
  const buffer = useRef(new BiteBuffer());
  const press = () => {
    if (buffer.current.press(performance.now(), abilityRemaining(socket, "biteCooldownTick") * 1000)) socket.bite();
  };
  useEffect(() => {
    const poll = setInterval(() => {
      if (enabled && buffer.current.consume(performance.now(), abilityRemaining(socket, "biteCooldownTick") * 1000)) socket.bite();
    }, 25);
    const clear = () => buffer.current.clear();
    window.addEventListener("resize", clear);
    window.addEventListener("orientationchange", clear);
    return () => { clearInterval(poll); clear(); window.removeEventListener("resize", clear); window.removeEventListener("orientationchange", clear); };
  }, [enabled, socket.stateRef, socket.youId, socket.bite]);
  const pointerId = useRef<number | null>(null);
  const lastTouchAt = useRef(-Infinity);
  const release = useCallback(() => { pointerId.current = null; }, []);

  useEffect(() => {
    if (!enabled) { release(); buffer.current.clear(); }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { release(); buffer.current.clear(); }
    };
    const cancel = () => { release(); buffer.current.clear(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("orientationchange", cancel);
    window.visualViewport?.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("orientationchange", cancel);
      window.visualViewport?.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, release]);

  const pointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!compact || e.pointerType === "mouse" || pointerId.current !== null || !enabled) return;
    if (!canUseAbilityPointer(touchInputRef.current, e.pointerId)) return;
    e.preventDefault();
    pointerId.current = e.pointerId;
    lastTouchAt.current = performance.now();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer ended */ }
    press();
  };
  const pointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== pointerId.current) return;
    e.preventDefault();
    if (e.type === "pointercancel") buffer.current.clear();
    release();
  };
  const click = () => {
    if (performance.now() - lastTouchAt.current < 800) return;
    if (enabled) press();
  };

  return <button type="button" className="ability-button bite-button" disabled={!enabled} onPointerDown={pointerDown} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onClick={click} aria-label={cooldown ? `Bite cooling down, ${cooldown.toFixed(1)} seconds` : "Bite"} title={cooldown ? `Bite: ${cooldown.toFixed(1)}s` : `Directional bite · ${keyName}`}><CooldownRing remaining={cooldown} total={14 / TICKS_PER_SECOND} /><BiteIcon /><span>{cooldown ? `${cooldown.toFixed(1)}s` : "BITE"}</span>{!compact && <small>{keyName}</small>}</button>;
}

function abilityRemaining(socket: ReturnType<typeof useRoomSocket>, field: "dashCooldownTick" | "biteCooldownTick"): number {
  const state = socket.stateRef.current;
  const shark = state?.sharks.find((item) => item.id === socket.youId);
  return state && shark ? Math.max(0, (shark[field] - state.tick) / TICKS_PER_SECOND) : Infinity;
}

export function CooldownRing({ remaining, total }: { remaining: number; total: number }) {
  const progress = Math.max(0, Math.min(1, remaining / total));
  return <svg className="cooldown-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" pathLength="1" /><circle cx="50" cy="50" r="46" pathLength="1" strokeDasharray={`${progress} 1`} /></svg>;
}

function useAbilityCooldown(socket: ReturnType<typeof useRoomSocket>, field: "dashCooldownTick" | "biteCooldownTick") {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    const update = () => {
      const state = socket.stateRef.current;
      const shark = state?.sharks.find((item) => item.id === socket.youId);
      const next = state && shark
        ? Math.max(0, (shark[field] - state.tick) / TICKS_PER_SECOND)
        : 0;
      setCooldown((previous) => previous === next ? previous : next);
    };
    update();
    const id = setInterval(update, 50);
    return () => clearInterval(id);
  }, [socket.stateRef, socket.youId, field]);
  return cooldown;
}

/**
 * Feeding Frenzy readout. The event is server-scheduled and lands on every client at the
 * same tick, so the countdown is derived from the snapshot rather than a local timer —
 * no drift, and a late joiner sees the correct remaining time immediately.
 */
function FrenzyBanner({
  socket,
  reducedMotion,
}: {
  socket: ReturnType<typeof useRoomSocket>;
  reducedMotion: boolean;
}) {
  const [left, setLeft] = useState(0);
  const [ended, setEnded] = useState(false);
  const { announce } = useAnnouncer();
  const wasOn = useRef(false);
  const endCueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const update = () => {
      const state = socket.stateRef.current;
      const remaining = state ? frenzyTiming(state).remainingTicks : 0;
      setLeft(Math.ceil(remaining / TICKS_PER_SECOND));
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [socket.stateRef]);

  useEffect(() => {
    const on = left > 0;
    if (on && !wasOn.current) {
      announce("Feeding frenzy. Converge on the central water column.", "assertive");
      setEnded(false);
      if (endCueTimer.current) clearTimeout(endCueTimer.current);
    } else if (!on && wasOn.current) {
      announce("Feeding frenzy ended.", "polite");
      setEnded(true);
      if (endCueTimer.current) clearTimeout(endCueTimer.current);
      endCueTimer.current = setTimeout(() => setEnded(false), 1800);
    }
    wasOn.current = on;
  }, [left, announce]);

  useEffect(() => () => {
    if (endCueTimer.current) clearTimeout(endCueTimer.current);
  }, []);

  if (left <= 0 && !ended) return null;
  const classes = `frenzy-banner${reducedMotion ? " frenzy-banner--reduced-motion" : ""}${ended ? " frenzy-banner--ended" : ""}`;
  if (ended) {
    return (
      <div className={classes} role="status">
        <strong>FRENZY ENDED</strong>
        <span>Central water column returning to normal</span>
      </div>
    );
  }

  const speedBonus = Math.round((FRENZY_RULES.speedMultiplier - 1) * 100);
  const dashRecharge = Math.round(1 / FRENZY_RULES.dashCooldownMultiplier);
  return (
    <div className={classes} role="status">
      <strong>FEEDING FRENZY</strong>
      <span>Central water column · +{speedBonus}% swim speed · dash recharge {dashRecharge}× · {left}s</span>
    </div>
  );
}

function DashIcon() { return <svg viewBox="0 0 32 24" aria-hidden="true"><path d="M2 6h13M1 12h11M4 18h11M17 2l13 10-13 10Z" /></svg>; }
function BiteIcon() { return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 9c6-5 18-5 24 0-2 8-7 14-12 17C11 23 6 17 4 9Z"/><path d="m8 11 3 5 3-6 3 6 3-6 3 5"/></svg>; }
