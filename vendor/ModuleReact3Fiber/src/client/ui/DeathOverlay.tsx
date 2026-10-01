// Respawn card, shown when the local shark dies.
//
// Deliberately NOT a modal. Being dead is not a dialog you are trapped in: you still
// need the tools rail to mute the music, open settings, or leave the tank while the
// respawn timer runs. So the scrim is click-through, the card itself is the only thing
// that takes pointer events, and there is no focus trap — focus is placed on Respawn
// (the primary action) and Tab walks out of the card normally. It is still announced
// assertively, while the always-reachable tools rail keeps the explicit exit action available.

import { useEffect, useRef, useState } from "react";
import { useAnnouncer } from "../a11y/announcer.js";
import type { DeathInfo } from "../net/useRoomSocket.js";

export function DeathOverlay({
  death,
  onRespawn,
  onQuit,
}: {
  death: DeathInfo;
  onRespawn: () => void;
  onQuit: () => void;
}) {
  const respawnRef = useRef<HTMLButtonElement>(null);
  const { announce } = useAnnouncer();
  const [remaining, setRemaining] = useState(Math.ceil(death.respawnInMs / 1000));

  const cause = death.action === "bite"
    ? death.by ? `Bitten by ${death.by}.` : "Defeated by a bite."
    : death.action === "boundary"
      ? "You crossed the arena boundary."
      : death.action === "retire"
        ? "This shark retired from the round."
        : "Shark eliminated.";

  useEffect(() => {
    announce(`${cause} Final score ${death.score} points.`, "assertive");
  }, [cause, death.score, announce]);

  useEffect(() => {
    const end = death.at + death.respawnInMs;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      setRemaining(left);
      if (left <= 0) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [death]);

  const ready = remaining <= 0;

  // Move focus to Respawn as soon as it becomes usable, so a keyboard player can come
  // straight back with Enter without hunting for the button.
  useEffect(() => {
    if (ready) respawnRef.current?.focus();
  }, [ready]);

  return (
    <div className="scrim scrim--respawn">
      <div
        className="panel stack respawn-card"
        role="dialog"
        aria-labelledby="death-title"
        aria-describedby="death-desc"
      >
        <h2 id="death-title">Shark eliminated</h2>
        <p id="death-desc">
          {cause} <strong>{death.score}</strong> points this life.
        </p>
        <div className="stack">
          <button ref={respawnRef} className="btn btn--primary btn--lg btn--block" onClick={onRespawn} disabled={!ready}>
            {ready ? "Respawn" : `Respawn in ${remaining}…`}
          </button>
          <button className="btn btn--block" onClick={onQuit}>
            Quit to tank
          </button>
        </div>
        <p className="respawn-note">The tools below stay live while you wait.</p>
      </div>
    </div>
  );
}
