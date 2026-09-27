#!/usr/bin/env node
// Safe local dev lifecycle: teardown → reset → build → start → readiness → open.
// Run with: npm run dev (npm run local is the compatibility alias); Ctrl-C stops managed Wrangler.
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createOwnershipRecord,
  inspectProcess,
  readOwnershipRecord,
  removeOwnershipRecord,
  requirePortsFree,
  stopOwnedProcess,
  writeOwnershipRecord,
} from "./local-process-ownership.mjs";
import {
  parseLocalLifecycleArgs,
  waitForHttpReady,
  waitForReadinessAndMaybeOpen,
} from "./local-readiness.mjs";
import {
  createLocalResetPlan,
  executeLocalResetPlan,
} from "./local-reset.mjs";

const PORT = 8787;
const APP_URL = `http://localhost:${PORT}`;
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const WRANGLER_OWNER_FILE = join(PROJECT_ROOT, ".wrangler", "sharktank-local-owner.json");
const { noOpen } = parseLocalLifecycleArgs(process.argv.slice(2));

const run = (cmd, opts = {}) =>
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: "inherit", ...opts });
const quiet = (cmd) => {
  try {
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: "ignore" });
  } catch {
    // Best-effort local convenience commands must not redefine lifecycle success.
  }
};
const step = (msg) => console.log(`\n\x1b[35m▸ ${msg}\x1b[0m`);

function signalManagedChild(child, signal) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopOwnedWrangler(record) {
  if (!record) return true;
  const result = await stopOwnedProcess(record, {
    kind: "wrangler",
    root: PROJECT_ROOT,
    cwd: PROJECT_ROOT,
    group: true,
  });
  if (result.stopped || result.reason === "not-running") {
    removeOwnershipRecord(WRANGLER_OWNER_FILE);
    return true;
  }
  return false;
}

async function stopRecordedWrangler() {
  const record = readOwnershipRecord(WRANGLER_OWNER_FILE);
  if (!record) return;

  if (await stopOwnedWrangler(record)) return;
  console.warn(
    "\x1b[33m⚠ Existing Wrangler ownership record could not be proven; it will not be signaled.\x1b[0m",
  );
}

async function captureWranglerOwner(child) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const identity = inspectProcess(child.pid);
    if (identity?.cwd === PROJECT_ROOT) {
      return createOwnershipRecord(identity, {
        kind: "wrangler",
        root: PROJECT_ROOT,
        cwd: PROJECT_ROOT,
      });
    }
    if (child.exitCode !== null) break;
    await sleep(50);
  }
  throw new Error("could not establish checkout ownership for the started Wrangler process");
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  quiet(`${opener} ${url}`);
}

async function cleanupFailedStartup(ownerRecord) {
  if (!(await stopOwnedWrangler(ownerRecord))) {
    throw new Error(
      "Wrangler ownership changed during startup cleanup; refusing further signals.",
    );
  }
}

// 0. First-run setup.
if (!existsSync(join(PROJECT_ROOT, "node_modules"))) {
  step("Installing dependencies (first run)");
  run("npm install");
}

// 1. TEARDOWN — stop only a process whose ownership by this checkout is proven.
step("Teardown: stopping checkout-owned local server only");
await stopRecordedWrangler();
if (existsSync(WRANGLER_OWNER_FILE)) {
  throw new Error(
    "Wrangler ownership remains ambiguous for this checkout; refusing to reset .wrangler/.",
  );
}
await requirePortsFree([PORT]);

// 2. RESET — clear only positively classified checkout-local generated state.
const resetPlan = createLocalResetPlan(PROJECT_ROOT);
step("Reset: clearing disposable dist/ and .wrangler/");
executeLocalResetPlan(resetPlan);

// 3. BUILD — the client bundle.
step("Build: vite build");
run("npx vite build");

// 4. START — Cloudflare Worker in the foreground.
step(`Start: wrangler dev on port ${PORT}`);
const child = spawn("npx", ["wrangler", "dev", "--port", String(PORT)], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  detached: process.platform !== "win32",
});

let startupComplete = false;
let observedChildExit = false;
let observedChildExitCode = 1;
const clearWranglerOwner = () => removeOwnershipRecord(WRANGLER_OWNER_FILE);

child.on("exit", (code) => {
  observedChildExit = true;
  observedChildExitCode = code ?? 1;
  if (!startupComplete) return;
  clearWranglerOwner();
  process.exit(code ?? 0);
});

let ownerRecord;
try {
  ownerRecord = await captureWranglerOwner(child);
  writeOwnershipRecord(WRANGLER_OWNER_FILE, ownerRecord);
} catch (error) {
  throw error;
}

process.on("SIGINT", () => signalManagedChild(child, "SIGINT"));
process.on("SIGTERM", () => signalManagedChild(child, "SIGTERM"));
process.on("exit", clearWranglerOwner);

// 5. READINESS + OPEN — HTTP readiness is bounded; browser launching is optional/best-effort.
try {
  await waitForReadinessAndMaybeOpen({
    noOpen,
    waitForReadyFn: () => waitForHttpReady({
      url: APP_URL,
      childExitedFn: () => observedChildExit || child.exitCode !== null,
    }),
    onReadyFn: () => step(
      `Ready: ${APP_URL}${noOpen ? "   (browser opening disabled by --no-open)" : ""}`,
    ),
    openFn: () => openBrowser(APP_URL),
  });
  if (observedChildExit || child.exitCode !== null) {
    throw new Error("managed Wrangler exited before local application readiness completed");
  }
} catch (error) {
  try {
    await cleanupFailedStartup(ownerRecord);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "local application startup failed and cleanup could not be fully verified",
    );
  }
  throw error;
}

startupComplete = true;
if (observedChildExit || child.exitCode !== null) {
  clearWranglerOwner();
  process.exit(observedChildExitCode);
}
