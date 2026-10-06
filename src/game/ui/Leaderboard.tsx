// In-game leaderboard (top sharks). Rendered as an accessible ordered list; the
// current player's row is marked with aria-current. Rank changes for the local
// player are announced politely.

import { useEffect, useRef } from "react";
import { SKINS } from "../../engine/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import { useAnnouncer } from "../a11y/announcer.js";

const skinColor = (id: string) => SKINS.find((s) => s.id === id)?.color ?? "#33b679";

export function Leaderboard({ socket }: { socket: RoomSocket }) {
  const { announce } = useAnnouncer();
  const lastRank = useRef<number>(0);
  const entries = socket.leaderboard;
  const round = socket.stateRef.current?.round;
  const apexId = round?.phase === "apex" ? round.apexId : null;

  useEffect(() => {
    const idx = entries.findIndex((e) => e.id === socket.youId);
    const rank = idx >= 0 ? idx + 1 : 0;
    if (rank && rank !== lastRank.current) {
      if (rank <= 3 && (lastRank.current === 0 || rank < lastRank.current)) {
        announce(`You reached rank ${rank}.`);
      }
      lastRank.current = rank;
    }
  }, [entries, socket.youId, announce]);

  return (
    <nav className="game-leaderboard" aria-label="Leaderboard">
      <h2 className="game-leaderboard__heading">Top Sharks</h2>
      <ol className="game-leaderboard__list">
        {entries.length === 0 && <li className="text-muted">Waiting for scores…</li>}
        {entries.map((e, i) => {
          const me = e.id === socket.youId;
          const apex = e.id === apexId;
          const classes = `game-leaderboard__row${me ? " is-me" : ""}${apex ? " is-apex" : ""}`;
          return (
            <li key={e.id} className={classes} aria-current={me ? "true" : undefined}>
              <span className="game-leaderboard__rank">{i + 1}</span>
              <svg className="game-leaderboard__dot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={skinColor(e.skin)} /></svg>
              <span className="game-leaderboard__name">
                {e.name}
                {me && <span className="sr-only"> (you)</span>}
                {apex && (
                  <>
                    <span className="game-leaderboard__apex" aria-hidden="true">APEX</span>
                    <span className="sr-only"> Apex target</span>
                  </>
                )}
              </span>
              <span className="game-leaderboard__score">{e.score}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
