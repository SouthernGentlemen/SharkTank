/** Browser-only tonal score: four minor-key chords, two bars each, eight bars per loop.
 *  Every bar has eight 320 ms steps. Step zero schedules a pad chord; steps
 *  zero and four schedule a gentle bass pulse. All pitches are MIDI notes.
 */
export const SCORE_STEPS_PER_BAR = 8;
export const SCORE_BARS_PER_LOOP = 8;
export const SCORE_CHORDS = [
  { name: "Dm9", bassMidi: 38, padMidi: [50, 53, 57, 64], alternatePadMidi: [53, 57, 62, 64] },
  { name: "Bbmaj7", bassMidi: 34, padMidi: [46, 50, 53, 57], alternatePadMidi: [50, 53, 57, 62] },
  { name: "Gm9", bassMidi: 31, padMidi: [46, 50, 55, 57], alternatePadMidi: [50, 55, 58, 62] },
  { name: "A7", bassMidi: 33, padMidi: [49, 52, 55, 57], alternatePadMidi: [52, 55, 57, 61] },
] as const;

export interface ScoreEvent {
  barIndex: number;
  chordName: string;
  padMidi: readonly number[] | null;
  bassMidi: number | null;
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
  };
}
