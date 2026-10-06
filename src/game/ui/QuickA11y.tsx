import { useState } from "react";
import { useSettings } from "../settings/SettingsContext.js";

/**
 * The in-game tools rail.
 *
 * On a pointer device every control is on the rail. On touch there is no room for a
 * nine-button rail beside a thumbstick and two ability pads, so `collapsed` folds the
 * whole set into one gear trigger whose popover holds everything — the rail then costs
 * a single 52px target instead of a strip wider than half the phone.
 */
export function QuickA11y({ onQuit, onHelp, onSettings, collapsed = false }: { onQuit: () => void; onHelp: () => void; onSettings: () => void; collapsed?: boolean }) {
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(false);
  const a = settings.a11y;
  const au = settings.audio;
  const musicOn = au.master > 0 && au.music > 0;
  const toggleMusic = () => update("audio", { music: musicOn ? 0 : 0.5, master: au.master === 0 ? 0.8 : au.master });

  const exit = <IconButton key="exit" icon="exit" label="Exit to menu" onClick={onQuit} />;
  const music = <button key="music" type="button" className={musicOn ? "icon-button is-active" : "icon-button"} aria-pressed={musicOn} aria-label={`Music: ${musicOn ? "on" : "off"}`} title={`Music: ${musicOn ? "on" : "off"}`} onClick={toggleMusic}><Icon name={musicOn ? "volume" : "volumeOff"} /></button>;
  const help = <IconButton key="help" icon="help" label="Controls" onClick={onHelp} />;
  const display = [
    <Toggle key="contrast" icon="contrast" label="High contrast" pressed={a.contrast === "high"} onClick={() => update("a11y", { contrast: a.contrast === "high" ? "normal" : "high" })} />,
    <Toggle key="motion" icon="motion" label="Reduced motion" pressed={a.motion === "reduced"} onClick={() => update("a11y", { motion: a.motion === "reduced" ? "full" : "reduced" })} />,
    <Toggle key="labels" icon="labels" label="Shark labels" pressed={a.colorblindLabels} onClick={() => update("a11y", { colorblindLabels: !a.colorblindLabels })} />,
    <Toggle key="captions" icon="captions" label="Captions" pressed={au.captions} onClick={() => update("audio", { captions: !au.captions })} />,
    <IconButton key="settings" icon="settings" label="Full settings" onClick={onSettings} />,
  ];

  return (
    <div className={collapsed ? "game-tools game-tools--collapsed" : "game-tools"} role="toolbar" aria-label="Game tools">
      {!collapsed && exit}
      {!collapsed && music}
      <div className="gearbox">
        {open && <div className="gearbox__popover" role="group" aria-label="Display and accessibility controls">
          {collapsed && exit}
          {collapsed && music}
          {display}
          {collapsed && help}
        </div>}
        <button type="button" className={open ? "icon-button gearbox__trigger is-active" : "icon-button gearbox__trigger"} aria-expanded={open} aria-label={collapsed ? "Game tools" : "More settings"} title={collapsed ? "Game tools" : "More settings"} onClick={() => setOpen((value) => !value)}><Icon name="gear" /></button>
      </div>
      {!collapsed && help}
    </div>
  );
}

type IconName = "exit" | "gear" | "contrast" | "motion" | "labels" | "captions" | "volume" | "volumeOff" | "settings" | "help";

function Toggle({ icon, label, pressed, onClick }: { icon: IconName; label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className={pressed ? "icon-button is-active" : "icon-button"} aria-pressed={pressed} aria-label={`${label}: ${pressed ? "on" : "off"}`} onClick={onClick} title={`${label}: ${pressed ? "on" : "off"}`}><Icon name={icon} /></button>
  );
}

function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) { return <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}><Icon name={icon} /></button>; }

function Icon({ name }: { name: IconName }) {
  const path: Record<IconName, React.ReactNode> = {
    exit: <><path d="m7 7 10 10M17 7 7 17"/><path d="M4 4h16v16H4z"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    contrast: <><circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 4a8 8 0 0 1 0 16" fill="currentColor"/></>,
    motion: <><path d="M4 8h10M2 12h13M5 16h9"/><path d="m14 6 6 6-6 6"/></>,
    labels: <><circle cx="8" cy="9" r="3"/><path d="M3 19c.5-4 2.2-6 5-6s4.5 2 5 6M15 8h6M15 12h5M16 16h4"/></>,
    captions: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4M7 14h4M14 10h3M14 14h3"/></>,
    volume: <><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 6.5c3 3 3 8 0 11"/></>,
    volumeOff: <><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m16 10 5 5M21 10l-5 5"/></>,
    settings: <><path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2" fill="var(--surface-2)"/><circle cx="15" cy="12" r="2" fill="var(--surface-2)"/><circle cx="11" cy="17" r="2" fill="var(--surface-2)"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.1 2.3c-.9.4-.9 1-.9 1.7M12 17h.01"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{path[name]}</svg>;
}
