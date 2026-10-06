import { describe, expect, it } from "vitest";
import { isFamilyFriendlyName, sanitizeDisplayName } from "../src/protocol/name-policy.js";

describe("display-name policy", () => {
  it("accepts visible names in non-Latin scripts", () => {
    expect(sanitizeDisplayName("龍王小明")).toBe("龍王小明");
    expect(sanitizeDisplayName("Владимир")).toBe("Владимир");
  });

  it("strips invisible and bidirectional controls", () => {
    expect(sanitizeDisplayName("A\u202eB\u200bC")).toBe("ABC");
    expect(isFamilyFriendlyName("\u200b\u2066")).toBe(false);
  });

  it("blocks simple punctuation and leetspeak evasions", () => {
    expect(sanitizeDisplayName("f.u.c.k")).toBe("Player");
    expect(sanitizeDisplayName("$h1t")).toBe("Player");
  });

  it("clips by Unicode code point without splitting emoji", () => {
    const result = sanitizeDisplayName("🦈".repeat(17));
    expect([...result]).toHaveLength(16);
    expect(result).toBe("🦈".repeat(16));
  });
});
