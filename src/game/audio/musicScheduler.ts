/**
 * Drive the existing melody from AudioContext.currentTime rather than the
 * non-realtime timer. The timer only wakes the scheduler; it is never the note
 * onset clock. No note is scheduled more than 100 ms into the future.
 */
export const MUSIC_STEP_SECONDS = 0.32;
export const MUSIC_LOOKAHEAD_MS = 25;
export const MUSIC_LOOKAHEAD_SECONDS = 0.1;

export class MusicLookaheadScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteAt = 0;
  private step = 0;

  constructor(
    private readonly currentTime: () => number,
    private readonly isRunning: () => boolean,
    private readonly scheduleNote: (step: number, at: number) => void,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    // Preserve the original first-note delay and six-step order.
    this.nextNoteAt = this.currentTime() + MUSIC_STEP_SECONDS;
    this.step = 0;
    this.timer = setInterval(() => this.pump(), MUSIC_LOOKAHEAD_MS);
    this.pump();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.step = 0;
  }

  private pump(): void {
    if (this.timer === null || !this.isRunning()) return;
    const now = this.currentTime();
    if (!Number.isFinite(now)) return;

    // A throttled tab must not play a burst of old notes on the next wake.
    // Preserve the musical step/phase while skipping missed onsets.
    if (this.nextNoteAt < now) {
      const missed = Math.ceil((now - this.nextNoteAt) / MUSIC_STEP_SECONDS);
      this.nextNoteAt += missed * MUSIC_STEP_SECONDS;
      this.step += missed;
    }
    while (this.nextNoteAt <= now + MUSIC_LOOKAHEAD_SECONDS) {
      this.scheduleNote(this.step, this.nextNoteAt);
      this.nextNoteAt += MUSIC_STEP_SECONDS;
      this.step += 1;
    }
  }
}
