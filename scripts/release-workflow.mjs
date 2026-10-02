function jobBlock(workflow, jobName) {
  const jobsMarker = /^jobs:\s*$/m.exec(workflow);
  if (!jobsMarker) return null;

  const jobsText = workflow.slice(jobsMarker.index + jobsMarker[0].length);
  const start = new RegExp("^  " + jobName + ":\\s*$", "m").exec(jobsText);
  if (!start) return null;

  const afterStart = jobsText.slice(start.index + start[0].length);
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(afterStart);
  return nextJob ? afterStart.slice(0, nextJob.index) : afterStart;
}

function jobValue(block, key) {
  if (!block) return null;
  const match = new RegExp("^    " + key + ":\\s*(.+?)\\s*$", "m").exec(block);
  return match?.[1] ?? null;
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function blockLines(lines, key, indent) {
  const marker = " ".repeat(indent) + key + ":";
  const start = lines.findIndex((line) => line.trimEnd() === marker);
  if (start < 0) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (indentation(line) <= indent) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function releaseTriggerFailures(workflow) {
  const failures = [];
  const lines = workflow.split("\n");
  const on = blockLines(lines, "on", 0);
  if (!on) return ["release workflow must define a trigger"];

  const events = on
    .filter((line) => line.trim() && indentation(line) === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim()))
    .map((line) => line.trim().slice(0, -1));

  if (events.length !== 1 || events[0] !== "workflow_dispatch") {
    failures.push("release workflow must be triggered only by explicit dispatch");
    return failures;
  }
  const dispatch = blockLines(on, "workflow_dispatch", 2) ?? [];
  const inputs = blockLines(dispatch, "inputs", 4) ?? [];
  if (!blockLines(inputs, "tag", 6)?.some((line) => line.trim() === "required: true")) failures.push("release dispatch must require tag input");
  if (!blockLines(inputs, "expected_sha", 6)?.some((line) => line.trim() === "required: true")) failures.push("release dispatch must require expected accepted SHA input");

  return failures;
}

function hasFullHistoryCheckout(block) {
  return Boolean(block?.includes("uses: actions/checkout@") && block.includes("fetch-depth: 0"));
}

function deployTriggerFailures(workflow) {
  const lines = workflow.split("\n");
  const on = blockLines(lines, "on", 0);
  if (!on) return ["deploy workflow must define workflow_call"];

  const events = on
    .filter((line) => line.trim() && indentation(line) === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim()))
    .map((line) => line.trim().slice(0, -1));

  if (events.length !== 1 || events[0] !== "workflow_call") {
    return ["deploy workflow must be callable only from another workflow"];
  }
  return [];
}

