// Systems-menu state: graphics / audio / controls / accessibility. Single source of
// truth, persisted to localStorage and mirrored onto <html> data-attributes so the
// theme.css tokens react (contrast, motion, font-scale, theme). Game input and the
// renderer read the same object, so a settings change takes effect live.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SKIN, SKINS } from "../../engine/index.js";
import { sanitizeDisplayName } from "../../protocol/name-policy.js";

export interface Keybinds {
  pitchUp: string;
  pitchDown: string;
  yawLeft: string;
  yawRight: string;
  lookUp: string;
  lookDown: string;
  lookLeft: string;
  lookRight: string;
  boost: string;
  bite: string;
  pause: string;
}

export const DEFAULT_KEYBINDS: Keybinds = {
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
};

const KEYBIND_KEYS = Object.keys(DEFAULT_KEYBINDS) as Array<keyof Keybinds>;
const MODIFIER_CODES = new Set([
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);

export function isBindableKeyCode(code: string): boolean {
  return code.trim().length > 0 && !MODIFIER_CODES.has(code);
}

export function normalizeKeybinds(saved: Partial<Keybinds> | Record<string, unknown> | null | undefined): Keybinds {
  const merged: Keybinds = { ...DEFAULT_KEYBINDS };
  if (saved && typeof saved === "object") {
    for (const key of KEYBIND_KEYS) {
      const value = saved[key];
      if (typeof value === "string" && isBindableKeyCode(value)) merged[key] = value;
    }
  }
  const seen = new Set<string>();
  for (const key of KEYBIND_KEYS) {
    if (seen.has(merged[key])) return { ...DEFAULT_KEYBINDS };
    seen.add(merged[key]);
  }
  return merged;
}

export function rebindKeybinds(current: Keybinds, key: keyof Keybinds, code: string): Keybinds | null {
  if (!isBindableKeyCode(code)) return null;
  for (const other of KEYBIND_KEYS) {
    if (other !== key && current[other] === code) return null;
  }
  return { ...current, [key]: code };
}

export interface Settings {
  graphics: {
    quality: "low" | "medium" | "high";
    showMinimap: boolean;
    showGrid: boolean;
    cameraShake: boolean;
  };
  audio: {
    master: number; // 0..1
    sfx: number;
    music: number;
    captions: boolean; // show captions for audio cues (a11y)
  };
  controls: {
    keybinds: Keybinds;
    turnAssist: boolean; // gentler steering — accessibility aid
    invertSteer: boolean;
    /** Independent on-screen flight/look sticks plus ability pads. "auto" follows (pointer: coarse). */
    touchControls: "auto" | "on" | "off";
    /** Physical side of the flight stick. The look stick/actions mirror to the opposite side. */
    stickSide: "right" | "left";
    /**
     * Single-key shortcuts (currently "?" for help). WCAG 2.1.4 requires a single-character
     * shortcut to be switchable, remappable, or focus-scoped — this is the off switch.
     */
    singleKeyShortcuts: boolean;
  };
  a11y: {
    theme: "system" | "dark" | "light";
    contrast: "normal" | "high";
    motion: "full" | "reduced";
    fontScale: number; // 0.9..1.6
    colorblindLabels: boolean; // show skin name labels above sharks
  };
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: { quality: "high", showMinimap: true, showGrid: true, cameraShake: true },
  // BGM is opt-in (0) so nothing autoplays unexpectedly; SFX are brief + event-driven.
  audio: { master: 0.8, sfx: 0.9, music: 0, captions: false },
  controls: {
    keybinds: { ...DEFAULT_KEYBINDS },
    turnAssist: false,
    invertSteer: false,
    touchControls: "auto",
    stickSide: "left",
    singleKeyShortcuts: true,
  },
  a11y: { theme: "system", contrast: "normal", motion: "full", fontScale: 1, colorblindLabels: true },
};

const STORAGE_KEY = "sharktank.player.v1";
const LEGACY_SETTINGS_KEY = "snakeio.settings.v1";

export interface DevicePlayer {
  name: string;
  skin: string;
  best: number;
}

interface DevicePlayerData extends DevicePlayer {
  settings: Settings;
}

interface SettingsApi {
  settings: Settings;
  player: DevicePlayer;
  /** Patch a nested section, e.g. update("audio", { master: 0.5 }). */
  update: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => void;
  reset: () => void;
  updatePlayer: (patch: Partial<DevicePlayer>) => void;
  recordBest: (score: number) => void;
}

const Ctx = createContext<SettingsApi | null>(null);
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function systemPrefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function systemMotion(): Settings["a11y"]["motion"] {
  return systemPrefersReducedMotion() ? "reduced" : "full";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStorage(key: string): Record<string, unknown> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return record(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSettings(value: unknown): Settings {
  const parsed = record(value) ? value as Partial<Settings> : {};
  const controls = record(parsed.controls) ? parsed.controls as Partial<Settings["controls"]> : {};
  const cleanBinds = normalizeKeybinds(
    (controls.keybinds ?? {}) as Partial<Keybinds> | Record<string, unknown>,
  );
  return {
    graphics: { ...DEFAULT_SETTINGS.graphics, ...(record(parsed.graphics) ? parsed.graphics : {}) },
    audio: { ...DEFAULT_SETTINGS.audio, ...(record(parsed.audio) ? parsed.audio : {}) },
    controls: {
      ...DEFAULT_SETTINGS.controls,
      ...controls,
      keybinds: cleanBinds,
    },
    a11y: {
      ...DEFAULT_SETTINGS.a11y,
      motion: record(parsed.a11y) && typeof parsed.a11y.motion === "string"
        ? parsed.a11y.motion
        : systemMotion(),
      ...(record(parsed.a11y) ? parsed.a11y : {}),
    },
  };
}

function validSkin(value: unknown): value is string {
  return typeof value === "string" && SKINS.some((skin) => skin.id === value);
}

function normalizeBest(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function loadData(): DevicePlayerData {
  const current = readStorage(STORAGE_KEY);
  if (current) {
    return {
      name: typeof current.name === "string" ? sanitizeDisplayName(current.name) : "Player",
      skin: validSkin(current.skin) ? current.skin : DEFAULT_SKIN,
      best: normalizeBest(current.best),
      settings: normalizeSettings(current.settings),
    };
  }

  // Migrate the pre-ST-142 settings-only record into the unified device record.
  const legacy = readStorage(LEGACY_SETTINGS_KEY);
  return {
    name: "Player",
    skin: DEFAULT_SKIN,
    best: 0,
    settings: normalizeSettings(legacy),
  };
}

function motionWasChosen(): boolean {
  const current = readStorage(STORAGE_KEY);
  const currentSettings = current && record(current.settings) ? current.settings : null;
  const currentA11y = currentSettings && record(currentSettings.a11y) ? currentSettings.a11y : null;
  if (currentA11y && typeof currentA11y.motion === "string") return true;

  const legacy = readStorage(LEGACY_SETTINGS_KEY);
  const legacyA11y = legacy && record(legacy.a11y) ? legacy.a11y : null;
  return Boolean(legacyA11y && typeof legacyA11y.motion === "string");
}

function defaultData(): DevicePlayerData {
  return {
    name: "Player",
    skin: DEFAULT_SKIN,
    best: 0,
    settings: {
      ...DEFAULT_SETTINGS,
      graphics: { ...DEFAULT_SETTINGS.graphics },
      audio: { ...DEFAULT_SETTINGS.audio },
      controls: { ...DEFAULT_SETTINGS.controls, keybinds: { ...DEFAULT_KEYBINDS } },
      a11y: { ...DEFAULT_SETTINGS.a11y, motion: systemMotion() },
    },
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DevicePlayerData>(() =>
    typeof localStorage === "undefined" ? defaultData() : loadData(),
  );

  const motionChosen = useRef(motionWasChosen());
  useEffect(() => {
    if (motionChosen.current) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => {
      if (motionChosen.current) return;
      setData((prev) => {
        const next = query.matches ? "reduced" : "full";
        return prev.settings.a11y.motion === next
          ? prev
          : { ...prev, settings: { ...prev.settings, a11y: { ...prev.settings.a11y, motion: next } } };
      });
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // One device-local record owns player identity, best score and all settings.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.removeItem(LEGACY_SETTINGS_KEY);
    } catch {
      /* storage may be unavailable; non-fatal */
    }
    const html = document.documentElement;
    const { theme, contrast, motion, fontScale } = data.settings.a11y;
    if (theme === "system") html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", theme);
    html.setAttribute("data-contrast", contrast === "high" ? "high" : "normal");
    html.setAttribute("data-motion", motion === "reduced" ? "reduced" : "full");
    html.setAttribute("data-font-scale", String(Math.max(9, Math.min(16, Math.round(fontScale * 10)))));
  }, [data]);

  const update = useCallback(<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
    if (section === "a11y" && "motion" in (patch as Partial<Settings["a11y"]>)) motionChosen.current = true;
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, [section]: { ...prev.settings[section], ...patch } },
    }));
  }, []);

  const reset = useCallback(() => {
    motionChosen.current = false;
    setData((prev) => ({ ...prev, settings: defaultData().settings }));
  }, []);

  const updatePlayer = useCallback((patch: Partial<DevicePlayer>) => {
    setData((prev) => ({
      ...prev,
      ...(patch.name !== undefined ? { name: sanitizeDisplayName(patch.name) } : {}),
      ...(patch.skin !== undefined && validSkin(patch.skin) ? { skin: patch.skin } : {}),
      ...(patch.best !== undefined ? { best: normalizeBest(patch.best) } : {}),
    }));
  }, []);

  const recordBest = useCallback((score: number) => {
    if (!Number.isFinite(score)) return;
    const next = normalizeBest(score);
    setData((prev) => next > prev.best ? { ...prev, best: next } : prev);
  }, []);

  const player = useMemo<DevicePlayer>(
    () => ({ name: data.name, skin: data.skin, best: data.best }),
    [data.name, data.skin, data.best],
  );
  const api = useMemo(
    () => ({ settings: data.settings, player, update, reset, updatePlayer, recordBest }),
    [data.settings, player, update, reset, updatePlayer, recordBest],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsApi {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSettings must be used within <SettingsProvider>");
  return value;
}

/** Human-readable label for a KeyboardEvent.code/key used in keybind UIs. */
export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Arrow")) return code.replace("Arrow", "") + " Arrow";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
