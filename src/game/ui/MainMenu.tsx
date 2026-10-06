// Main menu. The landing screen: primary Play action plus Customize and Settings.
// Focus lands on the heading region on mount (handled by App); the Play button is the
// first tab stop. Shows the device-local player name, skin and personal best.

export function MainMenu({
  playerName,
  skin,
  best,
  onPlay,
  onCustomize,
  onSettings,
}: {
  playerName: string;
  skin: string;
  best: number;
  onPlay: () => void;
  onCustomize: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="center-screen">
      <div className="stack shark-menu shark-menu--centered">
        <div className="shark-menu__brand">
          <span className="wizardgang-menu-mark" aria-hidden="true" />
          <div>
            <span>WIZARDGANG</span>
            <h1>Shark Tank</h1>
          </div>
        </div>
        <p className="shark-menu__tagline">Realtime multiplayer Shark Tank</p>

        <div className="panel stack shark-menu__panel">
          <button className="btn btn--primary btn--lg btn--block" onClick={onPlay} autoFocus>Play</button>
          <div className="row row--center">
            <button className="btn btn--block" onClick={onCustomize}>Customize</button>
            <button className="btn btn--block" onClick={onSettings}>Settings</button>
          </div>
          <p className="menu-player-summary">
            {playerName || "Player"} · skin {skin} · best {best}
          </p>
        </div>


      </div>
    </div>
  );
}
