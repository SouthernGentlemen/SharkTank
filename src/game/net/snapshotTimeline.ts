import { TICKS_PER_SECOND } from "../../engine/index.js";
import { STATE_BROADCAST_EVERY } from "../../protocol/index.js";
import type { ClientState } from "./clientState.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;
export const REMOTE_INTERP_DELAY_MS = Math.max(90, Math.round(1.5 * STATE_BROADCAST_EVERY * TICK_MS));

/** A pair of buffered snapshots straddling the render time, plus the blend factor. */
export interface InterpFrame {
  older: ClientState;
  newer: ClientState;
  extrapolationMs?: number;
  alpha: number; // 0 at `older`, 1 at `newer`
}

export interface BufferedSnapshot { t: number; state: ClientState }

/** Sample authoritative ticks using the continuously corrected client clock origin. */
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
    const newest = buffer[n - 1].state;
    const extra = Math.min(120, renderTime - newest.tick * TICK_MS);
    if (extra <= 0) return { older: newest, newer: newest, alpha: 1 };
    return { older: buffer[Math.max(0, n - 2)].state, newer: newest, alpha: 1, extrapolationMs: extra };
  }
  let i = n - 2;
  while (i > 0 && buffer[i].state.tick * TICK_MS > renderTime) i -= 1;
  const older = buffer[i].state;
  const newer = buffer[i + 1].state;
  const span = (newer.tick - older.tick) * TICK_MS;
  return { older, newer, alpha: span > 0 ? (renderTime - older.tick * TICK_MS) / span : 0 };
}

/** Estimate tick rate separately from phase: 1% drift exceeds the phase slew budget. */
export class SnapshotClock {
  private samples: Array<{ now: number; server: number }> = [];
  private rate = 1;
  private time: number | null = null;
  private at = 0;

  reset(): void {
    this.samples = [];
    this.rate = 1;
    this.time = null;
    this.at = 0;
  }

  observe(tick: number, now: number): void {
    const server = tick * TICK_MS;
    if (this.samples.length && server < this.samples[this.samples.length - 1].server) this.reset();
    this.advance(now);
    this.samples.push({ now, server });
    while (this.samples.length > 2 && this.samples[0].now < now - 60000) this.samples.shift();
    const first = this.samples[0];
    if (now - first.now >= 2000) {
      // Centred least squares rejects arrival jitter without accumulating rounding error.
      const count = this.samples.length;
      const meanX = this.samples.reduce((sum, s) => sum + s.now - first.now, 0) / count;
      const meanY = this.samples.reduce((sum, s) => sum + s.server - first.server, 0) / count;
      let covariance = 0, variance = 0;
      for (const sample of this.samples) {
        const x = sample.now - first.now - meanX;
        covariance += x * (sample.server - first.server - meanY);
        variance += x * x;
      }
      this.rate = Math.max(0.98, Math.min(1.02, covariance / variance));
    }
    this.time ??= server;
  }

  private advance(now: number): void {
    if (this.time !== null) {
      const elapsed = Math.max(0, now - this.at);
      this.time += elapsed * this.rate;
      // Minimum receive offset is the least-delayed packet in the two-second window.
      let target = -Infinity;
      for (let i = this.samples.length - 1; i >= 0; i -= 1) {
        const sample = this.samples[i];
        if (sample.now < now - 2000) break;
        target = Math.max(target, sample.server + (now - sample.now) * this.rate);
      }
      if (Number.isFinite(target)) {
        const limit = elapsed * 0.005;
        this.time += Math.max(-limit, Math.min(limit, target - this.time));
      }
    }
    this.at = now;
  }

  originAt(now: number): number | null {
    this.advance(now);
    return this.time === null ? null : now - this.time;
  }
}
