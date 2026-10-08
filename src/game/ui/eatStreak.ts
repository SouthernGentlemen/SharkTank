/** Cosmetic consecutive authoritative score-gain samples; no server or wire state. */
export const EAT_STREAK_WINDOW_MS = 1500;

export interface EatStreakSample {
  playerId: string;
  roundNumber: number;
  tick: number;
  alive: boolean;
  score: number;
}
export interface EatStreakTracker extends EatStreakSample {
  streak: number;
  lastGainAtMs: number;
}

export function eatStreakPitch(streak: number): number {
  return 1 + Math.min(7, Math.max(0, Math.floor(streak) - 1)) * 0.08;
}

export function observeEatStreak(
  previous: EatStreakTracker | null,
  sample: EatStreakSample,
  nowMs: number,
): { tracker: EatStreakTracker; gain: number; streak: number } {
  // Repeated or out-of-order snapshots must never produce another score receipt.
  if (previous && sample.playerId === previous.playerId
    && sample.roundNumber === previous.roundNumber && sample.tick <= previous.tick) {
    return { tracker: previous, gain: 0, streak: previous.streak };
  }
  // Joining mid-round, death, respawn, identity/round changes and score rollback
  // establish a fresh baseline. A reconnect also resets the caller's tracker.
  const reset = !previous || previous.playerId !== sample.playerId
    || previous.roundNumber !== sample.roundNumber || !previous.alive || !sample.alive
    || sample.score < previous.score;
  const gain = reset ? 0 : Math.max(0, sample.score - previous.score);
  const inWindow = !reset && nowMs - previous.lastGainAtMs <= EAT_STREAK_WINDOW_MS;
  const streak = gain > 0 ? (inWindow ? previous.streak + 1 : 1) : inWindow ? previous.streak : 0;
  const tracker = {
    ...sample,
    streak,
    lastGainAtMs: gain > 0 ? nowMs : reset ? -Infinity : previous.lastGainAtMs,
  };
  return { tracker, gain, streak };
}
