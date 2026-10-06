import { afterEach, describe, expect, it, vi } from "vitest";
import { OrientationSender, shouldSendOrientation } from "../src/game/net/orientationSender.js";

afterEach(() => vi.useRealTimers());

describe("steering intent delivery", () => {
  it("enforces 50 ms for both axes and uses shortest yaw distance", () => {
    expect(shouldSendOrientation({ yaw: 1, pitch: 1 }, null, 49, 0, 0)).toBe(false);
    expect(shouldSendOrientation({ yaw: 0.015, pitch: 0 }, { yaw: 0, pitch: 0 }, 50, 0, 50)).toBe(true);
    expect(shouldSendOrientation({ yaw: 0, pitch: 0.015 }, { yaw: 0, pitch: 0 }, 50, 0, 50)).toBe(true);
    expect(shouldSendOrientation({ yaw: -Math.PI + 0.001, pitch: 0 }, { yaw: Math.PI - 0.001, pitch: 0 }, 50, 0, 50)).toBe(false);
    expect(shouldSendOrientation({ yaw: 0.001, pitch: 0 }, { yaw: 0, pitch: 0 }, 100, 0, 50)).toBe(true);
    expect(shouldSendOrientation({ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }, 100, 0, 0)).toBe(false);
  });

  it("caps continuous steering at 20 messages in each second", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const times: number[] = [];
    const sender = new OrientationSender(() => { times.push(performance.now()); return true; });
    for (let ms = 0; ms < 2000; ms += 5) {
      sender.update({ yaw: ms / 100, pitch: 0 });
      vi.advanceTimersByTime(5);
    }
    expect(times.filter(t => t < 1000)).toHaveLength(20);
    expect(times.filter(t => t >= 1000 && t < 2000)).toHaveLength(20);
    expect(times.slice(1).every((t, i) => t - times[i] >= 50)).toBe(true);
    sender.reset();
  });

  it("flushes the latest tiny final turn without another frame and does not repeat", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const send = vi.fn(() => true);
    const sender = new OrientationSender(send);
    sender.update({ yaw: 0, pitch: 0 });
    vi.advanceTimersByTime(10);
    sender.update({ yaw: 0.001, pitch: 0.002 });
    vi.advanceTimersByTime(10);
    sender.update({ yaw: 0.003, pitch: 0.004 });
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10);
      sender.update({ yaw: 0.003, pitch: 0.004 });
    }
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(send).toHaveBeenLastCalledWith({ yaw: 0.003, pitch: 0.004 });
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("cancels pending values on reset and retries values that were not transmitted", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const send = vi.fn(() => false);
    const sender = new OrientationSender(send);
    sender.update({ yaw: 0, pitch: 0 });
    send.mockReturnValue(true);
    sender.update({ yaw: 0, pitch: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    sender.update({ yaw: 0.001, pitch: 0 });
    sender.reset();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    sender.update({ yaw: 0.001, pitch: 0 });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
