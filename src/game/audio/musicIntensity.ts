// Client-only presentation decisions from existing protocol-12 snapshots.
import type { ClientState } from "../net/clientState.js";

export type MusicMode = "calm" | "hunt" | "frenzy" | "apex" | "result";
export interface MusicMix { pad: number; bass: number; percussion: number; lead: number }
export const MUSIC_CROSSFADE_SECONDS = 1.2;
export const MUSIC_MIX: Record<MusicMode, MusicMix> = {
  calm: { pad: 0.58, bass: 0.42, percussion: 0, lead: 0 },
  hunt: { pad: 0.54, bass: 0.44, percussion: 0.34, lead: 0 },
  frenzy: { pad: 0.48, bass: 0.52, percussion: 0.58, lead: 0.34 },
  apex: { pad: 0.42, bass: 0.54, percussion: 0.46, lead: 0.4 },
  result: { pad: 0.58, bass: 0.42, percussion: 0, lead: 0 },
};
const MIX_KEYS = ["pad", "bass", "percussion", "lead"] as const;

/** Begin interrupted fades at the currently audible interpolated level. */
export function mixAt(from: MusicMix, to: MusicMix, elapsedSeconds: number): MusicMix {
  const t = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.min(1, elapsedSeconds / MUSIC_CROSSFADE_SECONDS)) : 0;
  return Object.fromEntries(MIX_KEYS.map((k) => [k, from[k] + (to[k] - from[k]) * t])) as unknown as MusicMix;
}

export function musicModeForState(state: ClientState, youId: string | null): MusicMode {
  if (state.round.phase === "result") return "result";
  if (state.round.phase === "apex") return "apex";
  if (state.frenzyUntilTick > state.tick) return "frenzy";
  const me = state.sharks.find((shark) => shark.id === youId && shark.alive);
  if (!me) return "calm";
  if (me.health <= 40) return "hunt";
  const threatNear = state.sharks.some((shark) => {
    if (!shark.alive || shark.id === me.id || shark.length < me.length * 1.5) return false;
    const dx = shark.position.x - me.position.x;
    const dy = shark.position.y - me.position.y;
    const dz = shark.position.z - me.position.z;
    return dx * dx + dy * dy + dz * dz <= 900;
  });
  return threatNear ? "hunt" : "calm";
}
