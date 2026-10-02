import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyReleaseTag, planReleaseTag, taggingContextFailures } from "./release-tag.mjs";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return (result.stdout ?? "").trim();
}

function writeVersionFiles(cwd, version, lockVersion = version) {
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "fixture", version }, null, 2) + "\n");
  writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({
    name: "fixture",
    version: lockVersion,
    lockfileVersion: 3,
    packages: { "": { name: "fixture", version: lockVersion } },
  }, null, 2) + "\n");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sharktank-release-tag-"));
  const cwd = join(root, "work");
  const remote = join(root, "origin.git");
  git(root, "init", "-q", "--bare", remote);
  git(root, "init", "-q", cwd);
  git(cwd, "config", "user.name", "Release Tag Test");
  git(cwd, "config", "user.email", "release-tag@example.invalid");
  git(cwd, "branch", "-M", "main");
  git(cwd, "remote", "add", "origin", remote);
  writeVersionFiles(cwd, "1.2.3");
  git(cwd, "add", "package.json", "package-lock.json");
  git(cwd, "commit", "-qm", "initial");
  git(cwd, "push", "-q", "-u", "origin", "main");
  return { root, cwd };
}

function commitVersion(cwd, version, lockVersion = version) {
  writeVersionFiles(cwd, version, lockVersion);
  git(cwd, "add", "package.json", "package-lock.json");
  git(cwd, "commit", "-qm", `version ${version}`);
  git(cwd, "push", "-q", "origin", "main");
  return git(cwd, "rev-parse", "HEAD");
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

const validEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "Wizard-Gang/SharkTank",
  GITHUB_EVENT_NAME: "workflow_run",
  GITHUB_REF: "refs/heads/main",
  SHARKTANK_TAG_WORKFLOW_REF: "Wizard-Gang/SharkTank/.github/workflows/tag-release.yml@refs/heads/main",
};

test("governed main workflow context passes", () => {
  assert.deepEqual(taggingContextFailures({ env: validEnv, targetSha: "a".repeat(40) }), []);
});

test("workstation or wrong workflow context fails closed", () => {
  const failures = taggingContextFailures({ env: {}, targetSha: "not-a-sha" });
  assert.match(failures.join("\n"), /requires GitHub Actions/);
  assert.match(failures.join("\n"), /completed CI workflow_run event/);
  assert.match(failures.join("\n"), /exact Release Tag workflow on main/);
  assert.match(failures.join("\n"), /exact 40-character commit SHA/);
});

test("ordinary accepted main commit with unchanged package version creates no tag", () => {
  const { root, cwd } = fixture();
  try {
    writeFileSync(join(cwd, "README.md"), "ordinary change\n");
    git(cwd, "add", "README.md");
    git(cwd, "commit", "-qm", "ordinary change");
    git(cwd, "push", "-q", "origin", "main");
    const targetSha = git(cwd, "rev-parse", "HEAD");
    assert.deepEqual(applyReleaseTag({ cwd, targetSha }), { kind: "noop", version: "1.2.3", targetSha });
    assert.equal(git(cwd, "ls-remote", "--tags", "origin"), "");
  } finally {
    cleanup(root);
  }
});

test("accepted lockstep version increase creates exactly one annotated tag at the merged commit", () => {
  const { root, cwd } = fixture();
  try {
    const targetSha = commitVersion(cwd, "1.2.4");
    const result = applyReleaseTag({ cwd, targetSha });
    assert.equal(result.kind, "created");
    assert.equal(result.tag, "v1.2.4");
    assert.equal(git(cwd, "cat-file", "-t", "refs/tags/v1.2.4"), "tag");
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.4^{commit}"), targetSha);
    const remote = git(cwd, "ls-remote", "--tags", "origin", "refs/tags/v1.2.4", "refs/tags/v1.2.4^{}");
    assert.equal(remote.split("\n").filter(Boolean).length, 2);
    assert.match(remote, new RegExp(`${targetSha}\\s+refs/tags/v1\\.2\\.4\\^\\{\\}`));
  } finally {
    cleanup(root);
  }
});

test("existing matching annotated tag is idempotent", () => {
  const { root, cwd } = fixture();
  try {
    const targetSha = commitVersion(cwd, "1.2.4");
    git(cwd, "tag", "-a", "v1.2.4", targetSha, "-m", "Release v1.2.4");
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.4");
    const result = applyReleaseTag({ cwd, targetSha });
    assert.equal(result.kind, "existing");
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.4^{commit}"), targetSha);
  } finally {
    cleanup(root);
  }
});

