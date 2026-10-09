import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClientState } from "../src/game/net/clientState.js";
import { MUSIC_CROSSFADE_SECONDS, MUSIC_MIX, mixAt, musicModeForState } from "../src/game/audio/musicIntensity.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const self = { id: "you", alive: true, health: 100, length: 10, position: { x: 0, y: 0, z: 0 } };
const threat = { id: "threat", alive: true, health: 100, length: 15, position: { x: 25, y: 0, z: 0 } };
function state(options: { phase?: "active" | "apex" | "result"; frenzy?: boolean; health?: number; rivals?: Array<typeof threat> } = {}): ClientState {
  return {
    tick: 100,
    frenzyUntilTick: options.frenzy ? 101 : 100,
    round: { phase: options.phase ?? "active" },
    sharks: [{ ...self, health: options.health ?? 100 }, ...(options.rivals ?? [])],
  } as unknown as ClientState;
}

describe("ST-278 gameplay-driven music", () => {
  it("hunts only near an alive devouring threat or at low health", () => {
    expect(musicModeForState(state(), "you")).toBe("calm");
    expect(musicModeForState(state({ health: 40 }), "you")).toBe("hunt");
    expect(musicModeForState(state({ health: 41 }), "you")).toBe("calm");
    expect(musicModeForState(state({ rivals: [threat] }), "you")).toBe("hunt");
    expect(musicModeForState(state({ rivals: [{ ...threat, length: 14.9 }] }), "you")).toBe("calm");
    expect(musicModeForState(state({ rivals: [{ ...threat, position: { x: 31, y: 0, z: 0 } }] }), "you")).toBe("calm");
    expect(musicModeForState(state({ rivals: [{ ...threat, alive: false }] }), "you")).toBe("calm");
    expect(musicModeForState(state({ rivals: [threat] }), null)).toBe("calm");
  });
  it("prioritizes result then Apex then Frenzy then Hunt and Calm", () => {
    expect(musicModeForState(state({ frenzy: true }), "you")).toBe("frenzy");
    expect(musicModeForState(state({ phase: "apex", frenzy: true }), "you")).toBe("apex");
    expect(musicModeForState(state({ phase: "result", frenzy: true }), "you")).toBe("result");
    expect(musicModeForState(state({ phase: "active", health: 12 }), "you")).toBe("hunt");
  });
  it("keeps modes bounded and returns to calm under the round-result sting", () => {
    expect(MUSIC_MIX.calm).toEqual({ pad: 0.58, bass: 0.42, percussion: 0, lead: 0 });
    expect(MUSIC_MIX.hunt.percussion).toBeGreaterThan(0);
    expect(MUSIC_MIX.hunt.lead).toBe(0);
    expect(MUSIC_MIX.frenzy.percussion).toBeGreaterThan(MUSIC_MIX.hunt.percussion);
    expect(MUSIC_MIX.frenzy.lead).toBeGreaterThan(0);
    expect(MUSIC_MIX.apex.lead).toBeGreaterThan(0);
    expect(MUSIC_MIX.result).toEqual(MUSIC_MIX.calm);
    for (const mix of Object.values(MUSIC_MIX)) expect(Object.values(mix).every((level) => level >= 0 && level <= 1)).toBe(true);
    const hook = read("../src/game/audio/useGameAudio.ts");
    expect(hook).toContain('cue.current("roundResult"');
    expect(hook).toContain("musicModeForState(state, socket.youId)");
  });
  it("uses uninterrupted 1.2-second fades and audio-clock frenzy/apex variation", () => {
    expect(MUSIC_CROSSFADE_SECONDS).toBeGreaterThanOrEqual(1);
    expect(mixAt(MUSIC_MIX.calm, MUSIC_MIX.frenzy, 0)).toEqual(MUSIC_MIX.calm);
    const half = mixAt(MUSIC_MIX.calm, MUSIC_MIX.frenzy, MUSIC_CROSSFADE_SECONDS / 2);
    expect(half.percussion).toBeCloseTo(MUSIC_MIX.frenzy.percussion / 2);
    expect(half.lead).toBeCloseTo(MUSIC_MIX.frenzy.lead / 2);
    expect(mixAt(MUSIC_MIX.calm, MUSIC_MIX.frenzy, MUSIC_CROSSFADE_SECONDS)).toEqual(MUSIC_MIX.frenzy);
    expect(mixAt(MUSIC_MIX.calm, MUSIC_MIX.frenzy, 999)).toEqual(MUSIC_MIX.frenzy);
    const manager = read("../src/game/audio/AudioManager.ts");
    expect(manager).toContain("gain.cancelScheduledValues(at)");
    expect(manager).toContain("gain.setValueAtTime(from[key], at)");
    expect(manager).toContain("gain.linearRampToValueAtTime(to[key], at + MUSIC_CROSSFADE_SECONDS)");
    expect(manager).toContain('this.musicMode === "frenzy" && step % 2 === 1');
    expect(manager).toContain('this.musicMode === "apex" ? 1 : 0');
    expect(manager).toContain("this.musicFade = null");
  });
  it("defaults to 35% after activation, honors saved mute, and keeps mobile mute one tap away", () => {
    const settings = read("../src/game/settings/SettingsContext.tsx");
    const tools = read("../src/game/ui/QuickA11y.tsx");
    const manager = read("../src/game/audio/AudioManager.ts");
    expect(settings).toContain("audio: { master: 0.8, sfx: 0.9, music: 0.35, captions: false }");
    expect(settings).toContain("...(record(parsed.audio) ? parsed.audio : {})");
    expect(tools).toContain('{music}\n      <div className="gearbox">');
    expect(tools).toContain("aria-pressed={musicOn}");
    expect(tools).toContain("music: musicOn ? 0 : 0.35");
    expect(tools).not.toContain("{collapsed && music}");
    expect(manager).toContain('window.addEventListener("pointerdown"');
    expect(manager).toContain('window.addEventListener("keydown"');
  });
});
