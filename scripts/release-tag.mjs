import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "Wizard-Gang/SharkTank";
const mainRef = "refs/heads/main";
const workflowRef = `${repository}/.github/workflows/tag-release.yml@${mainRef}`;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new Error(`${detail}: git ${args.join(" ")}`);
  }
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonAtRef(cwd, ref, path) {
  const result = git(cwd, ["show", `${ref}:${path}`]);
  return JSON.parse(result.stdout);
}

function semverParts(version) {
  if (!versionPattern.test(version ?? "")) return null;
  return version.split(".").map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function lockVersionFailures(lock, expected, label) {
  const failures = [];
  if (lock?.version !== expected) failures.push(`${label} package-lock.json version must equal ${expected}`);
  if (lock?.packages?.[""]?.version !== expected) failures.push(`${label} package-lock root package version must equal ${expected}`);
  return failures;
}

function releaseRevision(packageJson, label) {
  const value = packageJson?.releaseRevision ?? 0;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} package.json releaseRevision must be a non-negative integer`);
  return value;
}

export function taggingContextFailures({ env, targetSha }) {
  const failures = [];
  if (env.GITHUB_ACTIONS !== "true") failures.push("release tagging requires GitHub Actions");
  if (env.GITHUB_REPOSITORY !== repository) failures.push(`release tagging requires repository ${repository}`);
  if (env.GITHUB_EVENT_NAME !== "workflow_run") failures.push("release tagging requires the completed CI workflow_run event");
  if (env.GITHUB_REF !== mainRef) failures.push("release tagging requires the main branch workflow context");
  if (env.SHARKTANK_TAG_WORKFLOW_REF !== workflowRef) failures.push("release tagging requires the exact Release Tag workflow on main");
  if (!/^[0-9a-f]{40}$/.test(targetSha ?? "")) failures.push("SHARKTANK_MAIN_SHA must be an exact 40-character commit SHA");
  return failures;
}

export function planReleaseTag({ cwd, targetSha }) {
  if (!/^[0-9a-f]{40}$/.test(targetSha ?? "")) throw new Error("target SHA must be an exact 40-character commit SHA");

  const head = git(cwd, ["rev-parse", "HEAD"]).stdout;
  if (head !== targetSha) throw new Error(`checked-out HEAD ${head} does not match accepted main SHA ${targetSha}`);

  const parent = git(cwd, ["rev-parse", `${targetSha}^`], { allowFailure: true });
  if (parent.status !== 0) throw new Error("accepted main commit must have a parent to compare release authority");

  const currentPackage = readJson(join(cwd, "package.json"));
  const previousPackage = readJsonAtRef(cwd, parent.stdout, "package.json");
  const currentVersion = currentPackage?.version;
  const previousVersion = previousPackage?.version;
  if (typeof currentVersion !== "string" || typeof previousVersion !== "string") throw new Error("root package.json version must be a string before and after the accepted main commit");

  const currentParts = semverParts(currentVersion);
  const previousParts = semverParts(previousVersion);
  if (!currentParts || !previousParts) throw new Error("release versions must use plain semantic X.Y.Z identity");

  const currentRevision = releaseRevision(currentPackage, "current");
  const previousRevision = releaseRevision(previousPackage, "previous");
  const currentLock = readJson(join(cwd, "package-lock.json"));
  const previousLock = readJsonAtRef(cwd, parent.stdout, "package-lock.json");
  const lockFailures = [
    ...lockVersionFailures(previousLock, previousVersion, "previous"),
    ...lockVersionFailures(currentLock, currentVersion, "current"),
  ];
  if (lockFailures.length) throw new Error(lockFailures.join("; "));

  const comparison = compareVersions(currentParts, previousParts);
  if (comparison === 0) {
    if (currentRevision === previousRevision) return { kind: "noop", version: currentVersion, releaseRevision: currentRevision, targetSha };
    if (currentRevision !== previousRevision + 1 || currentRevision < 1) {
      throw new Error(`release revision must advance exactly once for ${currentVersion}: r${previousRevision} -> r${currentRevision}`);
    }
    return {
      kind: "release",
      releaseKind: "revision",
      previousVersion,
      version: currentVersion,
      previousRevision,
      releaseRevision: currentRevision,
      tag: `v${currentVersion}-r${currentRevision}`,
      targetSha,
    };
  }

  if (comparison < 0) {
    if (currentRevision !== 0 || previousRevision !== 0) throw new Error("release version reconciliation requires releaseRevision 0 on both commits");

    const reconciliationTag = `v${currentVersion}`;
    const previousReleaseTag = `v${previousVersion}`;
    const reconciliationRef = `refs/tags/${reconciliationTag}`;
    const previousReleaseRef = `refs/tags/${previousReleaseTag}`;

    const reconciliationType = git(cwd, ["cat-file", "-t", reconciliationRef], { allowFailure: true });
    if (reconciliationType.status !== 0 || reconciliationType.stdout !== "tag") {
      throw new Error(`release version must increase: ${previousVersion} -> ${currentVersion}; reconciliation requires existing annotated ${reconciliationTag}`);
    }
    const previousReleaseType = git(cwd, ["cat-file", "-t", previousReleaseRef], { allowFailure: true });
    if (previousReleaseType.status !== 0 || previousReleaseType.stdout !== "tag") {
      throw new Error(`release version must increase: ${previousVersion} -> ${currentVersion}; reconciliation requires previous published release ${previousReleaseTag}`);
    }

    const reconciliationCommit = git(cwd, ["rev-parse", `${reconciliationRef}^{commit}`]).stdout;
    const previousReleaseCommit = git(cwd, ["rev-parse", `${previousReleaseRef}^{commit}`]).stdout;
    if (git(cwd, ["merge-base", "--is-ancestor", reconciliationCommit, targetSha], { allowFailure: true }).status !== 0) throw new Error(`release reconciliation requires ${reconciliationTag} to be an ancestor of accepted main`);
    if (git(cwd, ["merge-base", "--is-ancestor", previousReleaseCommit, targetSha], { allowFailure: true }).status !== 0) throw new Error(`release reconciliation requires ${previousReleaseTag} to be an ancestor of accepted main`);
    if (git(cwd, ["merge-base", "--is-ancestor", reconciliationCommit, previousReleaseCommit], { allowFailure: true }).status !== 0) throw new Error(`release reconciliation requires ${reconciliationTag} to precede ${previousReleaseTag}`);

    return { kind: "noop", version: currentVersion, releaseRevision: currentRevision, targetSha, reconciliationTag, previousReleaseTag };
  }

  if (currentRevision !== 0) throw new Error(`semantic release ${previousVersion} -> ${currentVersion} requires current releaseRevision 0`);
  return {
    kind: "release",
    releaseKind: "semantic",
    previousVersion,
    version: currentVersion,
    previousRevision,
    releaseRevision: currentRevision,
    tag: `v${currentVersion}`,
    targetSha,
  };
}

function localTagState({ cwd, tag, targetSha }) {
  const ref = `refs/tags/${tag}`;
  const type = git(cwd, ["cat-file", "-t", ref], { allowFailure: true });
  if (type.status !== 0) return { kind: "absent" };
  if (type.stdout !== "tag") return { kind: "conflict", reason: `existing ${tag} is not annotated` };
  const commit = git(cwd, ["rev-parse", `${ref}^{commit}`]);
  if (commit.stdout !== targetSha) return { kind: "conflict", reason: `existing ${tag} points to ${commit.stdout}, not ${targetSha}` };
  return { kind: "matching" };
}

function remoteTagState({ cwd, remote, tag, targetSha }) {
  const ref = `refs/tags/${tag}`;
  const result = git(cwd, ["ls-remote", "--tags", remote, ref, `${ref}^{}`]);
  if (!result.stdout) return { kind: "absent" };

  const refs = new Map(result.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, name] = line.split(/\s+/);
    return [name, sha];
  }));
  const direct = refs.get(ref);
  const peeled = refs.get(`${ref}^{}`);
  if (!direct) return { kind: "conflict", reason: `remote ${tag} state is incomplete` };
  if (!peeled) return { kind: "conflict", reason: `remote ${tag} is not annotated` };
  if (peeled !== targetSha) return { kind: "conflict", reason: `remote ${tag} points to ${peeled}, not ${targetSha}` };
  return { kind: "matching" };
}

export function applyReleaseTag({ cwd, targetSha, remote = "origin" }) {
  const plan = planReleaseTag({ cwd, targetSha });
  if (plan.kind === "noop") return plan;

  const local = localTagState({ cwd, tag: plan.tag, targetSha });
  if (local.kind === "conflict") throw new Error(local.reason);

  const remoteBefore = remoteTagState({ cwd, remote, tag: plan.tag, targetSha });
  if (remoteBefore.kind === "conflict") throw new Error(remoteBefore.reason);
  if (remoteBefore.kind === "matching") return { ...plan, kind: "existing" };

  if (local.kind === "absent") {
    git(cwd, [
      "-c", "user.name=github-actions[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "tag", "-a", plan.tag, targetSha, "-m", `Release ${plan.tag}`,
    ]);
  }

  const pushed = git(cwd, ["push", remote, `refs/tags/${plan.tag}`], { allowFailure: true });
  if (pushed.status !== 0) {
    const raced = remoteTagState({ cwd, remote, tag: plan.tag, targetSha });
    if (raced.kind === "matching") return { ...plan, kind: "existing" };
    throw new Error((pushed.stderr || pushed.stdout || `failed to push ${plan.tag}`).trim());
  }

  const remoteAfter = remoteTagState({ cwd, remote, tag: plan.tag, targetSha });
  if (remoteAfter.kind !== "matching") throw new Error(remoteAfter.reason ?? `remote ${plan.tag} was not verifiably created`);
  return { ...plan, kind: "created" };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const targetSha = (process.env.SHARKTANK_MAIN_SHA ?? "").trim();
  const failures = taggingContextFailures({ env: process.env, targetSha });
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }

  try {
    const result = applyReleaseTag({ cwd: process.cwd(), targetSha });
    if (result.kind !== "noop" && process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `tag=${result.tag}\nexpected_sha=${result.targetSha}\n`);
    }
    if (result.kind === "noop" && result.reconciliationTag) {
      console.log(`Release tagging reconciled: ${result.reconciliationTag} already exists in accepted main ancestry; no new tag or release dispatch output emitted.`);
    } else if (result.kind === "noop") console.log(`Release tagging skipped: release authority remains ${result.version} r${result.releaseRevision ?? 0}.`);
    else if (result.kind === "existing") console.log(`Release tag already matches accepted main commit: ${result.tag}.`);
    else console.log(`Created annotated release tag ${result.tag} at ${result.targetSha}.`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
