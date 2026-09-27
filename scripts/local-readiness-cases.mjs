import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalLifecycleArgs,
  waitForHttpReady,
  waitForReadinessAndMaybeOpen,
} from "./local-readiness.mjs";

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => { now += ms; },
  };
}

test("readiness succeeds only after the HTTP probe becomes responsive", async () => {
  const clock = fakeClock();
  const outcomes = [false, false, true];
  const result = await waitForHttpReady({
    url: "http://localhost:8787",
    timeoutMs: 100,
    intervalMs: 10,
    probeFn: async () => outcomes.shift(),
    nowFn: clock.now,
    sleepFn: clock.sleep,
  });
  assert.equal(result.attempts, 3);
  assert.equal(clock.now(), 20);
});

test("transient startup probe failures are retried within the readiness bound", async () => {
  const clock = fakeClock();
  let attempts = 0;
  const result = await waitForHttpReady({
    url: "http://localhost:8787",
    timeoutMs: 100,
    intervalMs: 10,
    probeFn: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNREFUSED");
      return attempts >= 3;
    },
    nowFn: clock.now,
    sleepFn: clock.sleep,
  });
  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);
});

test("readiness timeout is bounded and fails cleanly", async () => {
  const clock = fakeClock();
  let attempts = 0;
  await assert.rejects(
    waitForHttpReady({
      url: "http://localhost:8787",
      timeoutMs: 25,
      intervalMs: 10,
      probeFn: async () => { attempts += 1; return false; },
      nowFn: clock.now,
      sleepFn: clock.sleep,
    }),
    /readiness timed out after 25ms/,
  );
  assert.equal(clock.now(), 25);
  assert.equal(attempts, 3);
});

test("managed child exit before readiness fails promptly without waiting for the timeout", async () => {
  const clock = fakeClock();
  let exited = false;
  await assert.rejects(
    waitForHttpReady({
      url: "http://localhost:8787",
      timeoutMs: 10_000,
      intervalMs: 500,
      probeFn: async () => { exited = true; return false; },
      childExitedFn: () => exited,
      nowFn: clock.now,
      sleepFn: clock.sleep,
    }),
    /managed Wrangler exited before local application readiness/,
  );
  assert.equal(clock.now(), 0);
});

test("browser opening occurs only after readiness succeeds", async () => {
  const events = [];
  await waitForReadinessAndMaybeOpen({
    waitForReadyFn: async () => { events.push("ready"); return { attempts: 2 }; },
    onReadyFn: async () => events.push("reported"),
    openFn: async () => events.push("opened"),
  });
  assert.deepEqual(events, ["ready", "reported", "opened"]);
});

test("no-open suppresses only browser launch and still requires readiness", async () => {
  const events = [];
  await waitForReadinessAndMaybeOpen({
    noOpen: true,
    waitForReadyFn: async () => { events.push("ready"); },
    onReadyFn: async () => events.push("reported"),
    openFn: async () => events.push("opened"),
  });
  assert.deepEqual(events, ["ready", "reported"]);
});

test("browser launch failure remains best-effort after readiness", async () => {
  const events = [];
  await waitForReadinessAndMaybeOpen({
    waitForReadyFn: async () => events.push("ready"),
    openFn: async () => { events.push("open-attempt"); throw new Error("no desktop"); },
  });
  assert.deepEqual(events, ["ready", "open-attempt"]);
});

test("lifecycle options fail closed while no-open remains the one supported option", () => {
  assert.deepEqual(parseLocalLifecycleArgs([]), { noOpen: false });
  assert.deepEqual(parseLocalLifecycleArgs(["--no-open"]), { noOpen: true });

  for (const args of [
    [""], ["--open"], ["--no-open=true"], ["--reset-data"], ["positional"],
    ["--no-open", "--no-open"],
  ]) {
    assert.throws(() => parseLocalLifecycleArgs(args), /unsupported local (?:lifecycle|reset) option/);
  }
});
