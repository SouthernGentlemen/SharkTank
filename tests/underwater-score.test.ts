import { describe, expect, it } from "vitest";
import {
  SCORE_BARS_PER_LOOP,
  SCORE_CHORDS,
  SCORE_STEPS_PER_BAR,
  midiToHz,
  scoreEventAtStep,
} from "../src/game/audio/underwaterScore.js";
import { MUSIC_LOOKAHEAD_MS, MUSIC_LOOKAHEAD_SECONDS, MUSIC_STEP_SECONDS } from "../src/game/audio/musicScheduler.js";
import { readFileSync } from "node:fs";

describe("ST-276 layered underwater score", () => {
  it("forms eight bars from four ordered minor-key chords, two bars each", () => {
    expect(SCORE_BARS_PER_LOOP).toBe(8);
    expect(SCORE_STEPS_PER_BAR).toBe(8);
    expect(SCORE_CHORDS.map(({ name }) => name)).toEqual(["Dm9", "Bbmaj7", "Gm9", "A7"]);
    expect(SCORE_BARS_PER_LOOP * SCORE_STEPS_PER_BAR * MUSIC_STEP_SECONDS).toBeCloseTo(20.48);
    expect(Array.from({ length: 8 }, (_, bar) => scoreEventAtStep(bar * 8)?.chordName)).toEqual([
      "Dm9", "Dm9", "Bbmaj7", "Bbmaj7", "Gm9", "Gm9", "A7", "A7",
    ]);
    expect(scoreEventAtStep(64)).toEqual(scoreEventAtStep(0));
    expect(scoreEventAtStep(127)).toEqual(scoreEventAtStep(63));
    expect(scoreEventAtStep(-1)).toBeNull();
    expect(scoreEventAtStep(0.5)).toBeNull();
    expect(scoreEventAtStep(Infinity)).toBeNull();
  });

  it("varies the pad voicing on the second bar without changing chord identity", () => {
    for (let chord = 0; chord < 4; chord++) {
      const first = scoreEventAtStep(chord * 16);
      const second = scoreEventAtStep(chord * 16 + 8);
      expect(first?.chordName).toBe(second?.chordName);
      expect(first?.padMidi).toHaveLength(4);
      expect(second?.padMidi).toHaveLength(4);
      expect(first?.padMidi).not.toEqual(second?.padMidi);
    }
  });

  it("bounds pad and bass voice ranges and emits no notes on intervening steps", () => {
    const padNotes: number[] = [];
    const bassNotes: number[] = [];
    let padEvents = 0;
    let bassEvents = 0;
    for (let step = 0; step < 64; step++) {
      const event = scoreEventAtStep(step);
      expect(event).not.toBeNull();
      if (event?.padMidi) {
        padEvents++;
        expect(step % 8).toBe(0);
        padNotes.push(...event.padMidi);
      }
      if (event?.bassMidi !== null && event?.bassMidi !== undefined) {
        bassEvents++;
        expect([0, 4]).toContain(step % 8);
        bassNotes.push(event.bassMidi);
      }
    }
    expect(padEvents).toBe(8);
    expect(bassEvents).toBe(16);
    expect(padNotes.every((note) => note >= 46 && note <= 64)).toBe(true);
    expect(bassNotes.every((note) => note >= 31 && note <= 50)).toBe(true);
    expect(Math.min(...padNotes.map(midiToHz))).toBeGreaterThan(100);
    expect(Math.max(...padNotes.map(midiToHz))).toBeLessThan(350);
    expect(Math.min(...bassNotes.map(midiToHz))).toBeGreaterThanOrEqual(49 - 0.001);
    expect(Math.max(...bassNotes.map(midiToHz))).toBeLessThan(150);
  });

  it("keeps pad/bass independently gain-staged and on the existing audio-clock lookahead", () => {
    const source = readFileSync(new URL("../src/game/audio/AudioManager.ts", import.meta.url), "utf8");
    expect(source).toContain("scoreEventAtStep(step)");
    expect(source).toContain("this.scheduleMusicPad(event.padMidi, at)");
    expect(source).toContain("this.scheduleMusicBass(event.bassMidi, at)");
    expect(source).toContain("this.musicPadGain.gain.value = 0.58");
    expect(source).toContain("this.musicBassGain.gain.value = 0.42");
    expect(source).toContain('filter.type = "lowpass"');
    expect(source).toContain("osc.detune.value = detune");
    expect(source).not.toContain("const MELODY");
    expect(source).not.toContain("this.drone");
    expect(source).toContain("for (const note of [...this.musicNotes]) note.stop()");
    expect(MUSIC_LOOKAHEAD_MS).toBe(25);
    expect(MUSIC_LOOKAHEAD_SECONDS).toBe(0.1);
  });
});
