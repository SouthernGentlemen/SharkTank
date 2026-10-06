import { useRef } from "react";
import { useFocusTrap } from "../a11y/useFocusTrap.js";
import { keyLabel, useSettings } from "../settings/SettingsContext.js";
import { useTouchControls } from "./TouchControls.js";

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const { settings } = useSettings();
  const k = settings.controls.keybinds;
  // Documenting keys to someone holding a phone is worse than documenting nothing.
  const touch = useTouchControls(settings);
  const stick = settings.controls.stickSide === "left" ? "left" : "right";
  const look = stick === "left" ? "right" : "left";
  const pads = look;

  return (
    <div className="scrim">
      <div
        ref={ref}
        className="panel stack help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <div className="spread">
          <h2 id="help-title" className="dialog-title">Controls</h2>
          <button className="btn" onClick={onClose} aria-label="Close help">Close</button>
        </div>

        {touch ? (
          <div className="control-grid">
            <Control icon="steer" label="Fly"><span>{stick} flight stick</span><small>Up/down pitches to climb or dive; left/right yaws while the shark keeps swimming forward.</small></Control>
            <Control icon="steer" label="Look"><span>{look} look stick</span><small>Offsets the chase camera in four directions; release to recenter behind the shark.</small></Control>
            <Control icon="dash" label="Dash"><span>{pads} pad</span><small>2s cooldown · half that during a frenzy</small></Control>
            <Control icon="bite" label="Bite"><span>{pads} pad</span><small>Directional close-range attack · aim with the shark</small></Control>
            <Control icon="menu" label="Tools"><span>Gear button</span><small>Exit, audio, display, and full settings</small></Control>
          </div>
        ) : (
          <div className="control-grid">
            <Control icon="steer" label="Fly"><Key>{keyLabel(k.pitchUp)}</Key><Key>{keyLabel(k.pitchDown)}</Key><Key>{keyLabel(k.yawLeft)}</Key><Key>{keyLabel(k.yawRight)}</Key><small>W/S pitch · A/D yaw by default</small></Control>
            <Control icon="steer" label="Look"><Key>{keyLabel(k.lookUp)}</Key><Key>{keyLabel(k.lookDown)}</Key><Key>{keyLabel(k.lookLeft)}</Key><Key>{keyLabel(k.lookRight)}</Key><span>Mouse optional</span><small>Camera only; shark direction is unchanged</small></Control>
            <Control icon="dash" label="Burst"><Key>{keyLabel(k.boost)}</Key><small>2s cooldown · half that during a frenzy</small></Control>
            <Control icon="bite" label="Bite"><Key>{keyLabel(k.bite)}</Key><small>Directional close-range attack · size and burst give modest bonuses</small></Control>
            <Control icon="menu" label="Tools"><Key>{keyLabel(k.pause)}</Key><Key>?</Key><small>Pause, help, exit and settings</small></Control>
          </div>
        )}
        <p className="help-note">
          Every 75 seconds a <strong>Feeding Frenzy</strong> drops chum in the middle of the tank:
          everyone swims faster and dashes twice as often for twenty seconds.
        </p>
      </div>
    </div>
  );
}

type ControlIcon = "steer" | "dash" | "bite" | "menu";
function Control({ icon, label, children }: { icon: ControlIcon; label: string; children: React.ReactNode }) { return <section className="control-card"><ControlSvg name={icon} /><strong>{label}</strong><div>{children}</div></section>; }
function ControlSvg({ name }: { name: ControlIcon }) {
  const paths: Record<ControlIcon, React.ReactNode> = {
    steer: <><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/><circle cx="12" cy="12" r="2"/></>,
    dash: <><path d="M3 8h9M2 12h8M4 16h8M13 5l8 7-8 7Z"/></>,
    bite: <><path d="M3 7c5-4 13-4 18 0-2 6-5 11-9 13C8 18 5 13 3 7Z"/><path d="m6 9 2 4 3-5 2 5 3-5 2 4"/></>,
    menu: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></>,
  };
  return <svg className="control-card__icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="control-key">{children}</kbd>;
}
