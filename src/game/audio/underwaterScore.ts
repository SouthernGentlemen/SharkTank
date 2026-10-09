/** Browser-only tonal score, eight 320 ms steps per bar and eight bars per loop.
 *  Four minor-key chords repeat over two bars each. Pads, bass, optional
 *  percussion and sparse lead all share the same audio-clock step phase.
 */
export const SCORE_STEPS_PER_BAR = 8;
export const SCORE_BARS_PER_LOOP = 8;
export const SCORE_CHORDS = [
  { name: "Dm9", bassMidi: 38, padMidi: [50, 53, 57, 64], alternatePadMidi: [53, 57, 62, 64] },
  { name: "Bbmaj7", bassMidi: 34, padMidi: [46, 50, 53, 57], alternatePadMidi: [50, 53, 57, 62] },
  { name: "Gm9", bassMidi: 31, padMidi: [46, 50, 55, 57], alternatePadMidi: [50, 55, 58, 62] },
  { name: "A7", bassMidi: 33, padMidi: [49, 52, 55, 57], alternatePadMidi: [52, 55, 57, 61] },
] as const;

export type PercussionHit = "kick" | "shaker";

/** The restrained base groove; ST-278 can build faster intensity variations. */
export const SCORE_PERCUSSION_PATTERN: readonly (PercussionHit | null)[] = [
  "kick", null, "shaker", null, "kick", null, "shaker", null,
];

/** One- or two-note answers per bar, using chord tones and a C-sharp on A7. */
export const SCORE_LEAD_MOTIF: readonly (readonly (number | null)[])[] = [
  [null, 69, null, null, null, 72, null, null],
  [null, null, null, 76, null, null, null, null],
  [null, 69, null, null, null, 74, null, null],
  [null, null, null, 77, null, null, null, null],
  [null, 70, null, null, null, 74, null, null],
  [null, null, null, 77, null, null, null, null],
  [null, 73, null, null, null, 76, null, null],
  [null, null, null, 79, null, null, null, 76],
];

export interface ScoreEvent {
  barIndex: number;
  chordName: string;
  padMidi: readonly number[] | null;
  bassMidi: number | null;
  percussionHit: PercussionHit | null;
  leadMidi: number | null;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A pure clock-step lookup; large skipped step indexes retain musical phase. */
export function scoreEventAtStep(step: number): ScoreEvent | null {
  if (!Number.isSafeInteger(step) || step < 0) return null;
  const position = step % SCORE_STEPS_PER_BAR;
  const barIndex = Math.floor(step / SCORE_STEPS_PER_BAR) % SCORE_BARS_PER_LOOP;
  const chord = SCORE_CHORDS[Math.floor(barIndex / 2)];
  return {
    barIndex,
    chordName: chord.name,
    padMidi: position === 0
      ? (barIndex % 2 === 0 ? chord.padMidi : chord.alternatePadMidi)
      : null,
    bassMidi: position === 0 ? chord.bassMidi : position === 4 ? chord.bassMidi + 12 : null,
    percussionHit: SCORE_PERCUSSION_PATTERN[position],
    leadMidi: SCORE_LEAD_MOTIF[barIndex][position],
  };
}
