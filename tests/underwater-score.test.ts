import { describe, expect, it } from "vitest";
import {
  SCORE_BARS_PER_LOOP,
  SCORE_CHORDS,
  SCORE_LEAD_MOTIF,
  SCORE_PERCUSSION_PATTERN,
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

describe("ST-277 percussion and lead pattern", () => {
  it("aligns filtered-noise kick and shaker to the eight-step audio-clock grid", () => {
    expect(SCORE_PERCUSSION_PATTERN).toEqual([
      "kick", null, "shaker", null, "kick", null, "shaker", null,
    ]);
    const hits = Array.from({ length: 64 }, (_, step) => scoreEventAtStep(step)?.percussionHit);
    expect(hits.filter((hit) => hit === "kick")).toHaveLength(16);
    expect(hits.filter((hit) => hit === "shaker")).toHaveLength(16);
    for (let step = 0; step < 64; step++) {
      expect(hits[step]).toBe(SCORE_PERCUSSION_PATTERN[step % 8]);
    }
    expect(scoreEventAtStep(64)?.percussionHit).toBe(hits[0]);
  });

  it("uses a sparse, harmonic eight-bar motif that loops without drifting", () => {
    expect(SCORE_LEAD_MOTIF).toHaveLength(SCORE_BARS_PER_LOOP);
    const expected = [69, 72, 76, 69, 74, 77, 70, 74, 77, 73, 76, 79, 76];
    const notes = Array.from({ length: 64 }, (_, step) => scoreEventAtStep(step)?.leadMidi)
      .filter((midi): midi is number => midi !== null && midi !== undefined);
    expect(notes).toEqual(expected);
    expect(notes.every((midi) => midi >= 69 && midi <= 79)).toBe(true);
    expect(notes).toHaveLength(13);
    for (let step = 0; step < 64; step++) {
      expect(scoreEventAtStep(step)?.leadMidi).toBe(SCORE_LEAD_MOTIF[Math.floor(step / 8)][step % 8]);
      expect(scoreEventAtStep(step + 64)).toEqual(scoreEventAtStep(step));
    }
  });

  it("routes optional layers separately from pads, bass, SFX and music master", () => {
    const source = readFileSync(new URL("../src/game/audio/AudioManager.ts", import.meta.url), "utf8");
    expect(source).toContain("this.musicPercussionGain = ctx.createGain()");
    expect(source).toContain("this.musicLeadGain = ctx.createGain()");
    expect(source).toContain("this.musicPercussionGain.gain.value = 0");
    expect(source).toContain("this.musicLeadGain.gain.value = 0");
    expect(source).toContain("this.musicPercussionGain.connect(this.musicGain)");
    expect(source).toContain("this.musicLeadGain.connect(this.musicGain)");
    expect(source).toContain("ctx.createBufferSource()");
    expect(source).toContain('kick ? "lowpass" : "highpass"');
    expect(source).toContain("this.scheduleMusicPercussion(event.percussionHit, at)");
    expect(source).toContain('this.scheduleMusicLead(event.leadMidi + (this.musicMode === "apex" ? 1 : 0), at)');
    expect(source).toContain("source.start(at)");
    expect(source).toContain("osc.start(at)");
    expect(source).toContain("this.musicPercussionGain?.disconnect()");
    expect(source).toContain("this.musicLeadGain?.disconnect()");
    expect(source).toContain("this.musicNoise = null");
    expect(source).toContain("for (const note of [...this.musicNotes]) note.stop()");
  });
});
