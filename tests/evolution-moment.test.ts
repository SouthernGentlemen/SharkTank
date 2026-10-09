import { describe, expect, it } from "vitest";
import { SFX_RECIPES } from "../src/game/audio/sfxVoices.js";
import { readFileSync } from "node:fs";
import { detectEvolution, type EvolutionSample, type EvolutionTracker } from "../src/game/ui/evolution.js";

const sample = (length: number, extra: Partial<EvolutionSample> = {}): EvolutionSample => ({
  playerId: "pilot",
  roundNumber: 1,
  tick: 10,
  alive: true,
  length,
  score: 0,
  ...extra,
});
function observe(tracker: EvolutionTracker | null, update: EvolutionSample) {
  return detectEvolution(tracker, update);
}
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ST-273 client-only evolution moment", () => {
  it("celebrates each newly crossed milestone once, using server-provided length", () => {
    const initial = observe(null, sample(10));
    expect(initial.evolved).toBeNull();
    const reef = observe(initial.tracker, sample(22, { tick: 11, score: 5 }));
    expect(reef.evolved).toBe("Reef Shark");
    const repeat = observe(reef.tracker, sample(24, { tick: 12, score: 6 }));
    expect(repeat.evolved).toBeNull();
    const tiger = observe(repeat.tracker, sample(44, { tick: 13, score: 12 }));
    expect(tiger.evolved).toBe("Tiger Shark");
    const white = observe(tiger.tracker, sample(78, { tick: 14, score: 15 }));
    expect(white.evolved).toBe("Great White");
    expect(observe(white.tracker, sample(112, { tick: 15, score: 20 })).evolved).toBe("Megalodon");
  });

  it("does not replay on same-tier snapshots, length loss or stale reconnect packets", () => {
    const reef = observe(observe(null, sample(22)).tracker, sample(44, { tick: 12, score: 10 }));
    expect(reef.evolved).toBe("Tiger Shark");
    const regressed = observe(reef.tracker, sample(21, { tick: 13, score: 10 }));
    expect(regressed.evolved).toBeNull();
    expect(observe(regressed.tracker, sample(44, { tick: 14, score: 11 })).evolved).toBeNull();
    const delayed = observe(reef.tracker, sample(78, { tick: 11, score: 9 }));
    expect(delayed.evolved).toBeNull();
    expect(delayed.tracker).toEqual(reef.tracker);
    const reconnected = observe(reef.tracker, sample(44, { tick: 15, score: 10 }));
    expect(reconnected.evolved).toBeNull();
  });

  it("seeds joining at a higher tier, death, respawn, player replacement and a new round", () => {
    const joined = observe(null, sample(26));
    expect(joined.evolved).toBeNull();
    const grown = observe(joined.tracker, sample(44, { tick: 11, score: 6 }));
    expect(grown.evolved).toBe("Tiger Shark");
    const dead = observe(grown.tracker, sample(44, { tick: 12, score: 6, alive: false }));
    expect(dead.evolved).toBeNull();
    const respawn = observe(dead.tracker, sample(26, { tick: 14, score: 0 }));
    expect(respawn.evolved).toBeNull();
    expect(observe(respawn.tracker, sample(44, { tick: 15, score: 7 })).evolved).toBe("Tiger Shark");
    expect(observe(grown.tracker, sample(26, { tick: 14, score: 0 })).evolved).toBeNull();
    expect(observe(grown.tracker, sample(78, { tick: 14, score: 0, playerId: "replacement" })).evolved).toBeNull();
    expect(observe(grown.tracker, sample(78, { tick: 100, score: 0, roundNumber: 2 })).evolved).toBeNull();
  });

  it("remains a bounded, semantic, reduced-motion-safe presentation", () => {
    const ui = source("../src/game/ui/EvolutionMoment.tsx");
    const screen = source("../src/game/ui/GameScreen.tsx");
    const css = source("../src/game/ui/theme.css");
    const audio = source("../src/game/audio/AudioManager.ts");
    expect(screen).toContain("<EvolutionMoment socket={socket}");
    expect(ui).toContain('socket.status !== "open"');
    expect(ui).toContain('announce(`Evolved: ${result.evolved}.`, "polite")');
    expect(ui).toContain('aria-hidden="true"');
    expect(ui).toContain("!reducedMotion && <span");
    expect(ui).toContain('if (!reducedMotion) audio.playSfx("evolve"');
    expect(ui).toContain("setTimeout(() =>");
    expect(css).toContain(".game-evolution__ring");
    expect(css).toContain("@keyframes evolution-ring");
    expect(audio).toContain("const spec = SFX_RECIPES[type]");
    expect(audio).toContain("if (spec.harmonic)");
    expect(SFX_RECIPES.evolve.harmonic?.ratio).toBeGreaterThan(1);
    expect(SFX_RECIPES.evolve.peak).toBeLessThan(0.1);
  });
});
