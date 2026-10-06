import { describe, expect, it } from "vitest";
import { bracketSnapshots, REMOTE_INTERP_DELAY_MS, type BufferedSnapshot } from "../src/game/net/snapshotTimeline.js";
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
    expect(bracketSnapshots(buffer.slice(0, 1), null, 1200, 150)?.older).toBe(buffer[0].state);
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
