import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { validateReleaseIdentity } from "./release-identity.mjs";

const root = process.env.SHARKTANK_RELEASE_CHECKOUT
  ? resolve(process.env.SHARKTANK_RELEASE_CHECKOUT)
  : fileURLToPath(new URL("..", import.meta.url));
const productionRepository = "Wizard-Gang/SharkTank";
const releasePattern = /^v\d+\.\d+\.\d+$/;

/**
 * Load the gitignored .env into process.env for local dry-run only, without
 * overriding anything already set in the real environment.
 *
 * A real production deployment must never derive provider authority from a
 * workstation file. GitHub Actions receives Cloudflare credentials from the
 * protected production environment instead.
 */
function loadDotEnv() {
  let text;
  try {
    text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(split + 1).trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
}

export function deploymentVariables(release) {
  return [`SHARKTANK_RELEASE:${release}`];
}

export function deploymentPreconditionFailures({
  dryRun,
  env,
  release,
  tagsAtHead,
  releaseIdentityFailures = [],
}) {
  const failures = [];
  if (!releasePattern.test(release) || !tagsAtHead.includes(release)) {
    failures.push("SHARKTANK_RELEASE must be a semantic vX.Y.Z tag pointing at HEAD");
  }

  if (!dryRun) {
    const expectedWorkflowRef = `${productionRepository}/.github/workflows/release.yml@refs/heads/main`;

    if (env.GITHUB_ACTIONS !== "true") failures.push("real production deploy requires GitHub Actions");
    if (env.GITHUB_REPOSITORY !== productionRepository) failures.push(`real production deploy requires repository ${productionRepository}`);
    if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") failures.push("real production deploy requires explicit release dispatch");
    if (env.GITHUB_REF !== "refs/heads/main") failures.push("real production deploy requires the main Release workflow ref");
    if (!/^[0-9a-f]{40}$/.test(env.SHARKTANK_EXPECTED_SHA ?? "")) failures.push("real production deploy requires the exact accepted main SHA");
    if (env.SHARKTANK_RELEASE_WORKFLOW_REF !== expectedWorkflowRef) {
      failures.push("real production deploy requires the exact main Release workflow context");
    }
    if (env.SHARKTANK_RELEASE_CHECKOUT !== env.GITHUB_WORKSPACE) {
      failures.push("real production deploy requires the exact GitHub workspace checkout");
    }
    for (const failure of releaseIdentityFailures) failures.push(`exact release identity failed: ${failure}`);
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID) failures.push("CLOUDFLARE_ACCOUNT_ID is required");
  if (!dryRun && !env.CLOUDFLARE_API_TOKEN) failures.push("CLOUDFLARE_API_TOKEN is required for real production deploy");
  return failures;
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) {
    if (capture) {
      console.error(`Failed: ${command} ${args.join(" ")}`);
      if (result.stdout) console.error(result.stdout.trimEnd());
      if (result.stderr) console.error(result.stderr.trimEnd());
      if (result.error) console.error(String(result.error.message ?? result.error));
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function main() {
  const env = "wizardgangprod";
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) loadDotEnv();

  const release = (process.env.SHARKTANK_RELEASE ?? "").trim();
  const tagsAtHead = run("git", ["tag", "--points-at", "HEAD"], true).split(/\s+/).filter(Boolean);
  const releaseIdentityFailures = dryRun ? [] : validateReleaseIdentity({ cwd: root, release, expectedSha: process.env.SHARKTANK_EXPECTED_SHA });
  const failures = deploymentPreconditionFailures({
    dryRun,
    env: process.env,
    release,
    tagsAtHead,
    releaseIdentityFailures,
  });
  if (failures.length) {
    for (const failure of failures) console.error(`Refusing production deploy: ${failure}.`);
    process.exit(1);
  }

  const deploymentVars = deploymentVariables(release);

  run("npm", ["run", "build"]);
  if (!dryRun) {
    const secrets = run("npx", ["wrangler", "secret", "list", "--env", env], true);
    const missing = ["OPS_TOKEN", "OPS_USERNAME"].filter((name) => !secrets.includes(name));
    if (missing.length) {
      console.error(`Refusing production deploy: missing required secrets: ${missing.join(", ")}. Configure them through the protected production environment/provider boundary.`);
      process.exit(1);
    }
  }
  run("npx", ["wrangler", "deploy", ...(dryRun ? ["--dry-run"] : []), "--env", env, ...deploymentVars.flatMap((value) => ["--var", value])]);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();
