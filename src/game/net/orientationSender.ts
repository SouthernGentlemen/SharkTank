import { shortestYawDelta } from "../../engine/index.js";

export interface Orientation { yaw: number; pitch: number }
export const ORIENTATION_INTERVAL_MS = 50;
export const ORIENTATION_SETTLE_MS = 50;

/** Pure send decision; settling bypasses deadbands, never the rate limit. */
export function shouldSendOrientation(
  latest: Orientation,
  sent: Orientation | null,
  now: number,
  sentAt: number,
  changedAt: number,
): boolean {
  if (now - sentAt < ORIENTATION_INTERVAL_MS) return false;
  if (!sent) return true;
  const yaw = Math.abs(shortestYawDelta(sent.yaw, latest.yaw));
  const pitch = Math.abs(sent.pitch - latest.pitch);
  return (yaw > 0 || pitch > 0)
    && (yaw >= 0.015 || pitch >= 0.015 || now - changedAt >= ORIENTATION_SETTLE_MS);
}

/** One trailing timer survives repeated identical frame updates. */
export class OrientationSender {
  private latest: Orientation | null = null;
  private sent: Orientation | null = null;
  private sentAt = -Infinity;
  private changedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly send: (value: Orientation) => boolean) {}

  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.latest = this.sent = null;
    this.sentAt = -Infinity;
  }

  update(value: Orientation): void {
    const now = performance.now();
    if (!this.latest || value.yaw !== this.latest.yaw || value.pitch !== this.latest.pitch) {
      this.changedAt = now;
      this.latest = { ...value };
    }
    this.flush(now);
  }

  private flush(now: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.latest) return;
    if (shouldSendOrientation(this.latest, this.sent, now, this.sentAt, this.changedAt)) {
      if (!this.send(this.latest)) return;
      this.sent = { ...this.latest };
      this.sentAt = now;
    }
    if (this.sent?.yaw === this.latest.yaw && this.sent.pitch === this.latest.pitch) return;
    const due = Math.max(this.sentAt + ORIENTATION_INTERVAL_MS, this.changedAt + ORIENTATION_SETTLE_MS);
    this.timer = setTimeout(() => this.flush(performance.now()), Math.max(1, due - now));
  }
}