test("existing lightweight release tag is a hard conflict and is never rewritten", () => {
  const { root, cwd } = fixture();
  try {
    const targetSha = commitVersion(cwd, "1.2.4");
    git(cwd, "tag", "v1.2.4", targetSha);
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.4");
    assert.throws(() => applyReleaseTag({ cwd, targetSha }), /not annotated/);
    assert.equal(git(cwd, "cat-file", "-t", "refs/tags/v1.2.4"), "commit");
  } finally {
    cleanup(root);
  }
});

test("existing annotated release tag on another commit is a hard conflict and is never moved", () => {
  const { root, cwd } = fixture();
  try {
    const oldSha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "tag", "-a", "v1.2.4", oldSha, "-m", "conflict");
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.4");
    const targetSha = commitVersion(cwd, "1.2.4");
    assert.throws(() => applyReleaseTag({ cwd, targetSha }), /points to .* not/);
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.4^{commit}"), oldSha);
  } finally {
    cleanup(root);
  }
});

test("ordinary version decreases are rejected", () => {
  const { root, cwd } = fixture();
  try {
    const targetSha = commitVersion(cwd, "1.2.2");
    assert.throws(() => planReleaseTag({ cwd, targetSha }), /release version must increase/);
  } finally {
    cleanup(root);
  }
});

test("restoring an already-published annotated ancestor release is a guarded no-op", () => {
  const { root, cwd } = fixture();
  try {
    const v123Sha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "tag", "-a", "v1.2.3", v123Sha, "-m", "Release v1.2.3");
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.3");

    const v124Sha = commitVersion(cwd, "1.2.4");
    git(cwd, "tag", "-a", "v1.2.4", v124Sha, "-m", "Release v1.2.4");
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.4");

    const targetSha = commitVersion(cwd, "1.2.3");
    const result = applyReleaseTag({ cwd, targetSha });
    assert.deepEqual(result, {
      kind: "noop",
      version: "1.2.3",
      targetSha,
      reconciliationTag: "v1.2.3",
      previousReleaseTag: "v1.2.4",
    });
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.3^{commit}"), v123Sha);
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.4^{commit}"), v124Sha);
    assert.equal(git(cwd, "ls-remote", "--tags", "origin", "refs/tags/v1.2.3", "refs/tags/v1.2.3^{}").split("\n").filter(Boolean).length, 2);
  } finally {
    cleanup(root);
  }
});

test("a tagged rollback is rejected unless the previous published release is also proven", () => {
  const { root, cwd } = fixture();
  try {
    const v123Sha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "tag", "-a", "v1.2.3", v123Sha, "-m", "Release v1.2.3");
    git(cwd, "push", "-q", "origin", "refs/tags/v1.2.3");

    commitVersion(cwd, "1.2.4");
    const targetSha = commitVersion(cwd, "1.2.3");
    assert.throws(() => planReleaseTag({ cwd, targetSha }), /requires previous published release v1\.2\.4/);
    assert.equal(git(cwd, "rev-parse", "refs/tags/v1.2.3^{commit}"), v123Sha);
  } finally {
    cleanup(root);
  }
});

test("a lightweight ancestor tag cannot authorize release reconciliation", () => {
  const { root, cwd } = fixture();
  try {
    const v123Sha = git(cwd, "rev-parse", "HEAD");
    git(cwd, "tag", "v1.2.3", v123Sha);

    const v124Sha = commitVersion(cwd, "1.2.4");
    git(cwd, "tag", "-a", "v1.2.4", v124Sha, "-m", "Release v1.2.4");
    const targetSha = commitVersion(cwd, "1.2.3");

    assert.throws(() => planReleaseTag({ cwd, targetSha }), /requires existing annotated v1\.2\.3/);
    assert.equal(git(cwd, "cat-file", "-t", "refs/tags/v1.2.3"), "commit");
  } finally {
    cleanup(root);
  }
});

test("package-lock version authority must move with package.json", () => {
  const { root, cwd } = fixture();
  try {
    const targetSha = commitVersion(cwd, "1.2.4", "1.2.3");
    assert.throws(() => planReleaseTag({ cwd, targetSha }), /current package-lock\.json version must equal 1\.2\.4/);
  } finally {
    cleanup(root);
  }
});

test("accepted target SHA must be the checked-out merged commit", () => {
  const { root, cwd } = fixture();
  try {
    const previous = git(cwd, "rev-parse", "HEAD");
    commitVersion(cwd, "1.2.4");
    assert.throws(() => planReleaseTag({ cwd, targetSha: previous }), /does not match accepted main SHA/);
  } finally {
    cleanup(root);
  }
});
