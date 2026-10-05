import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateReleaseWorkflow, validateReleaseTagWorkflow, validateVersionToProductionChain } from "./release-workflow.mjs";

const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const tag = readFileSync(new URL("../.github/workflows/tag-release.yml", import.meta.url), "utf8");
const change = (from, to) => {
  assert.ok(release.includes(from));
  return release.replace(from, to);
};

test("the existing tag, publication and pinned baseline deployment chain passes", () => {
  assert.deepEqual(validateReleaseTagWorkflow(tag), []);
  assert.deepEqual(validateReleaseWorkflow(release), []);
  assert.deepEqual(validateVersionToProductionChain({ tagWorkflow: tag, releaseWorkflow: release }), []);
});

test("release requires explicit exact tag and SHA dispatch", () => {
  assert.match(validateReleaseWorkflow(change("  workflow_dispatch:", "  push:")).join("\n"), /only by explicit dispatch/);
  assert.match(validateReleaseWorkflow(change("      expected_sha:\n", "      other_sha:\n")).join("\n"), /require expected accepted SHA input/);
});

test("verification and publication retain exact history and guarded publication", () => {
  assert.match(validateReleaseWorkflow(change("          fetch-depth: 0", "          fetch-depth: 1")).join("\n"), /verify must checkout full Git\/tag history/);
  assert.match(validateReleaseWorkflow(change('run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-publication.mjs"', 'run: gh release create "$SHARKTANK_RELEASE"')).join("\n"), /guarded create-or-verify/);
  assert.match(validateReleaseWorkflow(change("    needs: verify", "    needs: deploy-production")).join("\n"), /publish-release must depend/);
});

test("deployment remains after publication on the pinned baseline workflow", () => {
  assert.match(validateReleaseWorkflow(change("    needs: publish-release", "    needs: verify")).join("\n"), /deploy-production must depend/);
  assert.match(validateReleaseWorkflow(change("deploy-worker.yml@67b4b86847e0d635a3f6fe4c21618a25d5bc71a0", "deploy-worker.yml@main")).join("\n"), /pinned baseline workflow/);
  assert.match(validateReleaseWorkflow(change("      worker: sharktank", "      worker: demo")).join("\n"), /select the sharktank Worker/);
  assert.match(validateReleaseWorkflow(change("    secrets: inherit", "    secrets: {}" )).join("\n"), /inherit the caller secret boundary/);
  assert.match(validateReleaseWorkflow(change("  deploy-production:\n    needs:", "  deploy-production:\n    if: vars.PRODUCTION_DEPLOY_ENABLED == 'true'\n    needs:")).join("\n"), /without a variable gate/);
});
