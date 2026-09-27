// Composes the live game canvas, HUD, abilities, tools, and death dialog. Owns the
// room socket and disables gameplay input only while an interactive overlay is open.
//
// Layout is control-scheme driven, not screen-width driven: on a touch device the
// thumbstick takes one half of the screen and the ability pads sit under the opposite
// thumb, which is a different arrangement from the desktop rail — hence the
// `game-screen--touch` class rather than a media query alone.

import { useCallback, useEffect, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "../../engine/index.js";
import { GameCanvas } from "../game/GameCanvas.js";
import type { SnakeLabel } from "../game/Scene.js";
import type { StickState } from "../game/useLocalInput.js";
import { useRoomSocket } from "../net/useRoomSocket.js";
import { useSettings } from "../settings/SettingsContext.js";
import { useAnnouncer } from "../a11y/announcer.js";
import { useGameAudio } from "../audio/useGameAudio.js";
import { Hud } from "./Hud.js";
import { Leaderboard } from "./Leaderboard.js";
import { Minimap, MinimapSummary } from "./Minimap.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { Settings } from "./Settings.js";
import { QuickA11y } from "./QuickA11y.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { SnakeLabels } from "./SnakeLabels.js";
import { Captions } from "./Captions.js";
import { TouchControls, useTouchControls } from "./TouchControls.js";

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
  const stickRef = useRef<StickState>({ active: false, angle: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const touch = useTouchControls(settings);
  const stickSide = settings.controls.stickSide;

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

  // Help is keyboard-addressable; Escape closes a tool first, then exits the tank.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable
        || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (e.key === "?" && settings.controls.singleKeyShortcuts && !typing) {
        e.preventDefault();
        setHelpOpen((h) => !h);
        return;
      }
      if (e.code === "Escape") {
        if (settingsOpen) return;
        if (helpOpen) { e.preventDefault(); setHelpOpen(false); }
        else { e.preventDefault(); handleQuit(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, helpOpen, handleQuit]);

  // A dialog owns input; death does not — the respawn card is deliberately non-modal so
  // the tools rail (exit, audio, settings) stays reachable while you wait to come back.
  const dialogOpen = settingsOpen || helpOpen;
  const inputEnabled = !dialogOpen && !socket.death;

  return (
    <main
      id="main"
      className={touch ? `game-screen game-screen--touch game-screen--stick-${stickSide}` : "game-screen"}
    >
      <GameCanvas socket={socket} settings={settings} inputEnabled={inputEnabled} labelsRef={labelsRef} stickRef={stickRef} touchControls={touch} />

      {settings.a11y.colorblindLabels && <SnakeLabels labelsRef={labelsRef} />}

      <Hud socket={socket} />
      <Leaderboard socket={socket} />
      <FrenzyBanner socket={socket} />
      {settings.graphics.showMinimap && <Minimap socket={socket} />}
      <MinimapSummary socket={socket} />
      <QuickA11y onQuit={handleQuit} onHelp={openHelp} onSettings={openSettings} collapsed={touch} />
      <div className="ability-rail">
        <DashButton socket={socket} compact={touch} />
        <RocketButton socket={socket} compact={touch} />
      </div>
      {touch && <TouchControls stickRef={stickRef} side={stickSide} enabled={inputEnabled} />}
      {settings.audio.captions && <Captions caption={caption} />}

      {/* Connection banner. Always mounted — see conn-banner:empty in theme.css. */}
      <div role="status" className="conn-banner">
        {socket.status === "open" ? "" : socket.status === "connecting" ? "Connecting…" : "Reconnecting…"}
      </div>

      {socket.death && (
        <DeathOverlay death={socket.death} onRespawn={socket.respawn} onQuit={handleQuit} />
      )}

      {settingsOpen && <Settings onClose={closeSettings} />}
      {helpOpen && <HelpOverlay onClose={closeHelp} />}
    </main>
  );
}

function DashButton({ socket, compact }: { socket: ReturnType<typeof useRoomSocket>; compact: boolean }) {
  const cooldown = useAbilityCooldown(socket, "dashCooldownTick");
  const dash = () => { socket.setBoost(true); socket.setBoost(false); };
  return <button type="button" className="ability-button dash-button" disabled={cooldown > 0} onClick={dash} aria-label={cooldown ? `Dash cooling down, ${cooldown} seconds` : "Dash"} title={cooldown ? `Dash: ${cooldown}s` : "Dash · Space"}><DashIcon /><span>{cooldown ? `${cooldown}s` : "DASH"}</span>{!compact && <small>SPACE</small>}</button>;
}

function RocketButton({ socket, compact }: { socket: ReturnType<typeof useRoomSocket>; compact: boolean }) {
  const cooldown = useAbilityCooldown(socket, "rocketCooldownTick");
  return <button type="button" className="ability-button rocket-button" disabled={cooldown > 0} onClick={socket.rocket} aria-label={cooldown ? `Rocket cooling down, ${cooldown} seconds` : "Fire rocket"} title={cooldown ? `Rocket: ${cooldown}s` : "Fire rocket · Shift"}><RocketIcon /><span>{cooldown ? `${cooldown}s` : "ROCKET"}</span>{!compact && <small>SHIFT</small>}</button>;
}

function useAbilityCooldown(socket: ReturnType<typeof useRoomSocket>, field: "dashCooldownTick" | "rocketCooldownTick") {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { const update = () => { const state = socket.stateRef.current, shark = state?.snakes.find((item) => item.id === socket.youId); setCooldown(state && shark ? Math.max(0, Math.ceil((shark[field] - state.tick) / TICKS_PER_SECOND)) : 0); }; update(); const id = setInterval(update, 150); return () => clearInterval(id); }, [socket.stateRef, socket.youId, field]);
  return cooldown;
}

/**
 * Feeding Frenzy readout. The event is server-scheduled and lands on every client at the
 * same tick, so the countdown is derived from the snapshot rather than a local timer —
 * no drift, and a late joiner sees the correct remaining time immediately.
 */
function FrenzyBanner({ socket }: { socket: ReturnType<typeof useRoomSocket> }) {
  const [left, setLeft] = useState(0);
  const { announce } = useAnnouncer();
  const wasOn = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      const state = socket.stateRef.current;
      setLeft(state ? Math.max(0, Math.ceil((state.frenzyUntilTick - state.tick) / TICKS_PER_SECOND)) : 0);
    }, 200);
    return () => clearInterval(id);
  }, [socket.stateRef]);
  useEffect(() => {
    const on = left > 0;
    if (on && !wasOn.current) announce("Feeding frenzy. Chum in the middle of the tank.", "assertive");
    wasOn.current = on;
  }, [left, announce]);
  if (left <= 0) return null;
  return (
    <div className="frenzy-banner" role="status">
      <strong>FEEDING FRENZY</strong>
      <span>Chum dropped in the middle · {left}s</span>
    </div>
  );
}

function DashIcon() { return <svg viewBox="0 0 32 24" aria-hidden="true"><path d="M2 6h13M1 12h11M4 18h11M17 2l13 10-13 10Z" /></svg>; }
function RocketIcon() { return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 4c4-2 7-2 9-2 0 2 0 5-2 9L15 22l-6-6L19 4Z"/><path d="m10 16-6 1-2 6 8-2M15 22l-1 8 6-2 1-6M9 23l-6 6"/><circle cx="22" cy="8" r="3"/></svg>; }
