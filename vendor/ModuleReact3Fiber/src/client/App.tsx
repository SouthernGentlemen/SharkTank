// App shell + screen state machine: Menu → Game, with Customize and Settings
// reachable from the menu. Wraps everything in the Settings + Announcer providers,
// renders the skip link and the #main landmark, keeps player data device-local, and
// manages focus on screen transitions (moving focus to the new screen's region).

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./ui/theme.css";
import { SettingsProvider, useSettings } from "./settings/SettingsContext.js";
import { AnnouncerProvider, useAnnouncer } from "./a11y/announcer.js";
import { MainMenu } from "./ui/MainMenu.js";
import { Customize } from "./ui/Customize.js";
import { Settings } from "./ui/Settings.js";

type Screen = "menu" | "customize" | "settings" | "game";
const GameScreen = lazy(() => import("./ui/GameScreen.js").then((module) => ({ default: module.GameScreen })));
const SHARKTANK_ROOM = { id: "room-1", name: "SharkTank" } as const;

export interface AppProps {
  /** Base URL for the server API. Defaults to same origin. */
  baseUrl?: string;
}

export function App(_props: AppProps = {}) {
  return (
    <SettingsProvider>
      <AnnouncerProvider>
        <Shell />
      </AnnouncerProvider>
    </SettingsProvider>
  );
}

function Shell() {
  const { player, updatePlayer, recordBest } = useSettings();
  const { name, skin, best } = player;
  const { announce } = useAnnouncer();
  const [screen, setScreen] = useState<Screen>("menu");
  const regionRef = useRef<HTMLDivElement>(null);

  // Move focus to the new screen region and announce it (skip menu — it autofocuses Play).
  useEffect(() => {
    if (screen !== "menu" && screen !== "game") regionRef.current?.focus();
    const titles: Record<Screen, string> = {
      menu: "Main menu",
      customize: "Customize",
      settings: "Settings",
      game: "In game",
    };
    announce(titles[screen]);
  }, [screen, announce]);

  const play = useCallback(() => setScreen("game"), []);

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>

      {/* Focusable region wrapper for screen transitions (except game, which is its own <main>). */}
      {screen !== "game" ? (
        <div id="main" ref={regionRef} tabIndex={-1} className="screen-region">
          {screen === "menu" && (
            <MainMenu
              playerName={name}
              skin={skin}
              best={best}
              onPlay={play}
              onCustomize={() => setScreen("customize")}
              onSettings={() => setScreen("settings")}
            />
          )}
          {screen === "customize" && (
            <Customize
              name={name}
              skin={skin}
              onConfirm={(n, sk) => {
                updatePlayer({ name: n, skin: sk });
                setScreen("menu");
              }}
              onExit={() => setScreen("menu")}
            />
          )}
          {screen === "settings" && <SettingsScreen onBack={() => setScreen("menu")} />}
        </div>
      ) : (
        <Suspense fallback={<main id="main" className="center-screen" aria-live="polite">Loading tank…</main>}>
          <GameScreen
            room={SHARKTANK_ROOM}
            identity={{ name: name || "Player", skin }}
            onAuthoritativeResult={recordBest}
            onQuit={() => setScreen("menu")}
          />
        </Suspense>
      )}
    </>
  );
}

/** Full-screen settings with a Back control (menu context). */
function SettingsScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="stack settings-screen">
      <div className="row">
        <button className="btn" onClick={onBack}>← Back</button>
      </div>
      <Settings />
    </div>
  );
}
