import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAcceptanceEnvFile,
  localWorkerEnvironment,
  runLocalHttpAcceptance,
  signalWorkerGroup,
  startLocalWorker,
} from "./local-worker-acceptance.mjs";

function fakeChild(pid = 43210) {
  return { pid, exitCode: null, kill() {} };
}

test("child start failure is reported without cleanup of unrelated processes", async () => {
  let stopped = 0;
  await assert.rejects(
    runLocalHttpAcceptance({
      portAvailableFn: async () => true,
      startWorkerFn: () => { throw new Error("spawn failed"); },
      stopWorkerFn: async () => { stopped += 1; },
      sleepFn: async () => {},
    }),
    /spawn failed/,
  );
  assert.equal(stopped, 0);
});

test("readiness timeout always stops the started Worker", async () => {
  const child = fakeChild();
  let stopped = 0;
  await assert.rejects(
    runLocalHttpAcceptance({
      portAvailableFn: async () => true,
      startWorkerFn: () => child,
      waitForReadyFn: async () => { throw new Error("readiness timeout"); },
      stopWorkerFn: async () => { stopped += 1; child.exitCode = 0; },
      sleepFn: async () => {},
    }),
    /readiness timeout/,
  );
  assert.equal(stopped, 1);
});

test("acceptance failure always stops the started Worker", async () => {
  const child = fakeChild();
  let stopped = 0;
  await assert.rejects(
    runLocalHttpAcceptance({
      portAvailableFn: async () => true,
      startWorkerFn: () => child,
      waitForReadyFn: async () => {},
      runChecksFn: async () => { throw new Error("acceptance failed"); },
      stopWorkerFn: async () => { stopped += 1; child.exitCode = 0; },
      sleepFn: async () => {},
    }),
    /acceptance failed/,
  );
  assert.equal(stopped, 1);
});

test("successful acceptance still stops the Worker", async () => {
  const child = fakeChild();
  let stopped = 0;
  const result = await runLocalHttpAcceptance({
    portAvailableFn: async () => true,
    startWorkerFn: () => child,
    waitForReadyFn: async () => {},
    runChecksFn: async () => {},
    stopWorkerFn: async () => { stopped += 1; child.exitCode = 0; },
    sleepFn: async () => {},
  });
  assert.equal(stopped, 1);
  assert.equal(result.baseUrl, "http://127.0.0.1:8792");
});

test("occupied port aborts before starting or killing anything", async () => {
  let started = 0;
  let stopped = 0;
  await assert.rejects(
    runLocalHttpAcceptance({
      portAvailableFn: async () => false,
      startWorkerFn: () => { started += 1; return fakeChild(); },
      stopWorkerFn: async () => { stopped += 1; },
      sleepFn: async () => {},
    }),
    /already in use/,
  );
  assert.equal(started, 0);
  assert.equal(stopped, 0);
});

test("Unix cleanup signals only the spawned process group", () => {
  const calls = [];
  signalWorkerGroup(fakeChild(9876), "SIGTERM", {
    platform: "linux",
    killProcess: (pid, signal) => calls.push([pid, signal]),
  });
  assert.deepEqual(calls, [[-9876, "SIGTERM"]]);
});

test("local Worker environment strips provider inputs", () => {
  const env = localWorkerEnvironment({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CLOUDFLARE_API_KEY: "provider-key",
    CLOUDFLARE_ACCOUNT_ID: "provider-account",
    CLOUDFLARE_EMAIL: "provider-email",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CI, "1");
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(env.CLOUDFLARE_API_KEY, undefined);
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, undefined);
  assert.equal(env.CLOUDFLARE_EMAIL, undefined);
  assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, "false");
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, undefined);
});

test("acceptance uses an explicit test-owned env file beside a conflicting ignored fixture", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "sharktank-local-http-case-"));
  try {
    writeFileSync(
      join(fixtureRoot, ".dev.vars"),
      'EXAMPLE_VAR="fixture-conflict"\n',
      { encoding: "utf8", mode: 0o600 },
    );
    const acceptanceEnv = createAcceptanceEnvFile({ tempRoot: fixtureRoot });
    try {
      let invocation;
      const child = fakeChild();
      startLocalWorker({
        port: 8792,
        envFilePath: acceptanceEnv.path,
        projectRoot: fixtureRoot,
        spawnFn: (command, args, options) => {
          invocation = { command, args, options };
          return child;
        },
      });

      assert.equal(invocation.command, process.execPath);
      assert.equal(invocation.options.cwd, fixtureRoot);
      assert.ok(invocation.args.includes("--local"));
      assert.deepEqual(
        invocation.args.slice(-4),
        ["--port", "8792", "--env-file", acceptanceEnv.path],
      );
      assert.equal(invocation.args.includes("--var"), false);
      assert.notEqual(acceptanceEnv.path, join(fixtureRoot, ".dev.vars"));
      assert.equal(readFileSync(acceptanceEnv.path, "utf8"), "");
    } finally {
      const path = acceptanceEnv.path;
      acceptanceEnv.dispose();
      assert.equal(existsSync(path), false);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("test-owned env file is disposed when Worker startup fails", async () => {
  let disposed = 0;
  await assert.rejects(
    runLocalHttpAcceptance({
      portAvailableFn: async () => true,
      createAcceptanceEnvFileFn: () => ({
        path: "/test-owned/acceptance.env",
        dispose: () => { disposed += 1; },
      }),
      startWorkerFn: () => { throw new Error("spawn failed"); },
      sleepFn: async () => {},
    }),
    /spawn failed/,
  );
  assert.equal(disposed, 1);
});

test("test-owned env file is disposed after successful acceptance", async () => {
  const child = fakeChild();
  let disposed = 0;
  await runLocalHttpAcceptance({
    portAvailableFn: async () => true,
    createAcceptanceEnvFileFn: () => ({
      path: "/test-owned/acceptance.env",
      dispose: () => { disposed += 1; },
    }),
    startWorkerFn: ({ envFilePath }) => {
      assert.equal(envFilePath, "/test-owned/acceptance.env");
      return child;
    },
    waitForReadyFn: async () => {},
    runChecksFn: async () => {},
    stopWorkerFn: async () => { child.exitCode = 0; },
    sleepFn: async () => {},
  });
  assert.equal(disposed, 1);
});