export function validateProductionDeployWorkflow(workflow) {
  const failures = deployTriggerFailures(workflow);
  const deploy = jobBlock(workflow, "deploy");

  if (!deploy) {
    failures.push("deploy workflow must define deploy");
    return failures;
  }

  if (jobValue(deploy, "environment") !== "production") failures.push("deploy must retain the protected production environment");
  if (!deploy.includes("group: sharktank-production")) failures.push("deploy must retain serialized production concurrency");
  if (!hasFullHistoryCheckout(deploy)) failures.push("deploy must checkout full Git/tag history");
  if (!deploy.includes("ref: ${{ inputs.tag }}")) failures.push("deploy must checkout the exact input tag");
  if (!deploy.includes("git fetch origin refs/heads/main:refs/remotes/origin/main")) failures.push("deploy must fetch accepted main ancestry");
  if (!deploy.includes("node-version-file: .node-version")) failures.push("deploy must use the repository Node authority");
  if (!deploy.includes('npm install --global "$package_manager"')) failures.push("deploy must install the repository npm authority");
  if (!deploy.includes("run: npm ci")) failures.push("deploy must install locked dependencies");
  if (!deploy.includes("SHARKTANK_RELEASE: ${{ inputs.tag }}")) failures.push("deploy must bind release identity from the workflow input");
  if (!deploy.includes("SHARKTANK_EXPECTED_SHA: ${{ inputs.expected_sha }}")) failures.push("deploy must bind the accepted commit SHA");
  if (!deploy.includes("SHARKTANK_RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}\n          SHARKTANK_RELEASE_CHECKOUT: ${{ github.workspace }}")) failures.push("deploy must bind caller release workflow identity");
  if (!deploy.includes('[ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]')) failures.push("deploy must require explicit release dispatch");
  if (!deploy.includes('[ "$GITHUB_REF" = "refs/heads/main" ]')) failures.push("deploy must require the main Release workflow ref");
  if (!deploy.includes('node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-identity.mjs"')) failures.push("deploy must revalidate exact annotated release identity");
  if (!deploy.includes('git show "$GITHUB_SHA:scripts/release-identity.mjs"')) failures.push("deploy must load the current release identity guard");
  if (!deploy.includes('git show "$GITHUB_SHA:scripts/deploy-prod.mjs"')) failures.push("deploy must load the current production guard");
  if (!deploy.includes("SHARKTANK_RELEASE_CHECKOUT: ${{ github.workspace }}")) failures.push("deploy must bind the exact released checkout");
  if (!deploy.includes("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}")) failures.push("deploy must retain the Cloudflare token boundary");
  if (!deploy.includes("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}")) failures.push("deploy must retain the Cloudflare account boundary");
  if (!deploy.includes('node "$RUNNER_TEMP/sharktank-release-tools/scripts/deploy-prod.mjs"')) failures.push("deploy must use the guarded production deployment command");
  if (!deploy.includes("id: deploy")) failures.push("production mutation must expose the uploaded Version ID");
  if (!deploy.includes('echo "version=$version" >> "$GITHUB_OUTPUT"')) failures.push("production mutation must publish the uploaded Version ID");
  if (!deploy.includes("npx wrangler deployments list --env wizardgangprod")) failures.push("deploy must confirm provider deployment state");
  if (!deploy.includes("VERSION: ${{ steps.deploy.outputs.version }}")) failures.push("provider proof must bind the uploaded Version ID");
  if (!deploy.includes('grep -q "$VERSION"')) failures.push("provider proof must require the uploaded Version ID");
  if (!deploy.includes("grep -q '(100%)'")) failures.push("deploy must prove the uploaded version serves 100% of traffic");
  if (!deploy.includes("npm run check:evidence -- https://sharktank.wizardgang.ai")) failures.push("deploy must retain public evidence validation when reachable");
  if (!deploy.includes("live_revision=$(jq -r .revision < /tmp/version.json)")) failures.push("deploy must verify the immutable public release revision when reachable");
  if (!deploy.includes("https://sharktank.wizardgang.ai/play/")) failures.push("deploy must verify the public full-3D game route when reachable");
  if (!deploy.includes("public /play/ did not reference a built JavaScript asset")) failures.push("deploy must verify a built public game asset when reachable");
  if (!deploy.includes("cf-mitigated: *challenge")) failures.push("public edge fallback must remain limited to the documented managed challenge");

  const productionIndex = deploy.indexOf('node "$RUNNER_TEMP/sharktank-release-tools/scripts/deploy-prod.mjs"');
  const providerIndex = deploy.indexOf("npx wrangler deployments list --env wizardgangprod");
  const publicEdgeIndex = deploy.indexOf("npm run check:evidence -- https://sharktank.wizardgang.ai");
  if (productionIndex >= 0 && providerIndex >= 0 && providerIndex <= productionIndex) {
    failures.push("authenticated provider proof must follow the production mutation");
  }
  if (providerIndex >= 0 && publicEdgeIndex >= 0 && publicEdgeIndex <= providerIndex) {
    failures.push("public edge evidence must remain a post-provider-proof fallback");
  }

  return failures;
}

