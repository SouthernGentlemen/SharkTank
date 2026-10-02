import test from "node:test";
import assert from "node:assert/strict";
import { publicationContextFailures, publishOrVerifyRelease, validateReleaseRecord } from "./release-publication.mjs";

const release = "v1.2.3";
const validRecord = { tag_name: release, name: release, draft: false, prerelease: false };
const validEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "Wizard-Gang/SharkTank",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  SHARKTANK_EXPECTED_SHA: "a".repeat(40),
  SHARKTANK_RELEASE_WORKFLOW_REF: "Wizard-Gang/SharkTank/.github/workflows/release.yml@refs/heads/main",
  GH_TOKEN: "test-token",
};

function result(status, stdout = "", stderr = "") {
  return { status, stdout, stderr };
}

function validJson(record = validRecord) {
  return JSON.stringify(record);
}

test("governed Release workflow context passes", () => {
  assert.deepEqual(publicationContextFailures({ env: validEnv, release }), []);
});

test("revision release identity passes governed publication context", () => {
  assert.deepEqual(publicationContextFailures({ env: validEnv, release: "v1.2.3-r1" }), []);
});

test("workstation and wrong workflow contexts fail closed", () => {
  const failures = publicationContextFailures({ env: {}, release: "1.2.3" }).join("\n");
  assert.match(failures, /vX\.Y\.Z or vX\.Y\.Z-rN/);
  assert.match(failures, /requires GitHub Actions/);
  assert.match(failures, /exact main Release workflow context/);
  assert.match(failures, /GH_TOKEN is required/);
});

test("publication cannot run from a different workflow ref or without accepted SHA", () => {
  const failures = publicationContextFailures({
    env: {
      ...validEnv,
      GITHUB_REF: "refs/heads/feature",
      SHARKTANK_EXPECTED_SHA: undefined,
    },
    release,
  }).join("\n");
  assert.match(failures, /main workflow ref/);
  assert.match(failures, /exact accepted main SHA/);
});

test("matching existing Release is verified without mutation", () => {
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    return result(0, validJson());
  };
  const published = publishOrVerifyRelease({ release, runGh });
  assert.equal(published.kind, "existing");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "api");
});

test("absent Release is created once and then verified", () => {
  const calls = [];
  const responses = [
    result(1, "", "gh: Not Found (HTTP 404)"),
    result(0, "created"),
    result(0, validJson()),
  ];
  const runGh = (args) => {
    calls.push(args);
    return responses.shift();
  };
  const published = publishOrVerifyRelease({ release, runGh });
  assert.equal(published.kind, "created");
  assert.deepEqual(calls[1], ["release", "create", release, "--verify-tag", "--generate-notes", "--title", release]);
  assert.equal(calls.filter((args) => args[0] === "release").length, 1);
});

test("draft existing Release fails without mutation", () => {
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    return result(0, validJson({ ...validRecord, draft: true }));
  };
  assert.throws(() => publishOrVerifyRelease({ release, runGh }), /must not be a draft/);
  assert.equal(calls.length, 1);
});

test("prerelease existing Release fails without mutation", () => {
  assert.match(validateReleaseRecord({ ...validRecord, prerelease: true }, release).join("\n"), /must not be a prerelease/);
});

test("mismatched tag or title fails without mutation", () => {
  assert.match(validateReleaseRecord({ ...validRecord, tag_name: "v1.2.4" }, release).join("\n"), /tag v1\.2\.4 != v1\.2\.3/);
  assert.match(validateReleaseRecord({ ...validRecord, name: "wrong" }, release).join("\n"), /title wrong != v1\.2\.3/);
});

test("non-404 lookup failure does not attempt creation", () => {
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    return result(1, "", "gh: authentication failed (HTTP 401)");
  };
  assert.throws(() => publishOrVerifyRelease({ release, runGh }), /lookup failed/);
  assert.equal(calls.length, 1);
});

test("creation race accepts a matching Release created by another run", () => {
  const calls = [];
  const responses = [
    result(1, "", "gh: Not Found (HTTP 404)"),
    result(1, "", "gh: already_exists (HTTP 422)"),
    result(0, validJson()),
  ];
  const runGh = (args) => {
    calls.push(args);
    return responses.shift();
  };
  const published = publishOrVerifyRelease({ release, runGh });
  assert.equal(published.kind, "existing");
  assert.equal(calls.filter((args) => args[0] === "release").length, 1);
});

test("creation failure plus conflicting follow-up fails closed", () => {
  const responses = [
    result(1, "", "gh: Not Found (HTTP 404)"),
    result(1, "", "gh: already_exists (HTTP 422)"),
    result(0, validJson({ ...validRecord, prerelease: true })),
  ];
  const runGh = () => responses.shift();
  assert.throws(() => publishOrVerifyRelease({ release, runGh }), /follow-up verification failed/);
});
