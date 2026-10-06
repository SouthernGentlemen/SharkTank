import { describe, expect, it } from "vitest";
import { SnapshotClock, bracketSnapshots, REMOTE_INTERP_DELAY_MS, type BufferedSnapshot } from "../src/game/net/snapshotTimeline.js";
import type { ClientState } from "../src/game/net/clientState.js";
import { STATE_BROADCAST_EVERY } from "../src/protocol/index.js";
import { TICKS_PER_SECOND } from "../src/engine/index.js";

const state = (tick: number) => ({ tick }) as ClientState;
describe("snapshot timeline", () => {
  it("brackets authoritative ticks independently of arrival jitter and handles buffer edges", () => {
    expect(bracketSnapshots([], null, 0, 150)).toBeNull();
    const buffer = [{ t: 1000, state: state(20) }, { t: 1125, state: state(22) }];
    expect(bracketSnapshots(buffer, null, 1200, 150)).toEqual({ older: buffer[0].state, newer: buffer[1].state, alpha: 0.5 });
    expect(bracketSnapshots(buffer, null, 1000, 150)?.alpha).toBe(0);
    expect(bracketSnapshots(buffer, null, 1300, 150)?.alpha).toBe(1);
    expect(bracketSnapshots(buffer, null, 1450, 150)?.extrapolationMs).toBe(120);
    expect(bracketSnapshots(buffer.slice(0, 1), null, 1200, 150)?.older).toBe(buffer[0].state);
  });

  it("advances 120 ms through a 200 ms render gap, then holds and keeps the velocity pair", () => {
    const buffer = [{ t: 1000, state: state(0) }, { t: 1100, state: state(2) }];
    for (let extra = 10; extra <= 200; extra += 10) {
      const frame = bracketSnapshots(buffer, 1000, 1250 + extra, 150)!;
      expect(frame.older).toBe(buffer[0].state);
      expect(frame.newer).toBe(buffer[1].state);
      expect(frame.alpha).toBe(1);
      expect(frame.extrapolationMs).toBe(Math.min(extra, 120));
    }
  });

  it("clamps fewer than 2% of 60 Hz frames at 10 Hz with ±25 ms jitter", () => {
    const interval = STATE_BROADCAST_EVERY * 1000 / TICKS_PER_SECOND;
    expect(interval).toBe(100);
    expect(REMOTE_INTERP_DELAY_MS).toBe(150);
    for (const firstJitter of [-25, 0, 25]) {
      const arrivals = Array.from({ length: 602 }, (_, i) => ({
        t: 1000 + i * interval + (i === 0 ? firstJitter : ((i * 37) % 51) - 25),
        state: state(i * STATE_BROADCAST_EVERY),
      }));
      const buffer: BufferedSnapshot[] = [];
      let next = 0, frames = 0, clamped = 0;
      for (let now = 1000; now < 61000; now += 1000 / 60) {
        while (next < arrivals.length && arrivals[next].t <= now) buffer.push(arrivals[next++]);
        if (now < 2000) continue; // Initial history warmup is not steady-state playback.
        const frame = bracketSnapshots(buffer, arrivals[0].t, now, REMOTE_INTERP_DELAY_MS)!;
        frames += 1;
        if (frame.older === frame.newer) clamped += 1;
      }
      expect(clamped / frames).toBeLessThan(0.02);
    }
  });
});

describe("drift-locked snapshot clock", () => {
  it.each([0.99, 1, 1.01])("keeps ten minutes of jittered playback locked at rate %s", rate => {
    const clock = new SnapshotClock();
    const buffer: BufferedSnapshot[] = [];
    let next = 0, frames = 0, clamped = 0, previous: number | null = null;
    let maxLagError = 0, maxStep = 0;
    for (let now = 1000; now < 601000; now += 1000 / 60) {
      while (1000 + next * 100 / rate + ((next * 37) % 51) <= now) {
        const t = 1000 + next * 100 / rate + ((next * 37) % 51);
        const snapshot = { t, state: state(next * STATE_BROADCAST_EVERY) };
        clock.observe(snapshot.state.tick, t);
        buffer.push(snapshot);
        while (buffer.length > 2 && buffer[0].t < now - 1500) buffer.shift();
        next += 1;
      }
      const origin = clock.originAt(now);
      if (origin === null) continue;
      const renderTime = now - origin - REMOTE_INTERP_DELAY_MS;
      if (previous !== null) {
        expect(renderTime).toBeGreaterThanOrEqual(previous);
        maxStep = Math.max(maxStep, renderTime - previous);
      }
      previous = renderTime;
      if (now < 4000) continue;
      const frame = bracketSnapshots(buffer, origin, now, REMOTE_INTERP_DELAY_MS)!;
      frames += 1;
      if (frame.older === frame.newer) clamped += 1;
      const rendered = (frame.older.tick + (frame.newer.tick - frame.older.tick) * frame.alpha) * 1000 / TICKS_PER_SECOND;
      maxLagError = Math.max(maxLagError, Math.abs((now - 1000) * rate - rendered - REMOTE_INTERP_DELAY_MS));
    }
    expect(clamped / frames).toBeLessThan(0.02);
    expect(maxLagError).toBeLessThanOrEqual(20);
    // A frame advances at the estimated server rate plus at most the phase slew.
    expect(maxStep).toBeLessThanOrEqual(1000 / 60 * 1.025 + 1e-6);
  });

  it("bounds phase slew and resets on reconnect and tick regression", () => {
    const clock = new SnapshotClock();
    clock.observe(20, 1000);
    clock.observe(22, 1150);
    const before = clock.originAt(1150)!;
    const after = clock.originAt(1250)!;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(0.5 + 1e-9);
    clock.reset();
    expect(clock.originAt(1300)).toBeNull();
    clock.observe(200, 1400);
    clock.observe(0, 1500);
    expect(clock.originAt(1500)).toBe(1500);
    expect(clock.originAt(1600)).toBe(1500);
  });
});