export function validateReleaseWorkflow(workflow, deployWorkflow) {
  const failures = releaseTriggerFailures(workflow);
  const verify = jobBlock(workflow, "verify");
  const publish = jobBlock(workflow, "publish-release");
  const deploy = jobBlock(workflow, "deploy-production");

  if (!verify) failures.push("release workflow must define verify");
  if (!publish) failures.push("release workflow must define publish-release");
  if (!deploy) failures.push("release workflow must define deploy-production");

  for (const [name, block] of [["verify", verify], ["publish-release", publish]]) {
    if (block && !hasFullHistoryCheckout(block)) failures.push(`${name} must checkout full Git/tag history`);
    if (block && !block.includes("ref: ${{ inputs.tag }}")) failures.push(`${name} must checkout the exact input tag`);
    if (block && !block.includes("git fetch origin refs/heads/main:refs/remotes/origin/main")) failures.push(`${name} must fetch accepted main ancestry`);
  }

  if (verify) {
    const lines = verify.split("\n").map((line) => line.trim().replace(/^- /, ""));
    const checkIndex = lines.indexOf("run: npm run check");
    const advisoryIndex = lines.indexOf("run: npm run audit:dependencies");
    const identityIndex = lines.indexOf('run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-identity.mjs"');
    if (checkIndex < 0) failures.push("verify must run the canonical repository gate");
    if (advisoryIndex < 0) failures.push("verify must run the separate network advisory gate");
    if (identityIndex < 0) failures.push("verify must run exact release identity validation");
    if (checkIndex >= 0 && advisoryIndex >= 0 && advisoryIndex <= checkIndex) failures.push("network advisory gate must follow canonical acceptance");
    if (advisoryIndex >= 0 && identityIndex >= 0 && identityIndex <= advisoryIndex) failures.push("exact release identity validation must follow network advisories");
    if (checkIndex >= 0 && identityIndex >= 0 && identityIndex <= checkIndex) failures.push("exact release identity validation must run after the canonical repository gate");
    if (!verify.includes("SHARKTANK_RELEASE: ${{ inputs.tag }}")) failures.push("verify must bind the exact dispatched release tag");
    if (!verify.includes("SHARKTANK_EXPECTED_SHA: ${{ inputs.expected_sha }}")) failures.push("verify must bind the accepted commit SHA");
    if (!verify.includes("SHARKTANK_RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}")) failures.push("verify must bind the main Release workflow identity");
    if (!verify.includes('git show "$GITHUB_SHA:scripts/release-identity.mjs"')) failures.push("verify must load the current release identity guard");
  }

  if (publish && jobValue(publish, "needs") !== "verify") failures.push("publish-release must depend on successful verify");
  if (publish) {
    if (!publish.includes("GH_TOKEN: ${{ github.token }}")) failures.push("publish-release must use the workflow-scoped GitHub token");
    if (!publish.includes("GH_TOKEN: ${{ github.token }}\n          SHARKTANK_RELEASE: ${{ inputs.tag }}")) failures.push("publish-release must bind the exact dispatched release tag");
    if (!publish.includes("SHARKTANK_RELEASE: ${{ inputs.tag }}\n          SHARKTANK_EXPECTED_SHA: ${{ inputs.expected_sha }}")) failures.push("publish-release must bind the accepted commit SHA");
    if (!publish.includes("GH_TOKEN: ${{ github.token }}\n          SHARKTANK_RELEASE: ${{ inputs.tag }}\n          SHARKTANK_EXPECTED_SHA: ${{ inputs.expected_sha }}\n          SHARKTANK_RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}")) failures.push("publish-release must bind the exact Release workflow identity");
    if (!publish.includes('git show "$GITHUB_SHA:scripts/release-identity.mjs"')) failures.push("publish-release must load the current release identity guard");
    if (!publish.includes('git show "$GITHUB_SHA:scripts/release-publication.mjs"')) failures.push("publish-release must load the current publication guard");
    if (!publish.includes('run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-identity.mjs"')) failures.push("publish-release must reverify exact release identity");
    if (!publish.includes('run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-publication.mjs"')) failures.push("publish-release must use the guarded create-or-verify publication command");
    if (/gh release (?:create|edit|delete)/.test(publish)) failures.push("publish-release must not embed mutable gh release operations");
  }
  if (deploy) {
    if (jobValue(deploy, "needs") !== "publish-release") failures.push("deploy-production must depend on successful publish-release");
    if (jobValue(deploy, "if") !== "vars.PRODUCTION_DEPLOY_ENABLED == 'true'") failures.push("deploy-production must retain the PRODUCTION_DEPLOY_ENABLED opt-in");
    if (jobValue(deploy, "uses") !== "./.github/workflows/deploy.yml") failures.push("deploy-production must call the reusable production workflow");
    if (!deploy.includes("tag: ${{ inputs.tag }}")) failures.push("deploy-production must pass the exact dispatched release tag");
    if (!deploy.includes("expected_sha: ${{ inputs.expected_sha }}")) failures.push("deploy-production must pass the accepted commit SHA");
    if (!deploy.includes("secrets: inherit")) failures.push("deploy-production must inherit the caller secret boundary");
    if (deploy.includes("runs-on:") || deploy.includes("steps:")) failures.push("deploy-production must not embed production steps in release.yml");
  }

  if (typeof deployWorkflow !== "string") failures.push("release validation requires the reusable deploy workflow");
  else failures.push(...validateProductionDeployWorkflow(deployWorkflow));

  return failures;
}

