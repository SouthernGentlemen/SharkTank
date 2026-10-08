// Heads-up display: points, rank, and shark size. Values are
// sampled from the socket snapshot at a low rate (not every frame) to keep the DOM
// cheap. Key changes are announced to screen readers via the announcer.

import { useEffect, useRef, useState } from "react";
import { TICKS_PER_SECOND, roundTicksLeft } from "../../engine/index.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import { useAnnouncer } from "../a11y/announcer.js";
import { audio } from "../audio/AudioManager.js";
import { EAT_STREAK_WINDOW_MS, eatStreakPitch, observeEatStreak, type EatStreakTracker } from "./eatStreak.js";

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
  roundNumber: number;
  roundPhase: "active" | "apex" | "result";
  roundSeconds: number;
}

const SPAWN_LENGTH = 10; // engine START_LENGTH; the baseline a size multiplier is read against

/** Sample the live snapshot ~5×/s for HUD display without per-frame re-renders. */
export function useHudStats(socket: RoomSocket): HudStats {
  const [stats, setStats] = useState<HudStats>({
    points: 0,
    size: 1,
    health: 100,
    rank: 0,
    players: 0,
    alive: false,
    roundNumber: 1,
    roundPhase: "active",
    roundSeconds: 0,
  });
  useEffect(() => {
    const id = setInterval(() => {
      const s = socket.stateRef.current;
      if (!s) return;
      const alive = [...s.sharks].filter((x) => x.alive);
      const me = s.sharks.find((x) => x.id === socket.youId);
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
        roundNumber: s.round.number,
        roundPhase: s.round.phase,
        roundSeconds: Math.ceil(roundTicksLeft(s) / TICKS_PER_SECOND),
      });
    }, 200);
    return () => clearInterval(id);
  }, [socket]);
  return stats;
}

function formatRoundClock(seconds: number): string {
  const safe = Math.max(0, Math.trunc(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function Hud({ socket, reducedMotion }: { socket: RoomSocket; reducedMotion: boolean }) {
  const stats = useHudStats(socket);
  const { announce } = useAnnouncer();
  const lastMilestone = useRef(0);
  const streakTracker = useRef<EatStreakTracker | null>(null);
  const nextGainKey = useRef(0);
  const lastStreakAnnouncementAt = useRef(-Infinity);
  const [gainCue, setGainCue] = useState<{ points: number; streak: number; key: number } | null>(null);

  useEffect(() => {
    const update = () => {
      if (socket.status !== "open") {
        streakTracker.current = null;
        setGainCue((current) => current === null ? current : null);
        return;
      }
      const state = socket.stateRef.current;
      const me = state?.sharks.find((shark) => shark.id === socket.youId);
      if (!state || !me) return;
      const now = performance.now();
      const result = observeEatStreak(streakTracker.current, {
        playerId: me.id, roundNumber: state.round.number,
        tick: state.tick, alive: me.alive, score: me.score,
      }, now);
      streakTracker.current = result.tracker;
      if (!me.alive || state.round.phase === "result") {
        setGainCue((current) => current === null ? current : null);
        return;
      }
      if (result.gain > 0) {
        nextGainKey.current += 1;
        setGainCue({ points: result.gain, streak: result.streak, key: nextGainKey.current });
        audio.playSfx("preyConsume", {
          key: "local-eat", minIntervalMs: 100, pitch: eatStreakPitch(result.streak),
        });
        // Milestone announcements only, never a per-prey live-region stream.
        if (result.streak >= 3 && (result.streak === 3 || result.streak % 5 === 0)
          && now - lastStreakAnnouncementAt.current >= EAT_STREAK_WINDOW_MS) {
          announce(`${result.streak} eat streak.`, "polite");
          lastStreakAnnouncementAt.current = now;
        }
      } else if (now - result.tracker.lastGainAtMs > EAT_STREAK_WINDOW_MS) {
        setGainCue((current) => current === null ? current : null);
      }
    };
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [socket, announce]);

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
      <div className="hud-card hud-card--score">
        <div className="hud-card__label">Points</div>
        <div className="hud-card__value" aria-label={`${stats.points} points`}>{stats.points}</div>
        {gainCue && <span className="hud-eat-streak">×{gainCue.streak} streak</span>}
        {gainCue && !reducedMotion && (
          <span key={gainCue.key} className="hud-score-float" aria-hidden="true">+{gainCue.points}</span>
        )}
      </div>
      <div className={`hud-card hud-card--round${stats.roundPhase === "apex" ? " is-apex" : ""}`}>
        <div className="hud-card__label">Round {stats.roundNumber}</div>
        <div
          className="hud-card__value"
          aria-label={`${stats.roundPhase} phase, ${stats.roundSeconds} seconds remaining`}
        >
          {stats.roundPhase === "apex" ? <span className="hud-card__phase">APEX </span> : null}
          {stats.roundPhase === "result" ? <span className="hud-card__phase">NEXT </span> : null}
          {formatRoundClock(stats.roundSeconds)}
        </div>
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
        Round {stats.roundNumber}, {stats.roundPhase} phase, {stats.roundSeconds} seconds remaining. {stats.points} points, {gainCue ? `${gainCue.streak} eat streak,` : ""} {stats.health} health, size {stats.size.toFixed(1)} times, rank {stats.rank} of {stats.players}.
      </div>
    </div>
  );
}
