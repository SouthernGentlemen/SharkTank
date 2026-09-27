import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import {
  createOwnershipRecord,
  foreignPortError,
  isOwnedProcessIdentity,  requirePortsFree,
  stopOwnedProcess,
} from "./local-process-ownership.mjs";

const root = "/work/SharkTank";
const sameIdentity = {
  pid: 43210,
  startedAt: "Tue Sep 22 05:10:00 2026",
  cwd: root,
  command: "node wrangler dev --port 8787",
};
const wranglerRecord = createOwnershipRecord(sameIdentity, {
  kind: "wrangler",
  root,
  cwd: root,
});

test("ownership requires the recorded checkout, cwd, pid, and process start identity", () => {
  assert.equal(
    isOwnedProcessIdentity(wranglerRecord, sameIdentity, {
      kind: "wrangler",
      root,
      cwd: root,
    }),
    true,
  );
  assert.equal(
    isOwnedProcessIdentity(wranglerRecord, { ...sameIdentity, cwd: "/work/Other" }, {
      kind: "wrangler",
      root,
      cwd: root,
    }),
    false,
  );
  assert.equal(
    isOwnedProcessIdentity(
      wranglerRecord,
      { ...sameIdentity, startedAt: "Tue Sep 22 05:11:00 2026" },
      { kind: "wrangler", root, cwd: root },
    ),
    false,
  );
});

test("a process from another checkout is foreign even when its command names Wrangler and SharkTank", () => {
  const other = {
    ...sameIdentity,
    cwd: "/work/other/SharkTank",
    command: "node wrangler dev --port 8787 /work/other/SharkTank",
  };
  assert.equal(
    isOwnedProcessIdentity(wranglerRecord, other, {
      kind: "wrangler",
      root,
      cwd: root,
    }),
    false,
  );
});

test("unproven ownership never sends a signal", async () => {
  const signals = [];
  const result = await stopOwnedProcess(wranglerRecord, {
    kind: "wrangler",
    root,
    cwd: root,
    group: true,
    inspectFn: () => ({ ...sameIdentity, cwd: "/work/foreign" }),
    killFn: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(result, { stopped: false, reason: "ownership-unproven" });
  assert.deepEqual(signals, []);
});

test("owned cleanup uses graceful process-group termination and stops when identity disappears", async () => {
  const signals = [];
  let observations = 0;
  const result = await stopOwnedProcess(wranglerRecord, {
    kind: "wrangler",
    root,
    cwd: root,
    group: true,
    platform: "linux",
    inspectFn: () => {
      observations += 1;
      return observations === 1 ? sameIdentity : null;
    },
    isAliveFn: () => true,
    killFn: (pid, signal) => signals.push([pid, signal]),
    sleepFn: async () => {},
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(signals, [[-43210, "SIGTERM"]]);
});

test("SIGKILL escalation happens only while the exact owned identity is still present", async () => {
  const signals = [];
  let phase = 0;
  const result = await stopOwnedProcess(wranglerRecord, {
    kind: "wrangler",
    root,
    cwd: root,
    group: false,
    inspectFn: () => {
      phase += 1;
      if (phase <= 3) return sameIdentity;
      return null;
    },
    isAliveFn: () => true,
    killFn: (pid, signal) => signals.push([pid, signal]),
    sleepFn: async () => {},
    attempts: 1,
    killAttempts: 2,
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(signals, [[43210, "SIGTERM"], [43210, "SIGKILL"]]);
});

test("identity change after graceful stop prevents escalation against a recycled pid", async () => {
  const signals = [];
  let phase = 0;
  const recycled = { ...sameIdentity, startedAt: "Tue Sep 22 05:12:00 2026" };
  const result = await stopOwnedProcess(wranglerRecord, {
    kind: "wrangler",
    root,
    cwd: root,
    inspectFn: () => {
      phase += 1;
      return phase === 1 ? sameIdentity : recycled;
    },
    isAliveFn: () => true,
    killFn: (pid, signal) => signals.push([pid, signal]),
    sleepFn: async () => {},
    attempts: 1,
  });
  assert.equal(result.stopped, true);
  assert.deepEqual(signals, [[43210, "SIGTERM"]]);
});

test("occupied-port refusal identifies the port and never claims ownership", () => {
  assert.match(foreignPortError(8787).message, /8787/);
  assert.match(foreignPortError(8787).message, /not proven to belong to this checkout/);
  assert.match(foreignPortError(8787).message, /refusing to terminate/);
});

test("a real foreign listener survives occupied-port refusal", async () => {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolvePromise);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await assert.rejects(
      requirePortsFree([address.port]),
      /not proven to belong to this checkout/,
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
});

test("local lifecycle contains no blanket pkill or unconditional shell kill -9", () => {
  const source = readFileSync(new URL("./local.mjs", import.meta.url), "utf8");
  assert.equal(/\bpkill\b/.test(source), false);
  assert.equal(/kill\s+-9/.test(source), false);
  assert.equal(/lsof\s+-ti/.test(source), false);
});
