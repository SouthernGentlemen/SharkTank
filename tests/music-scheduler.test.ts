import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MUSIC_LOOKAHEAD_MS,
  MUSIC_LOOKAHEAD_SECONDS,
  MUSIC_STEP_SECONDS,
  MusicLookaheadScheduler,
} from "../src/game/audio/musicScheduler.js";

afterEach(() => vi.useRealTimers());

describe("ST-275 audio-clock music lookahead", () => {
  it("wakes every 25 ms but schedules the six-step melody on the audio clock 100 ms ahead", () => {
    vi.useFakeTimers();
    let audioTime = 0;
    const notes: { step: number; at: number }[] = [];
    const scheduler = new MusicLookaheadScheduler(
      () => audioTime,
      () => true,
      (step, at) => notes.push({ step, at }),
    );
    scheduler.start();
    expect(MUSIC_LOOKAHEAD_MS).toBe(25);
    expect(MUSIC_LOOKAHEAD_SECONDS).toBe(0.1);
    expect(MUSIC_STEP_SECONDS).toBe(0.32);
    expect(notes).toEqual([]);

    audioTime = 0.219;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([]);
    audioTime = 0.22;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([{ step: 0, at: 0.32 }]);
    audioTime = 0.40;
    vi.advanceTimersByTime(25);
    expect(notes).toHaveLength(1);
    audioTime = 0.54;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([
      { step: 0, at: 0.32 },
      { step: 1, at: 0.64 },
    ]);
    scheduler.stop();
  });

  it("does not consume steps during audio suspension and resumes without a catch-up burst", () => {
    vi.useFakeTimers();
    let audioTime = 0;
    let running = true;
    const notes: { step: number; at: number }[] = [];
    const scheduler = new MusicLookaheadScheduler(
      () => audioTime,
      () => running,
      (step, at) => notes.push({ step, at }),
    );
    scheduler.start();
    running = false;
    audioTime = 0.23;
    vi.advanceTimersByTime(1000);
    expect(notes).toEqual([]);
    running = true;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([{ step: 0, at: 0.32 }]);
    audioTime = 0.55;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([{ step: 0, at: 0.32 }, { step: 1, at: 0.64 }]);
    scheduler.stop();
  });

  it("skips notes missed by a throttled wake, scheduling only future onsets", () => {
    vi.useFakeTimers();
    let audioTime = 0;
    const notes: { step: number; at: number }[] = [];
    const scheduler = new MusicLookaheadScheduler(
      () => audioTime,
      () => true,
      (step, at) => notes.push({ step, at }),
    );
    scheduler.start();
    audioTime = 10;
    vi.advanceTimersByTime(25);
    expect(notes).toEqual([]);
    audioTime = 10.18;
    vi.advanceTimersByTime(25);
    expect(notes).toHaveLength(1);
    expect(notes[0].step).toBe(31);
    expect(notes[0].at).toBeCloseTo(10.24);
    expect(notes[0].at).toBeGreaterThanOrEqual(audioTime);
    expect(notes[0].at).toBeLessThanOrEqual(audioTime + MUSIC_LOOKAHEAD_SECONDS);
    scheduler.stop();
  });

  it("is idempotent on start, cancels its timer on stop and restarts at step zero", () => {
    vi.useFakeTimers();
    let audioTime = 0.22;
    const notes: { step: number; at: number }[] = [];
    const scheduler = new MusicLookaheadScheduler(
      () => audioTime,
      () => true,
      (step, at) => notes.push({ step, at }),
    );
    scheduler.start();
    scheduler.start();
    expect(vi.getTimerCount()).toBe(1);
    scheduler.stop();
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    audioTime = 1;
    vi.advanceTimersByTime(500);
    expect(notes).toEqual([]);
    scheduler.start();
    audioTime = 1.22;
    vi.advanceTimersByTime(25);
    expect(notes).toHaveLength(1);
    expect(notes[0].step).toBe(0);
    expect(notes[0].at).toBeCloseTo(1.32);
    scheduler.stop();
  });
});
