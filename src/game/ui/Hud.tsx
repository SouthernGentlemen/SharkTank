// Compact heads-up display and authoritative phase chips. Values are
// sampled from the socket snapshot at a low rate (not every frame) to keep the DOM
// cheap. Key changes are announced to screen readers via the announcer.

import { useEffect, useRef, useState } from "react";
import { FRENZY_RULES, TICKS_PER_SECOND, frenzyTiming, roundTicksLeft, tierForLength, tierProgress } from "../../engine/index.js";
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
  frenzySeconds: number;
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
    frenzySeconds: 0,
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
        frenzySeconds: Math.ceil(frenzyTiming(s).remainingTicks / TICKS_PER_SECOND),
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
  const wasFrenzyOn = useRef(false);
  const [frenzyEnded, setFrenzyEnded] = useState(false);
  const frenzyOn = stats.frenzySeconds > 0;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (frenzyOn && !wasFrenzyOn.current) {
      announce("Feeding frenzy. Converge on the central water column.", "assertive");
      setFrenzyEnded(false);
    } else if (!frenzyOn && wasFrenzyOn.current) {
      announce("Feeding frenzy ended.", "polite");
      setFrenzyEnded(true);
      timer = setTimeout(() => setFrenzyEnded(false), 1800);
    }
    wasFrenzyOn.current = frenzyOn;
    return () => { if (timer) clearTimeout(timer); };
  }, [frenzyOn, announce]);
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

  return <HudReadout stats={stats} gainCue={gainCue} reducedMotion={reducedMotion} frenzyEnded={frenzyEnded} />;
}

/** Pure DOM readout: presentation tests can cover every phase without a live socket. */
export function HudReadout({ stats, gainCue = null, reducedMotion, frenzyEnded = false }: {
  stats: HudStats;
  gainCue?: { points: number; streak: number; key: number } | null;
  reducedMotion: boolean;
  frenzyEnded?: boolean;
}) {
  const length = stats.size * SPAWN_LENGTH;
  const tier = tierForLength(length);
  const progress = tierProgress(length);
  const speedBonus = Math.round((FRENZY_RULES.speedMultiplier - 1) * 100);
  const dashRecharge = Math.round(1 / FRENZY_RULES.dashCooldownMultiplier);
  return (
    <div className="game-hud">
      <div className="hud-bar">
        <div className="hud-metric hud-tier">
          <strong className="hud-tier__badge">{tier}</strong>
          <progress className="hud-tier__progress" value={progress} max={1}
            aria-label={tier === "Megalodon" ? "Megalodon, maximum tier" : `${tier}, ${Math.round(progress * 100)}% to next tier`} />
        </div>
        <div className="hud-metric hud-score">
          <span className="hud-metric__label">Points</span>
          <strong className="hud-metric__value" aria-label={`${stats.points} points`}>{stats.points}</strong>
          {gainCue && !reducedMotion && (
            <span key={gainCue.key} className="hud-score-float" aria-hidden="true">+{gainCue.points}</span>
          )}
        </div>
        <div className="hud-metric">
          <span className="hud-metric__label">{stats.roundPhase === "result" ? "Next" : `Round ${stats.roundNumber}`}</span>
          <strong className="hud-metric__value" aria-label={`${stats.roundPhase} phase, ${stats.roundSeconds} seconds remaining`}>
            {formatRoundClock(stats.roundSeconds)}
          </strong>
        </div>
        <div className="hud-metric">
          <span className="hud-metric__label">Rank</span>
          <strong className="hud-metric__value" aria-label={`Rank ${stats.rank} of ${stats.players}`}>
            {stats.rank || "—"}<span className="hud-metric__sub">/{stats.players}</span>
          </strong>
        </div>
        <div className="hud-metric hud-health">
          <span className="hud-metric__label">HP {stats.health}</span>
          <meter className="hud-health__bar" min={0} max={100} value={stats.health} aria-label="Health" />
        </div>
      </div>
      <div className="hud-status-chips">
        {stats.frenzySeconds > 0 ? (
          <span className="hud-status-chip hud-status-chip--frenzy"
            aria-label={`Feeding Frenzy, ${stats.frenzySeconds} seconds. Central water column, +${speedBonus}% swim speed, dash recharge ${dashRecharge} times.`}>
            FRENZY {stats.frenzySeconds}s
          </span>
        ) : frenzyEnded ? <span className="hud-status-chip">FRENZY ENDED</span> : null}
        {stats.roundPhase === "apex" && <span className="hud-status-chip hud-status-chip--apex">APEX {formatRoundClock(stats.roundSeconds)}</span>}
        {gainCue && <span className="hud-status-chip hud-eat-streak">×{gainCue.streak} streak</span>}
      </div>
      <div className="sr-only" role="status" aria-live="off">
        {/* Snapshot the SRs can query on demand; live milestones go through announce(). */}
        Round {stats.roundNumber}, {stats.roundPhase} phase, {stats.roundSeconds} seconds remaining. {stats.points} points, {gainCue ? `${gainCue.streak} eat streak,` : ""} {stats.health} health, {tier}, size {stats.size.toFixed(1)} times, rank {stats.rank} of {stats.players}.
      </div>
    </div>
  );
}
