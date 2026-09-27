import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const localSource = readFileSync(new URL("./local.mjs", import.meta.url), "utf8");
const readinessSource = readFileSync(new URL("./local-readiness.mjs", import.meta.url), "utf8");

test("dev and local share the one safe local lifecycle implementation", () => {
  assert.equal(packageJson.scripts.dev, "node scripts/local.mjs");
  assert.equal(packageJson.scripts.local, packageJson.scripts.dev);
  assert.notEqual(packageJson.scripts.dev, "wrangler dev --port 8787");
});

test("raw Wrangler remains explicit and start preserves its previous Worker-only behavior", () => {
  assert.equal(packageJson.scripts["dev:worker"], "wrangler dev --port 8787");
  assert.equal(packageJson.scripts.start, "npm run dev:worker");
});

test("the dev lifecycle retains ST-069 ownership and fail-closed port boundaries", () => {
  for (const marker of [
    "await stopRecordedWrangler()",
    "existsSync(WRANGLER_OWNER_FILE)",
    "await requirePortsFree",
    "createOwnershipRecord",
    "writeOwnershipRecord",
    "await stopOwnedWrangler(ownerRecord)",
  ]) {
    assert.equal(localSource.includes(marker), true, marker);
  }
  assert.equal(/\bpkill\b/.test(localSource), false);
  assert.equal(/kill\s+-9/.test(localSource), false);
  assert.equal(/lsof\s+-ti/.test(localSource), false);
});

test("the dev lifecycle retains ST-070 bounded generated-state reset", () => {
  assert.equal(localSource.includes("parseLocalLifecycleArgs(process.argv.slice(2))"), true);
  assert.equal(readinessSource.includes("...parseLocalResetArgs(resetArgs)"), true);
  assert.equal(localSource.includes("createLocalResetPlan(PROJECT_ROOT)"), true);
  assert.equal(localSource.includes("executeLocalResetPlan(resetPlan)"), true);
});

test("foreign-port refusal and reset validation remain before Wrangler startup and readiness", () => {
  const ports = localSource.indexOf("await requirePortsFree");
  const reset = localSource.indexOf("executeLocalResetPlan(resetPlan)");
  const spawn = localSource.indexOf('spawn("npx", ["wrangler", "dev"');
  const readiness = localSource.indexOf("waitForHttpReady({");
  assert.ok(ports > 0 && ports < reset);
  assert.ok(reset < spawn);
  assert.ok(spawn < readiness);
});

test("readiness failure cleanup reuses checkout-owned process handling", () => {
  const cleanup = localSource.indexOf("async function cleanupFailedStartup(ownerRecord)");
  assert.ok(cleanup > 0);
  assert.ok(localSource.indexOf("await stopOwnedWrangler(ownerRecord)", cleanup) > cleanup);
  assert.equal(localSource.includes('signalManagedChild(child, "SIGKILL")'), false);
});

test("fixed-delay browser opening is gone and readiness owns browser ordering", () => {
  assert.equal(localSource.includes("setTimeout(() => {"), false);
  assert.equal(localSource.includes("}, 4000);"), false);
  assert.equal(localSource.includes("waitForReadinessAndMaybeOpen({"), true);
  assert.equal(localSource.includes("noOpen,"), true);
});
