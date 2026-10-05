import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentPreconditionFailures, deploymentVariables, productReleaseIdentity } from "./deploy-prod.mjs";

const release = "v1.2.3-r1";
const deploySource = readFileSync(new URL("./deploy-prod.mjs", import.meta.url), "utf8");
const validEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "Wizard-Gang/SharkTank",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  SHARKTANK_EXPECTED_SHA: "a".repeat(40),
  SHARKTANK_RELEASE_WORKFLOW_REF: "Wizard-Gang/SharkTank/.github/workflows/release.yml@refs/heads/main",
  SHARKTANK_RELEASE_CHECKOUT: "/tmp/tagged-checkout",
  GITHUB_WORKSPACE: "/tmp/tagged-checkout",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
};

function real(overrides = {}) {
  return deploymentPreconditionFailures({
    dryRun: false,
    env: { ...validEnv, ...(overrides.env ?? {}) },
    release: overrides.release ?? release,
    tagsAtHead: overrides.tagsAtHead ?? [release],
    releaseIdentityFailures: overrides.releaseIdentityFailures ?? [],
  });
}

test("deployment separates public product identity from immutable release revision", () => {
  assert.equal(productReleaseIdentity(release), "v1.2.3");
  assert.deepEqual(deploymentVariables(release), [
    "SHARKTANK_RELEASE:v1.2.3",
    "SHARKTANK_RELEASE_REVISION:v1.2.3-r1",
  ]);
  assert.deepEqual(deploymentVariables("v1.2.3"), [
    "SHARKTANK_RELEASE:v1.2.3",
    "SHARKTANK_RELEASE_REVISION:v1.2.3",
  ]);
});

test("governed release workflow context can reach the real deployment path", () => {
  assert.deepEqual(real(), []);
});

test("ordinary local invocation cannot reach the real deployment path", () => {
  const failures = real({ env: {
    GITHUB_ACTIONS: undefined,
    GITHUB_REPOSITORY: undefined,
    GITHUB_EVENT_NAME: undefined,
    GITHUB_REF: undefined,
    SHARKTANK_RELEASE_WORKFLOW_REF: undefined,
  } });
  assert.match(failures.join("\n"), /requires GitHub Actions/);
  assert.match(failures.join("\n"), /exact main Release workflow context/);
});

test("untagged checkout cannot reach the real deployment path", () => {
  const failures = real({
    env: {
      GITHUB_EVENT_NAME: "push",
    },
    tagsAtHead: [],
  });
  assert.match(failures.join("\n"), /vX\.Y\.Z or vX\.Y\.Z-rN annotated release identity tag pointing at HEAD/);
  assert.match(failures.join("\n"), /requires explicit release dispatch/);
});

test("missing expected commit or wrong workflow ref cannot reach production", () => {
  const failures = real({ env: { SHARKTANK_EXPECTED_SHA: undefined, GITHUB_REF: "refs/heads/feature" } });
  assert.match(failures.join("\n"), /exact accepted main SHA/);
  assert.match(failures.join("\n"), /main Release workflow ref/);
});

test("a different workflow context cannot reach the real deployment path", () => {
  const failures = real({
    env: {
      SHARKTANK_RELEASE_WORKFLOW_REF: "Wizard-Gang/SharkTank/.github/workflows/deploy.yml@refs/heads/main",
    },
  });
  assert.match(failures.join("\n"), /exact main Release workflow context/);
});

test("exact release identity failures block real production deployment", () => {
  const failures = real({ releaseIdentityFailures: ["release tag must be annotated: v1.2.3-r1"] });
  assert.match(failures.join("\n"), /exact release identity failed: release tag must be annotated/);
});

test("real deployment requires protected-environment Cloudflare credentials", () => {
  const failures = real({ env: { CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_API_TOKEN: undefined } });
  assert.match(failures.join("\n"), /CLOUDFLARE_ACCOUNT_ID is required/);
  assert.match(failures.join("\n"), /CLOUDFLARE_API_TOKEN is required/);
});

test("deployment does not require retired operator secrets", () => {
  assert.doesNotMatch(deploySource, /OPS_TOKEN|OPS_USERNAME|wrangler", "secret", "list"/);
  assert.deepEqual(real(), []);
});

test("local dry-run keeps tag and account requirements without GitHub Actions", () => {
  assert.deepEqual(deploymentPreconditionFailures({
    dryRun: true,
    env: { CLOUDFLARE_ACCOUNT_ID: "local-account" },
    release,
    tagsAtHead: [release],
    releaseIdentityFailures: ["ignored for dry-run"],
  }), []);
});
