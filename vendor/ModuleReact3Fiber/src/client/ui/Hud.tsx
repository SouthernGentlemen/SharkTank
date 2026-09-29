// Heads-up display: points, rank, and shark size. Values are
// sampled from the socket snapshot at a low rate (not every frame) to keep the DOM
// cheap. Key changes are announced to screen readers via the announcer.

import { useEffect, useRef, useState } from "react";
import type { RoomSocket } from "../net/useRoomSocket.js";
import { useAnnouncer } from "../a11y/announcer.js";

export interface HudStats {
  /** Points scored this life — the number the leaderboard ranks on. */
  points: number;
  /** How big the shark has grown, as a multiple of its spawn size. */
  size: number;
  /** Authoritative combat health, 0..100. */
  health: number;
  rank: number;
  players: number;
  alive: boolean;
}

const SPAWN_LENGTH = 10; // engine START_LENGTH; the baseline a size multiplier is read against

/** Sample the live snapshot ~5×/s for HUD display without per-frame re-renders. */
export function useHudStats(socket: RoomSocket): HudStats {
  const [stats, setStats] = useState<HudStats>({ points: 0, size: 1, health: 100, rank: 0, players: 0, alive: false });
  useEffect(() => {
    const id = setInterval(() => {
      const s = socket.stateRef.current;
      if (!s) return;
      const alive = [...s.snakes].filter((x) => x.alive);
      const me = s.snakes.find((x) => x.id === socket.youId);
      // Rank among the living, so rank is always within 1..players.
      const ranked = alive.sort((a, b) => b.score - a.score);
      const rank = me?.alive ? ranked.findIndex((x) => x.id === me.id) + 1 : 0;
      setStats({
        points: me?.score ?? 0,
        size: Math.max(1, (me?.length ?? SPAWN_LENGTH) / SPAWN_LENGTH),
        health: me?.health ?? 0,
        rank,
        players: alive.length,
        alive: me?.alive ?? false,
      });
    }, 200);
    return () => clearInterval(id);
  }, [socket]);
  return stats;
}

export function Hud({ socket }: { socket: RoomSocket }) {
  const stats = useHudStats(socket);
  const { announce } = useAnnouncer();
  const lastMilestone = useRef(0);

  // Announce every +25 points as a polite status.
  useEffect(() => {
    const milestone = Math.floor(stats.points / 25);
    if (milestone > lastMilestone.current && stats.points > 0) {
      lastMilestone.current = milestone;
      announce(`${stats.points} points, rank ${stats.rank} of ${stats.players}.`);
    }
  }, [stats.points, stats.rank, stats.players, announce]);

  return (
    <div className="game-hud" aria-hidden={false}>
      <div className="hud-card">
        <div className="hud-card__label">Points</div>
        <div className="hud-card__value" aria-label={`${stats.points} points`}>{stats.points}</div>
      </div>
      <div className="hud-card">
        <div className="hud-card__label">Rank</div>
        <div className="hud-card__value">
          {stats.rank || "—"}
          <span className="hud-card__sub"> / {stats.players}</span>
        </div>
      </div>
      <div className="hud-card">
        <div className="hud-card__label">Size</div>
        <div className="hud-card__value">{stats.size.toFixed(1)}<span className="hud-card__sub">×</span></div>
      </div>
      <div className="hud-card">
        <div className="hud-card__label">Health</div>
        <div className="hud-card__value" aria-label={`${stats.health} health`}>{stats.health}<span className="hud-card__sub"> / 100</span></div>
      </div>
      <div className="sr-only" role="status" aria-live="off">
        {/* Snapshot the SRs can query on demand; live milestones go through announce(). */}
        {stats.points} points, {stats.health} health, size {stats.size.toFixed(1)} times, rank {stats.rank} of {stats.players}.
      </div>
    </div>
  );
}