export function validateVersionToProductionChain({ tagWorkflow, releaseWorkflow, deployWorkflow }) {
  return [
    ...validateReleaseTagWorkflow(tagWorkflow).map((failure) => `tag stage: ${failure}`),
    ...validateReleaseWorkflow(releaseWorkflow, deployWorkflow).map((failure) => `release/deploy stage: ${failure}`),
  ];
}

export function validateReleaseTagWorkflow(workflow) {
  const failures = [];
  const lines = workflow.split("\n");
  const on = blockLines(lines, "on", 0);
  if (!on) return ["release tag workflow must define workflow_run"];

  const events = on
    .filter((line) => line.trim() && indentation(line) === 2 && /^[A-Za-z0-9_-]+:\s*$/.test(line.trim()))
    .map((line) => line.trim().slice(0, -1));
  if (events.length !== 1 || events[0] !== "workflow_run") failures.push("release tag workflow must be triggered only by completed CI workflow runs");
  if (!workflow.includes('    workflows: ["CI"]')) failures.push("release tag workflow must observe only CI");
  if (!workflow.includes("    types: [completed]")) failures.push("release tag workflow must observe only completed CI runs");
  if (!workflow.includes("permissions:\n  contents: write\n  actions: write")) failures.push("release tag workflow requires contents and actions write authority");

  const tag = jobBlock(workflow, "tag-release");
  if (!tag) {
    failures.push("release tag workflow must define tag-release");
    return failures;
  }

  const expectedIf = "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main'";
  if (jobValue(tag, "if") !== expectedIf) failures.push("release tagging must require successful push CI on main");
  if (!hasFullHistoryCheckout(tag)) failures.push("release tagging must checkout full Git/tag history");
  if (!tag.includes("ref: ${{ github.event.workflow_run.head_sha }}")) failures.push("release tagging must checkout the exact accepted main SHA");
  if (!tag.includes("node-version-file: .node-version")) failures.push("release tagging must use the repository Node authority");
  if (!tag.includes('npm install --global "$package_manager"')) failures.push("release tagging must install repository npm authority");
  if (!tag.includes("run: npm ci")) failures.push("release tagging must install locked dependencies");
  if (!tag.includes("SHARKTANK_MAIN_SHA: ${{ github.event.workflow_run.head_sha }}")) failures.push("release tagging must bind the exact accepted main SHA");
  if (!tag.includes("SHARKTANK_TAG_WORKFLOW_REF: ${{ github.workflow_ref }}")) failures.push("release tagging must bind its workflow identity");
  if (!tag.includes("run: npm run tag:release")) failures.push("release tagging must use the guarded repository tag command");
  if (!tag.includes("id: release-tag")) failures.push("release tagging must expose the verified tag output");
  if (!tag.includes("if: steps.release-tag.outputs.tag != ''")) failures.push("release dispatch must skip unchanged release authority");
  if (!tag.includes("GH_TOKEN: ${{ github.token }}")) failures.push("release dispatch must use the workflow token");
  if (!tag.includes("RELEASE_TAG: ${{ steps.release-tag.outputs.tag }}")) failures.push("release dispatch must pass the verified tag");
  if (!tag.includes("EXPECTED_SHA: ${{ steps.release-tag.outputs.expected_sha }}")) failures.push("release dispatch must pass the accepted main SHA");
  if (!tag.includes('gh workflow run release.yml --ref main -f tag="$RELEASE_TAG" -f expected_sha="$EXPECTED_SHA"')) failures.push("release tagging must explicitly dispatch exact release identity");
  if (/gh release|deploy:wizardgangprod|\.\/\.github\/workflows\/deploy\.yml/.test(workflow)) failures.push("release tagging must not publish Releases or deploy production");

  return failures;
}
