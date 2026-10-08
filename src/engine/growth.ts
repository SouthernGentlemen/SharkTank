/** Authoritative, round-local length milestones. No new wire fields or client authority. */
export const SHARK_TIERS = [
  { name: "Pup", minLength: 10 },
  { name: "Reef Shark", minLength: 22 },
  { name: "Tiger Shark", minLength: 44 },
  { name: "Great White", minLength: 78 },
  { name: "Megalodon", minLength: 112 },
] as const;

export type SharkTier = (typeof SHARK_TIERS)[number]["name"];

function safeLength(length: number): number {
  return Number.isFinite(length) ? Math.max(0, length) : 0;
}

/** Current milestone, inclusive at its minimum length. */
export function tierForLength(length: number): SharkTier {
  const value = safeLength(length);
  for (let index = SHARK_TIERS.length - 1; index > 0; index -= 1) {
    if (value >= SHARK_TIERS[index].minLength) return SHARK_TIERS[index].name;
  }
  return SHARK_TIERS[0].name;
}

/** Normalized progress to the next milestone; completed at Megalodon. */
export function tierProgress(length: number): number {
  const value = safeLength(length);
  for (let index = 0; index < SHARK_TIERS.length - 1; index += 1) {
    const current = SHARK_TIERS[index].minLength;
    const next = SHARK_TIERS[index + 1].minLength;
    if (value < next) return Math.max(0, Math.min(1, (value - current) / (next - current)));
  }
  return 1;
}
