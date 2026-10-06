import { TICKS_PER_SECOND } from "../../engine/index.js";
import { STATE_BROADCAST_EVERY } from "../../protocol/index.js";
import type { ClientState } from "./clientState.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;
export const REMOTE_INTERP_DELAY_MS = Math.max(90, Math.round(1.5 * STATE_BROADCAST_EVERY * TICK_MS));

/** A pair of buffered snapshots straddling the render time, plus the blend factor. */
export interface InterpFrame {
  older: ClientState;
  newer: ClientState;
  alpha: number; // 0 at `older`, 1 at `newer`
}

export interface BufferedSnapshot { t: number; state: ClientState }

/** Sample authoritative ticks on the client clock; packet arrival only anchors the origin. */
export function bracketSnapshots(
  buffer: readonly BufferedSnapshot[], origin: number | null, now: number, delayMs: number,
): InterpFrame | null {
  const n = buffer.length;
  if (!n) return null;
  const renderTime = now - (origin ?? (buffer[0].t - buffer[0].state.tick * TICK_MS)) - delayMs;
  if (renderTime <= buffer[0].state.tick * TICK_MS) {
    return { older: buffer[0].state, newer: buffer[0].state, alpha: 0 };
  }
  if (renderTime >= buffer[n - 1].state.tick * TICK_MS) {
    return { older: buffer[n - 1].state, newer: buffer[n - 1].state, alpha: 1 };
  }
  let i = n - 2;
  while (i > 0 && buffer[i].state.tick * TICK_MS > renderTime) i -= 1;
  const older = buffer[i].state;
  const newer = buffer[i + 1].state;
  const span = (newer.tick - older.tick) * TICK_MS;
  return { older, newer, alpha: span > 0 ? (renderTime - older.tick * TICK_MS) / span : 0 };
}
