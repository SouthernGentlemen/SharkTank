/** Client-only tier celebrations; authoritative length is never written back. */
import { SHARK_TIERS, tierForLength, type SharkTier } from "../../engine/growth.js";

export interface EvolutionSample {
  playerId: string;
  roundNumber: number;
  tick: number;
  alive: boolean;
  length: number;
  score: number;
}

export interface EvolutionTracker {
  playerId: string;
  roundNumber: number;
  tick: number;
  alive: boolean;
  score: number;
  highestTier: number;
}

export function detectEvolution(
  previous: EvolutionTracker | null,
  sample: EvolutionSample,
): { tracker: EvolutionTracker; evolved: SharkTier | null } {
  // A late packet must not rewind progress and replay a celebration.
  if (previous && previous.playerId === sample.playerId
    && previous.roundNumber === sample.roundNumber && sample.tick < previous.tick) {
    return { tracker: previous, evolved: null };
  }

  const index = SHARK_TIERS.findIndex((tier) => tier.name === tierForLength(sample.length));
  // The first snapshot, next round, dead frame and first respawn/reconnect
  // snapshot are baselines, never evidence of a new tier crossing.
  const newLife = !previous || previous.playerId !== sample.playerId
    || previous.roundNumber !== sample.roundNumber || !previous.alive
    || !sample.alive || sample.score < previous.score;
  const highestTier = newLife ? index : Math.max(previous.highestTier, index);
  const evolved = !newLife && index > previous.highestTier
    ? SHARK_TIERS[index].name : null;
  return {
    tracker: {
      playerId: sample.playerId,
      roundNumber: sample.roundNumber,
      tick: sample.tick,
      alive: sample.alive,
      score: sample.score,
      highestTier,
    },
    evolved,
  };
}
