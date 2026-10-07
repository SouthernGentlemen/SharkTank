/** One short-lived intent; expiry and combat remain authoritative. */
export class BiteBuffer {
  private expiry: number | null = null;
  press(now: number, remainingMs: number): boolean {
    if (remainingMs <= 0) { this.clear(); return true; }
    if (remainingMs <= 200 && this.expiry === null) this.expiry = now + 300;
    return false;
  }
  consume(now: number, remainingMs: number): boolean {
    if (this.expiry === null) return false;
    if (now > this.expiry) { this.clear(); return false; }
    if (remainingMs > 0) return false;
    this.clear();
    return true;
  }
  clear(): void { this.expiry = null; }
}
