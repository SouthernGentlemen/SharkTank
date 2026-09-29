// Composes the live game canvas, HUD, abilities, tools, and death dialog. Owns the
// room socket and disables gameplay input only while an interactive overlay is open.
//
// Layout is control-scheme driven, not screen-width driven: on a touch device the
// thumbstick takes one half of the screen and the ability pads sit under the opposite
// thumb, which is a different arrangement from the desktop rail — hence the
// `game-screen--touch` class rather than a media query alone.

import { useCallback, useEffect, useRef, useState } from "react";
import { FRENZY_RULES, TICKS_PER_SECOND, frenzyTiming } from "../../engine/index.js";
import { GameViewport } from "../game/GameViewport.js";
import type { SnakeLabel } from "../game/Scene.js";
import {
  canUseAbilityPointer,
  makeTwinStickState,
  touchLayoutForFlightSide,
  type TwinStickState,
} from "../game/mobileControls.js";
import { useRoomSocket } from "../net/useRoomSocket.js";
import { keyLabel, useSettings } from "../settings/SettingsContext.js";
import { useAnnouncer } from "../a11y/announcer.js";
import { useGameAudio } from "../audio/useGameAudio.js";
import { Hud } from "./Hud.js";
import { Leaderboard } from "./Leaderboard.js";
import { Minimap, MinimapSummary } from "./Minimap.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { Settings } from "./Settings.js";
import { QuickA11y } from "./QuickA11y.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { PauseMenu } from "./PauseMenu.js";
import { SnakeLabels } from "./SnakeLabels.js";
import { Captions } from "./Captions.js";
import { TouchControls, useTouchControls, useTouchPortraitLock } from "./TouchControls.js";

export interface GameScreenProps {
  room: { id: string; name: string };
  identity: { name: string; skin: string };
  onQuit: () => void;
}

export function GameScreen({ room, identity, onQuit }: GameScreenProps) {
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const socket = useRoomSocket(room.id, identity, room.name);
  const caption = useGameAudio(socket, settings);
  const labelsRef = useRef<SnakeLabel[]>([]);
  const touchInputRef = useRef<TwinStickState>(makeTwinStickState());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useTouchControls(settings);
  const stickSide = settings.controls.stickSide;
  const touchLayout = touchLayoutForFlightSide(stickSide);
  const portraitLocked = useTouchPortraitLock(touch);

  useEffect(() => {
    announce(`Entered ${room.name}. Playing as ${identity.name}.`);
  }, [room.name, identity.name, announce]);

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
    if (socket.death) setPaused(false);
  }, [socket.death]);

  // Every modal ownership transition disables gameplay input, which also releases held
  // flight/look/ability state in useLocalInput.
  const dialogOpen = settingsOpen || helpOpen || paused;
  const inputEnabled = !dialogOpen && !socket.death;
  const gameplayEnabled = inputEnabled && !portraitLocked;

  return (
    <main
      id="main"
      className={touch
        ? `game-screen game-screen--touch game-screen--flight-${touchLayout.flight} game-screen--actions-${touchLayout.actions}${portraitLocked ? " game-screen--portrait-lock" : ""}`
        : "game-screen"}
    >
      <GameViewport socket={socket} settings={settings} inputEnabled={gameplayEnabled} labelsRef={labelsRef} touchInputRef={touchInputRef} touchControls={touch} />

      {settings.a11y.colorblindLabels && <SnakeLabels labelsRef={labelsRef} />}

      <Hud socket={socket} />
      <Leaderboard socket={socket} />
      <FrenzyBanner socket={socket} reducedMotion={settings.a11y.motion === "reduced"} />
      {settings.graphics.showMinimap && <Minimap socket={socket} />}
      <MinimapSummary socket={socket} />
      <QuickA11y onQuit={handleQuit} onHelp={openHelp} onSettings={openSettings} collapsed={touch} />
      <div className="ability-rail">
        <DashButton socket={socket} compact={touch} keyName={keyLabel(settings.controls.keybinds.boost)} touchInputRef={touchInputRef} enabled={gameplayEnabled} />
        <BiteButton socket={socket} compact={touch} keyName={keyLabel(settings.controls.keybinds.bite)} touchInputRef={touchInputRef} enabled={gameplayEnabled} />
      </div>
      {touch && <TouchControls inputRef={touchInputRef} flightSide={stickSide} enabled={inputEnabled} portraitLocked={portraitLocked} />}
      {settings.audio.captions && <Captions caption={caption} />}

      {/* Connection banner. Always mounted — see conn-banner:empty in theme.css. */}
      <div role="status" className="conn-banner">
        {socket.status === "open" ? "" : socket.status === "connecting" ? "Connecting…" : socket.status === "incompatible" ? "Game update required. Reload to reconnect." : "Reconnecting…"}
      </div>

      {socket.death && (
        <DeathOverlay death={socket.death} onRespawn={socket.respawn} onQuit={handleQuit} />
      )}

      {paused && !settingsOpen && !helpOpen && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onSettings={() => setSettingsOpen(true)}
          onQuit={handleQuit}
          pauseLabel={keyLabel(settings.controls.keybinds.pause)}
        />
      )}
      {settingsOpen && <Settings onClose={closeSettings} />}
      {helpOpen && <HelpOverlay onClose={closeHelp} />}
    </main>
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
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, release]);

  const pointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!compact || e.pointerType === "mouse" || pointerId.current !== null || cooldown > 0 || !enabled) return;
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
    if (!enabled || cooldown > 0) return;
    socket.setBoost(true);
    socket.setBoost(false);
  };

  return <button type="button" className="ability-button dash-button" disabled={cooldown > 0 || !enabled} onPointerDown={pointerDown} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onClick={click} aria-label={cooldown ? `Dash cooling down, ${cooldown} seconds` : "Dash"} title={cooldown ? `Dash: ${cooldown}s` : `Dash · ${keyName}`}><DashIcon /><span>{cooldown ? `${cooldown}s` : "DASH"}</span>{!compact && <small>{keyName}</small>}</button>;
}

