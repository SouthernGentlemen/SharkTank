// Deterministic, serializable RNG.
// Inspired by the seeded RNG from the previous iteration (blackjack shoe shuffle):
// same seed + same action sequence => same state. Enables server authority + replay.

/** Hash a string seed into a 32-bit unsigned integer (FNV-1a, as in the old engine). */
export function seedToNumber(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Pure mulberry32 step. Takes the current numeric RNG state, returns
 * [value in [0,1), nextState]. Keep `nextState` in your serializable game state
 * so the whole simulation stays deterministic and replayable.
 */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) | 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [value, t];
}
