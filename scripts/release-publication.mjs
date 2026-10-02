import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = "Wizard-Gang/SharkTank";
const releasePattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-r[1-9]\d*)?$/;

function gh(args, env = process.env) {
  const result = spawnSync("gh", args, { encoding: "utf8", env });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function publicationContextFailures({ env, release }) {
  const failures = [];
  const value = (release ?? "").trim();
  const expectedWorkflowRef = `${repository}/.github/workflows/release.yml@refs/heads/main`;

  if (!releasePattern.test(value)) failures.push("release publication requires vX.Y.Z or vX.Y.Z-rN identity");
  if (env.GITHUB_ACTIONS !== "true") failures.push("release publication requires GitHub Actions");
  if (env.GITHUB_REPOSITORY !== repository) failures.push(`release publication requires repository ${repository}`);
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") failures.push("release publication requires explicit dispatch");
  if (env.GITHUB_REF !== "refs/heads/main") failures.push("release publication requires the main workflow ref");
  if (!/^[0-9a-f]{40}$/.test(env.SHARKTANK_EXPECTED_SHA ?? "")) failures.push("release publication requires the exact accepted main SHA");
  if (env.SHARKTANK_RELEASE_WORKFLOW_REF !== expectedWorkflowRef) failures.push("release publication requires the exact main Release workflow context");
  if (!env.GH_TOKEN) failures.push("GH_TOKEN is required for GitHub Release publication");
  return failures;
}

export function validateReleaseRecord(record, release) {
  const failures = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["existing GitHub Release response must be an object"];
  }
  if (record.tag_name !== release) failures.push(`existing GitHub Release tag ${record.tag_name ?? "(missing)"} != ${release}`);
  if (record.name !== release) failures.push(`existing GitHub Release title ${record.name ?? "(missing)"} != ${release}`);
  if (record.draft !== false) failures.push("existing GitHub Release must not be a draft");
  if (record.prerelease !== false) failures.push("existing GitHub Release must not be a prerelease");
  return failures;
}

function releaseViewArgs(repo, release) {
  return [
    "api",
    `repos/${repo}/releases/tags/${release}`,
    "--jq",
    "{tag_name:.tag_name,name:.name,draft:.draft,prerelease:.prerelease}",
  ];
}

function readRelease({ repo, release, runGh }) {
  const result = runGh(releaseViewArgs(repo, release));
  if (result.status === 0) {
    let record;
    try {
      record = JSON.parse(result.stdout);
    } catch {
      throw new Error("GitHub Release lookup returned invalid JSON");
    }
    const failures = validateReleaseRecord(record, release);
    if (failures.length) throw new Error(failures.join("; "));
    return { kind: "existing", record };
  }

  const detail = `${result.stderr}\n${result.stdout}`;
  if (/HTTP 404\b/.test(detail)) return { kind: "absent" };
  throw new Error(`GitHub Release lookup failed: ${(result.stderr || result.stdout || "unknown gh error").trim()}`);
}

function createArgs(release) {
  return ["release", "create", release, "--verify-tag", "--generate-notes", "--title", release];
}

export function publishOrVerifyRelease({ repo = repository, release, runGh = (args) => gh(args) }) {
  const before = readRelease({ repo, release, runGh });
  if (before.kind === "existing") return { kind: "existing", record: before.record };

  const created = runGh(createArgs(release));
  if (created.status !== 0) {
    try {
      const raced = readRelease({ repo, release, runGh });
      if (raced.kind === "existing") return { kind: "existing", record: raced.record };
    } catch (verificationError) {
      throw new Error(`GitHub Release creation failed: ${(created.stderr || created.stdout || "unknown gh error").trim()}; follow-up verification failed: ${verificationError.message}`);
    }
    throw new Error(`GitHub Release creation failed: ${(created.stderr || created.stdout || "unknown gh error").trim()}`);
  }

  const after = readRelease({ repo, release, runGh });
  if (after.kind !== "existing") throw new Error("GitHub Release creation reported success but the exact Release is still absent");
  return { kind: "created", record: after.record };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const release = (process.env.SHARKTANK_RELEASE ?? "").trim();
  const failures = publicationContextFailures({ env: process.env, release });
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exit(1);
  }

  try {
    const result = publishOrVerifyRelease({ release });
    if (result.kind === "existing") console.log(`GitHub Release already matches immutable release identity: ${release}.`);
    else console.log(`Published GitHub Release ${release}.`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