function BiteButton({ socket, compact, keyName, touchInputRef, enabled }: AbilityButtonProps) {
  const cooldown = useAbilityCooldown(socket, "biteCooldownTick");
  const pointerId = useRef<number | null>(null);
  const lastTouchAt = useRef(-Infinity);
  const release = useCallback(() => { pointerId.current = null; }, []);

  useEffect(() => {
    if (!enabled) release();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, release]);

  const pointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!compact || e.pointerType === "mouse" || pointerId.current !== null || cooldown > 0 || !enabled) return;
    if (!canUseAbilityPointer(touchInputRef.current, e.pointerId)) return;
    e.preventDefault();
    pointerId.current = e.pointerId;
    lastTouchAt.current = performance.now();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer ended */ }
    socket.bite();
  };
  const pointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== pointerId.current) return;
    e.preventDefault();
    release();
  };
  const click = () => {
    if (performance.now() - lastTouchAt.current < 800) return;
    if (enabled && cooldown <= 0) socket.bite();
  };

  return <button type="button" className="ability-button bite-button" disabled={cooldown > 0 || !enabled} onPointerDown={pointerDown} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onClick={click} aria-label={cooldown ? `Bite cooling down, ${cooldown} seconds` : "Bite"} title={cooldown ? `Bite: ${cooldown}s` : `Directional bite · ${keyName}`}><BiteIcon /><span>{cooldown ? `${cooldown}s` : "BITE"}</span>{!compact && <small>{keyName}</small>}</button>;
}

function useAbilityCooldown(socket: ReturnType<typeof useRoomSocket>, field: "dashCooldownTick" | "biteCooldownTick") {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { const update = () => { const state = socket.stateRef.current, shark = state?.snakes.find((item) => item.id === socket.youId); setCooldown(state && shark ? Math.max(0, Math.ceil((shark[field] - state.tick) / TICKS_PER_SECOND)) : 0); }; update(); const id = setInterval(update, 150); return () => clearInterval(id); }, [socket.stateRef, socket.youId, field]);
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
