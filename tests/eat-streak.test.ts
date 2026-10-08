import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EAT_STREAK_WINDOW_MS, eatStreakPitch, observeEatStreak, type EatStreakSample, type EatStreakTracker } from "../src/game/ui/eatStreak.js";

const sample = (score: number, extra: Partial<EatStreakSample> = {}): EatStreakSample => ({
  playerId: "local", roundNumber: 1, tick: 10, alive: true, score, ...extra,
});
const step = (previous: EatStreakTracker | null, score: number, at: number, extra: Partial<EatStreakSample> = {}) =>
  observeEatStreak(previous, sample(score, extra), at);
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-274 authoritative local gain streaks", () => {
  it("does not celebrate joining mid-round and counts consecutive gains inside 1.5 seconds", () => {
    const baseline = step(null, 12, 1000);
    expect(baseline).toMatchObject({ gain: 0, streak: 0 });
    const first = step(baseline.tracker, 14, 1100, { tick: 11 });
    expect(first).toMatchObject({ gain: 2, streak: 1 });
    const idle = step(first.tracker, 14, 1800, { tick: 12 });
    expect(idle).toMatchObject({ gain: 0, streak: 1 });
    const second = step(idle.tracker, 21, 2600, { tick: 13 });
    expect(second).toMatchObject({ gain: 7, streak: 2 });
    const expired = step(second.tracker, 21, 4101, { tick: 14 });
    expect(expired.streak).toBe(0);
    const restarted = step(expired.tracker, 22, 4200, { tick: 15 });
    expect(restarted).toMatchObject({ gain: 1, streak: 1 });
    expect(EAT_STREAK_WINDOW_MS).toBe(1500);
  });

  it("deduplicates same tick and ignores delayed packets without rewinding", () => {
    const first = step(step(null, 0, 0).tracker, 5, 100, { tick: 11 });
    expect(step(first.tracker, 7, 120, { tick: 11 }).gain).toBe(0);
    const stale = step(first.tracker, 100, 150, { tick: 10 });
    expect(stale.gain).toBe(0);
    expect(stale.tracker).toEqual(first.tracker);
    expect(step(first.tracker, 5, 180, { tick: 12 }).streak).toBe(1);
  });

  it("resets on death, respawn, score rollback, player replacement and round transition", () => {
    const live = step(step(null, 0, 0).tracker, 6, 100, { tick: 11 });
    const dead = step(live.tracker, 6, 110, { tick: 12, alive: false });
    expect(dead).toMatchObject({ gain: 0, streak: 0 });
    expect(step(dead.tracker, 1, 120, { tick: 13 })).toMatchObject({ gain: 0, streak: 0 });
    expect(step(live.tracker, 0, 120, { tick: 13 })).toMatchObject({ gain: 0, streak: 0 });
    expect(step(live.tracker, 100, 120, { tick: 13, playerId: "other" })).toMatchObject({ gain: 0, streak: 0 });
    expect(step(live.tracker, 100, 120, { tick: 13, roundNumber: 2 })).toMatchObject({ gain: 0, streak: 0 });
  });

  it("raises and caps local eat pitch without changing the world cue shape", () => {
    expect(eatStreakPitch(1)).toBe(1);
    expect(eatStreakPitch(3)).toBeGreaterThan(eatStreakPitch(2));
    expect(eatStreakPitch(100)).toBeLessThanOrEqual(1.6);
    const manager = source("../src/game/audio/AudioManager.ts");
    expect(manager).toContain("const pitch = Number.isFinite(options.pitch)");
    expect(manager).toContain("spec.startHz * pitch");
    const hud = source("../src/game/ui/Hud.tsx");
    expect(hud).toContain('audio.playSfx("preyConsume"');
    expect(hud).toContain("minIntervalMs: 100, pitch: eatStreakPitch(result.streak)");
  });

  it("keeps semantic streak data, bounded speech, and motion-free score display", () => {
    const hud = source("../src/game/ui/Hud.tsx");
    const screen = source("../src/game/ui/GameScreen.tsx");
    const css = source("../src/game/ui/theme.css");
    expect(hud).toContain("result.streak % 5 === 0");
    expect(hud).toContain("now - lastStreakAnnouncementAt.current >= EAT_STREAK_WINDOW_MS");
    expect(hud).toContain("×{gainCue.streak} streak");
    expect(hud).toContain("gainCue && !reducedMotion");
    expect(hud).toContain('aria-hidden="true">+{gainCue.points}');
    expect(screen).toContain('<Hud socket={socket} reducedMotion={settings.a11y.motion === "reduced"} />');
    expect(css).toContain("@keyframes hud-score-rise");
    expect(css).toContain(':root[data-motion="reduced"] .hud-score-float{display:none}');
    expect(css).toContain(".hud-eat-streak");
  });
});
