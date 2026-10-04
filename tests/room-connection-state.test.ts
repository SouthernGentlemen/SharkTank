import { describe, expect, it } from "vitest";
import {
  FULL_RETRY_MS,
  UNREACHABLE_ATTEMPTS,
  connectionAfterClose,
  connectionAfterWelcome,
} from "../vendor/ModuleReact3Fiber/src/client/net/roomConnectionState.js";

describe("tank connection state", () => {
  it("treats a 1013 room-full close as reachable and retries every five seconds", () => {
    expect(connectionAfterClose(1013, "room full", 2)).toEqual({
      status: "full",
      failedAttempts: 0,
      retryInMs: FULL_RETRY_MS,
    });
    expect(FULL_RETRY_MS).toBe(5_000);
  });

  it("stops automatic reconnect after three unreachable attempts", () => {
    let transition = connectionAfterClose(1006, "", 0);
    expect(transition).toMatchObject({ status: "reconnecting", failedAttempts: 1 });
    expect(transition.retryInMs).not.toBeNull();

    transition = connectionAfterClose(1006, "", transition.failedAttempts);
    expect(transition).toMatchObject({ status: "reconnecting", failedAttempts: 2 });
    expect(transition.retryInMs).not.toBeNull();

    transition = connectionAfterClose(1006, "", transition.failedAttempts);
    expect(transition).toEqual({
      status: "unreachable",
      failedAttempts: UNREACHABLE_ATTEMPTS,
      retryInMs: null,
    });
  });

  it("resets failed attempts after a recovered welcome", () => {
    expect(connectionAfterClose(1006, "", 0).failedAttempts).toBe(1);
    expect(connectionAfterWelcome()).toEqual({
      status: "open",
      failedAttempts: 0,
      retryInMs: null,
    });
    expect(connectionAfterClose(1006, "", 0)).toMatchObject({
      status: "reconnecting",
      failedAttempts: 1,
    });
  });
});
