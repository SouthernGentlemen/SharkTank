// Systems menu: Graphics / Audio / Controls / Accessibility. Rendered either as a
// full screen (from the main menu) or as a modal overlay (from the in-game gear) when `onClose`
// is supplied. Tabs follow the WAI-ARIA tabs pattern (arrow-key navigation, roving
// focus); every control has a programmatic name and current value.

import { useId, useRef, useState } from "react";
import {
  isBindableKeyCode,
  keyLabel,
  rebindKeybinds,
  useSettings,
  type Keybinds,
} from "../settings/SettingsContext.js";
import { useFocusTrap } from "../a11y/useFocusTrap.js";

type Tab = "graphics" | "audio" | "controls" | "accessibility";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "graphics", label: "Graphics" },
  { id: "audio", label: "Audio" },
  { id: "controls", label: "Controls" },
  { id: "accessibility", label: "Accessibility" },
];

export function Settings({ onClose }: { onClose?: () => void }) {
  const overlay = Boolean(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, overlay, onClose);

  const body = (
    <div ref={ref} className={`${overlay ? "panel stack" : "stack"} settings-panel${overlay ? " settings-panel--overlay" : ""}`} role={overlay ? "dialog" : undefined} aria-modal={overlay || undefined} aria-labelledby="settings-title">
      <div className="spread">
        <h1 id="settings-title" className="screen-title">Settings</h1>
        {onClose && <button className="btn" onClick={onClose} aria-label="Close settings">Close</button>}
      </div>
      <SettingsTabs />
    </div>
  );

  if (overlay) return <div className="scrim">{body}</div>;
  return <div className="center-screen">{body}</div>;
}

function SettingsTabs() {
  const [tab, setTab] = useState<Tab>("graphics");
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    const t = TABS[next].id;
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  return (
    <div className="stack">
      <div role="tablist" aria-label="Settings categories" className="settings-tabs">
        {TABS.map((t, i) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              role="tab"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "btn btn--primary" : "btn btn--ghost"}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`} tabIndex={0}>
        {tab === "graphics" && <GraphicsPanel />}
        {tab === "audio" && <AudioPanel />}
        {tab === "controls" && <ControlsPanel />}
        {tab === "accessibility" && <AccessibilityPanel />}
      </div>
    </div>
  );
}

// ── Reusable fields ─────────────────────────────────────────────────────────────
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="spread settings-toggle">
      <span>
        <span className="settings-field-label">{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </span>
      <input className="settings-checkbox" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.05, formatValue }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; formatValue?: (v: number) => string }) {
  const id = useId();
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const displayValue = formatValue ? formatValue(value) : `${pct}%`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}: {displayValue}</label>
      <input id={id} className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={displayValue} />
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ v: T; l: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset className="settings-choice">
      <legend className="settings-choice-legend">{label}</legend>
      <div className="row settings-choice-options">
        {options.map((o) => (
          <label key={o.v} className="row settings-choice-option">
            <input className="settings-radio" type="radio" name={label} checked={value === o.v} onChange={() => onChange(o.v)} />
            {o.l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────────────
function GraphicsPanel() {
  const { settings, update } = useSettings();
  const g = settings.graphics;
  return (
    <div className="stack">
      <Choice label="Quality" value={g.quality} onChange={(v) => update("graphics", { quality: v })} options={[{ v: "low", l: "Low" }, { v: "medium", l: "Medium" }, { v: "high", l: "High" }]} />
      <Toggle label="Show minimap" checked={g.showMinimap} onChange={(v) => update("graphics", { showMinimap: v })} />
      <Toggle label="Show ground grid" checked={g.showGrid} onChange={(v) => update("graphics", { showGrid: v })} />
      <Toggle label="Camera motion" hint="Smooth camera follow. Turn off to reduce motion." checked={g.cameraShake} onChange={(v) => update("graphics", { cameraShake: v })} />
    </div>
  );
}

function AudioPanel() {
  const { settings, update } = useSettings();
  const a = settings.audio;
  return (
    <div className="stack">
      <Slider label="Master volume" value={a.master} onChange={(v) => update("audio", { master: v })} />
      <Slider label="Sound effects" value={a.sfx} onChange={(v) => update("audio", { sfx: v })} />
      <Slider label="Music" value={a.music} onChange={(v) => update("audio", { music: v })} />
      <Toggle label="Captions for audio cues" hint="Show on-screen text for important sounds." checked={a.captions} onChange={(v) => update("audio", { captions: v })} />
    </div>
  );
}

const REBINDABLE: Array<{ key: keyof Keybinds; label: string }> = [
  { key: "pitchUp", label: "Pitch up / climb" },
  { key: "pitchDown", label: "Pitch down / dive" },
  { key: "yawLeft", label: "Yaw left" },
  { key: "yawRight", label: "Yaw right" },
  { key: "lookUp", label: "Look up" },
  { key: "lookDown", label: "Look down" },
  { key: "lookLeft", label: "Look left" },
  { key: "lookRight", label: "Look right" },
  { key: "boost", label: "Burst" },
  { key: "bite", label: "Bite / primary attack" },
];

function ControlsPanel() {
  const { settings, update } = useSettings();
  const [listening, setListening] = useState<keyof Keybinds | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const capture = (which: keyof Keybinds, e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key === "Escape") {
      setListening(null);
      setConflict(null);
      return;
    }
    const code = e.code === "Space" ? "Space" : e.code;
    if (!isBindableKeyCode(code)) return;
    const next = rebindKeybinds(settings.controls.keybinds, which, code);
    if (!next) {
      setConflict(`${keyLabel(code)} is already assigned. Choose another key.`);
      return;
    }
    update("controls", { keybinds: next });
    setConflict(null);
    setListening(null);
  };

  return (
    <div className="stack">
      <p className="settings-note">
        Keyboard is complete: WASD flies, arrows look, and mouse look is optional. Click a binding, then press a unique key. Press Esc to cancel.
      </p>
      <ul className="settings-keybind-list">
        {REBINDABLE.map(({ key, label }) => (
          <li key={key} className="spread">
            <span className="settings-field-label">{label}</span>
            <button
              className={listening === key ? "btn btn--primary" : "btn"}
              aria-label={`${label}: currently ${keyLabel(settings.controls.keybinds[key])}. Activate to rebind.`}
              onClick={() => { setListening(key); setConflict(null); }}
              onKeyDown={(e) => listening === key && capture(key, e)}
            >
              {listening === key ? "Press a key…" : keyLabel(settings.controls.keybinds[key])}
            </button>
          </li>
        ))}
      </ul>
      {conflict && <p className="settings-note" role="alert">{conflict}</p>}
      <Toggle label="Turn assist" hint="Gentler, slower steering." checked={settings.controls.turnAssist} onChange={(v) => update("controls", { turnAssist: v })} />
      <Toggle label="Invert yaw steering" checked={settings.controls.invertSteer} onChange={(v) => update("controls", { invertSteer: v })} />
      <Toggle label="Single-key shortcuts" hint="Press ? to open help. Turn off if a speech or switch device sends stray keys." checked={settings.controls.singleKeyShortcuts} onChange={(v) => update("controls", { singleKeyShortcuts: v })} />
      <Choice
        label="On-screen controls"
        value={settings.controls.touchControls}
        onChange={(v) => update("controls", { touchControls: v })}
        options={[{ v: "auto", l: "Auto (touch devices)" }, { v: "on", l: "Always on" }, { v: "off", l: "Off" }]}
      />
      <Choice
        label="Touch layout"
        value={settings.controls.stickSide}
        onChange={(v) => update("controls", { stickSide: v })}
        options={[{ v: "left", l: "Standard (flight left, look/actions right)" }, { v: "right", l: "Left-handed (flight right, look/actions left)" }]}
      />
    </div>
  );
}

function AccessibilityPanel() {
  const { settings, update, reset } = useSettings();
  const a = settings.a11y;
  return (
    <div className="stack">
      <Choice label="Theme" value={a.theme} onChange={(v) => update("a11y", { theme: v })} options={[{ v: "system", l: "System" }, { v: "dark", l: "Dark" }, { v: "light", l: "Light" }]} />
      <Choice label="Contrast" value={a.contrast} onChange={(v) => update("a11y", { contrast: v })} options={[{ v: "normal", l: "Normal" }, { v: "high", l: "High" }]} />
      <Choice label="Motion" value={a.motion} onChange={(v) => update("a11y", { motion: v })} options={[{ v: "full", l: "Full" }, { v: "reduced", l: "Reduced" }]} />
      <Slider label="Text size" value={a.fontScale} min={0.9} max={1.6} step={0.1} formatValue={(value) => `${Math.round(value * 100)}%`} onChange={(v) => update("a11y", { fontScale: v })} />
      <Toggle label="Show shark name labels" hint="Adds text names above sharks so colors aren't the only cue." checked={a.colorblindLabels} onChange={(v) => update("a11y", { colorblindLabels: v })} />
      <div>
        <button className="btn btn--ghost" onClick={reset}>Reset all settings to defaults</button>
      </div>
    </div>
  );
}
