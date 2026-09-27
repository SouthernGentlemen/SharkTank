#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const fail = (message) => failures.push(message);
const expect = (condition, message) => { if (!condition) fail(message); };
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const has = (text, needle, label) => expect(text.includes(needle), label + ": missing " + needle);
const major = (spec, value) => new RegExp("^[~^]?" + value + "(?:\\.|$)").test(spec ?? "");

const packageJson = json("package.json");
const packageLock = json("package-lock.json");
const nodeVersion = read(".node-version").trim();
const npmAgent = process.env.npm_config_user_agent ?? "";
const npmVersionMatch = /^npm@(\d+\.\d+\.\d+)$/.exec(packageJson.packageManager ?? "");
const npmVersion = npmVersionMatch?.[1] ?? "";
const expectedNodeVersion = "26.10.0";
const expectedNpmVersion = "12.1.0";

expect(nodeVersion === expectedNodeVersion, ".node-version must pin exact Node " + expectedNodeVersion);
expect(process.version === "v" + expectedNodeVersion, "acceptance must execute on exact Node " + expectedNodeVersion);
expect(packageJson.engines?.node === "26.x", "engines.node must be 26.x");
expect(packageJson.engines?.npm === "12.x", "engines.npm must be 12.x");
expect(packageJson.packageManager === "npm@" + expectedNpmVersion, "packageManager must pin exact npm " + expectedNpmVersion);
expect(npmVersion === expectedNpmVersion, "packageManager npm version must resolve to " + expectedNpmVersion);
expect(npmAgent.startsWith("npm/" + expectedNpmVersion + " "), "acceptance must execute through exact packageManager npm " + expectedNpmVersion);
expect(read(".npmrc").includes("engine-strict=true") && read(".npmrc").includes("strict-allow-scripts=true"), ".npmrc must enforce engine-strict and strict install-script allowlisting");
expect(packageJson.type === "module", "package.json must use ESM");
expect(existsSync(join(root, "package-lock.json")), "package-lock.json must be committed");
expect(packageLock.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3");
expect(packageLock.packages?.[""]?.version === packageJson.version, "package-lock root version must match package.json");
expect(packageLock.packages?.[""]?.engines?.node === packageJson.engines?.node, "package-lock root Node engine must match package.json");
expect(packageLock.packages?.[""]?.engines?.npm === packageJson.engines?.npm, "package-lock root npm engine must match package.json");
expect(JSON.stringify(packageJson.allowScripts) === JSON.stringify({ "esbuild@0.28.1": true, "fsevents@2.3.3": false, "workerd@1.20260925.1": true }), "allowScripts must specify reviewed exact install-script packages");
for (const [name, expected] of Object.entries({ typescript: "7.0.2", vite: "8.3.1", vitest: "5.0.2", wrangler: "4.141.0", "@types/node": "26.6.3" })) {
  expect(packageJson.devDependencies?.[name] === expected, `${name} must match the shared cohort`);
  expect(packageLock.packages?.[`node_modules/${name}`]?.version === expected, `${name} lockfile must match the shared cohort`);
}
for (const name of ["react", "react-dom"]) {
  expect(packageJson.dependencies?.[name] === "19.2.8" && packageLock.packages?.[`node_modules/${name}`]?.version === "19.2.8", `${name} must retain the documented <19.3 fiber peer exception`);
}

for (const [name, spec, expectedMajor] of [
  ["typescript", packageJson.devDependencies?.typescript, 7],
  ["vite", packageJson.devDependencies?.vite, 8],
  ["vitest", packageJson.devDependencies?.vitest, 5],
  ["wrangler", packageJson.devDependencies?.wrangler, 4],
  ["react", packageJson.dependencies?.react, 19],
  ["react-dom", packageJson.dependencies?.["react-dom"], 19],
  ["@react-three/fiber", packageJson.dependencies?.["@react-three/fiber"], 9],
]) expect(major(spec, expectedMajor), name + " must remain on major " + expectedMajor);

expect(json("tsconfig.json").compilerOptions?.strict === true, "root TypeScript program must keep strict=true");
expect(json("vendor/ModuleReact3Fiber/tsconfig.json").compilerOptions?.strict === true, "vendored first-party TypeScript program must keep strict=true");
has(packageJson.scripts?.typecheck ?? "", "vendor/ModuleReact3Fiber/tsconfig.json", "typecheck must cover the first-party vendor program");

const vite = read("vite.config.ts");
has(vite, 'name: "sharktank-react-game-document"', "Vite must own the React game document");
has(vite, 'assets/[name]-[hash].js', "Vite game modules must remain content hashed");
has(vite, '"human-docs": humanDocsEntry', "Vite must build the first-party human-docs enhancement module");

const wrangler = read("wrangler.jsonc");
for (const needle of [
  '"directory": "./dist"',
  '"binding": "ASSETS"',
  '"html_handling": "none"',
  '"not_found_handling": "none"',
  '"run_worker_first": true',
  '"class_name": "Room"',
  '"class_name": "Lobby"',
  '"tag": "v1"',
  '"R2_PREFIX": "sharktank/development/"',
  '"R2_PREFIX": "sharktank/production/"',
]) has(wrangler, needle, "Wrangler baseline");

const gameDocument = read("src/client/game-document.tsx");
const clientMain = read("src/client/main.tsx");
const workerPresentation = read("src/worker/presentation-react.tsx");
const architecture = read("docs/ARCHITECTURE.md");
has(gameDocument, "renderToStaticMarkup(<GameDocument />)", "/play/ document must render from React at build time");
has(clientMain, "createRoot(el).render(", "/play/ must remain the explicit interactive client boundary");
expect(!/hydrateRoot|BrowserRouter|createBrowserRouter/.test(workerPresentation), "ordinary Worker documents must not hydrate or use a client router");
has(architecture, "`/play/` is the one explicit browser application boundary", "architecture must document the game-client boundary");
has(architecture, "WG-ARCH-001 project-specific boundaries", "architecture must record intentional baseline boundaries");
has(architecture, "squash-only", "architecture must record the repository-specific single-commit delivery departure");

const distIndex = read("dist/index.html");
expect(!distIndex.includes("'unsafe-inline'"), "built game document must not contain unsafe-inline");
expect(!/<style\b/i.test(distIndex), "built game document must not contain an inline style block");
expect(!/\sstyle\s*=/i.test(distIndex), "built game document must not contain style attributes");
expect(!/\son[a-z][a-z0-9_-]*\s*=/i.test(distIndex), "built game document must not contain inline event handlers");
for (const match of distIndex.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  expect(/\ssrc\s*=/.test(match[1] ?? ""), "built game document must not contain inline script bodies");
}
const builtAssets = readdirSync(join(root, "dist/assets"));
expect(builtAssets.some((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name)), "build must emit a content-hashed game entry");
expect(builtAssets.some((name) => /^index-[A-Za-z0-9_-]+\.css$/.test(name)), "build must emit content-hashed game CSS");
expect(builtAssets.some((name) => name !== "human-docs.js" && !name.startsWith("index-") && /-[A-Za-z0-9_-]+\.js$/.test(name)), "build must retain a content-hashed lazy game chunk");
expect(builtAssets.includes("human-docs.js"), "build must emit the stable first-party human-docs enhancement module");

for (const required of [
  "README.md","AGENTS.md","CONTRIBUTING.md","SECURITY.md","LICENSE",".gitignore",
  ".node-version",".npmrc","package.json","package-lock.json","tsconfig.json","wrangler.jsonc",
  ".github/workflows/ci.yml",".github/workflows/release.yml",".github/workflows/deploy.yml",
]) expect(existsSync(join(root, required)), "required repository file missing: " + required);
expect(!existsSync(join(root, ".github/dependabot.yml")), "automated dependency-version PRs must remain disabled");

function walk(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".git","node_modules","dist",".wrangler"].includes(entry.name)) continue;
    const absolute = join(dir, entry.name);
    const rel = relative(root, absolute).replaceAll("\\", "/");
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.isFile() && statSync(absolute).isFile()) output.push(rel);
  }
  return output;
}
const repositoryFiles = walk(root);
expect(!repositoryFiles.some((path) => path.toLowerCase() === "changelog.md"), "CHANGELOG.md is not allowed");
expect(!repositoryFiles.some((path) => /^docs\/releases\//i.test(path)), "per-version Markdown release archive directory is not allowed");
expect(!repositoryFiles.some((path) => /(?:^|\/)v\d+\.\d+\.\d+\.md$/i.test(path)), "per-version Markdown release files are not allowed");
expect(!existsSync(join(root, "docs/RECONSTRUCTION.md")), "reconstruction narrative must remain retired");
expect(!existsSync(join(root, "docs/history/LEGACY-INVENTORY.md")), "legacy inventory narrative must remain retired");
expect(JSON.stringify(readdirSync(join(root, "docs/history")).sort()) === JSON.stringify(["CHANGE-MAP.csv","NESTED-SOURCE-MAP.csv"]), "docs/history must contain exact provenance CSV inputs only");

const changeMap = read("docs/history/CHANGE-MAP.csv").trim().split(/\r?\n/).slice(1);
for (const row of changeMap) {
  const id = row.split(",", 1)[0];
  const match = /^ST-(\d{3})$/.exec(id);
  expect(Boolean(match) && Number(match[1]) <= 28, "CHANGE-MAP.csv must not contain forward ST history: " + id);
}
expect(!read("SECURITY.md").includes("reconstructed releases"), "security policy must describe supported releases as current state");

const githubSettings = json("config/github-repository-settings.json");
expect(githubSettings.defaultBranch === "main", "GitHub settings must keep main as default");
expect(githubSettings.mergeMethods?.mergeCommit === false, "single-commit policy must disable merge commits");
expect(githubSettings.mergeMethods?.squash === true, "single-commit policy must enable squash");
expect(githubSettings.mergeMethods?.rebase === false, "single-commit policy must disable rebase");
expect(githubSettings.allowAutoMerge === true, "auto-merge availability must be enabled");
expect(githubSettings.deleteBranchOnMerge === true, "merged branches must be deleted");
expect(JSON.stringify(githubSettings.requiredStatusChecks) === JSON.stringify(["verify"]), "main ruleset must require exactly verify");
const mainRuleset = githubSettings.rulesets?.find((r) => r.name === "main-protection");
expect(mainRuleset?.target === "branch", "main-protection must target branches");
expect(mainRuleset?.enforcement === "active", "main-protection must remain active");
expect(JSON.stringify(mainRuleset?.include) === JSON.stringify(["refs/heads/main"]), "main-protection must target exactly main");
expect(JSON.stringify(mainRuleset?.exclude) === JSON.stringify([]), "main-protection must not exclude protected refs");
expect(JSON.stringify(mainRuleset?.bypassActors) === JSON.stringify([]), "main-protection must not allow bypass actors");
expect(mainRuleset?.requireBranchUpToDate === true, "main-protection must require current-head status checks");
expect(mainRuleset?.doNotEnforceOnCreate === true, "main-protection must retain the committed create-time status policy");
expect(mainRuleset?.requireExtraApprovalForUnattributedChanges === true, "main-protection must require extra approval for unattributed changes");
expect(mainRuleset?.rules?.includes("pull_request") && mainRuleset.rules?.includes("required_status_checks") && mainRuleset.rules?.includes("non_fast_forward") && mainRuleset.rules?.includes("deletion"), "main-protection ruleset contract is incomplete");
const releaseTagRuleset = githubSettings.rulesets?.find((r) => r.name === "release-tag-immutability");
expect(releaseTagRuleset?.target === "tag", "release tag immutability must target tags");
expect(releaseTagRuleset?.enforcement === "active", "release tag immutability must remain active");
expect(JSON.stringify(releaseTagRuleset?.include) === JSON.stringify(["refs/tags/v*"]), "release tag immutability must target v* tags");
expect(JSON.stringify(releaseTagRuleset?.exclude) === JSON.stringify([]), "release tag immutability must not exclude release refs");
expect(JSON.stringify(releaseTagRuleset?.bypassActors) === JSON.stringify([]), "release tag immutability must not allow bypass actors");
expect(releaseTagRuleset?.rules?.includes("update") && releaseTagRuleset.rules?.includes("deletion"), "release tag immutability ruleset contract is incomplete");

expect(packageJson.scripts?.["test:github-settings"] === "node --test scripts/github-settings-cases.mjs", "GitHub settings pure test command must use the normalized test:github-settings contract");
expect(packageJson.scripts?.["verify:github-settings"] === "node scripts/verify-github-settings.mjs", "GitHub settings live verification must use the normalized verify:github-settings contract");
expect(packageJson.scripts?.["apply:github-settings"] === "node scripts/apply-github-settings.mjs", "GitHub settings mutation must remain the explicit apply:github-settings command");
expect(packageJson.scripts?.["check:github-settings"] === undefined, "legacy check:github-settings must not compete with verify:github-settings");
has(packageJson.scripts?.check ?? "", "npm run test:github-settings", "canonical check must retain pure GitHub settings tests");
expect(!(packageJson.scripts?.check ?? "").includes("npm run verify:github-settings"), "canonical check must not read live GitHub provider settings");
expect(!(packageJson.scripts?.check ?? "").includes("npm run apply:github-settings"), "canonical check must not mutate live GitHub provider settings");
expect(!existsSync(join(root, "scripts/check-github-settings.mjs")), "legacy check-github-settings script must remain retired");

const githubVerify = read("scripts/verify-github-settings.mjs");
has(githubVerify, "verifyLiveGithubSettings", "live GitHub settings verifier must use the read-only verification helper");
expect(!/method:\s*["'](?:PATCH|PUT|POST|DELETE)["']/.test(githubVerify), "live GitHub settings verifier must remain read-only");

const githubApply = read("scripts/apply-github-settings.mjs");
for (const method of ['method: "PATCH"', 'method: "PUT"', 'method: "POST"']) {
  has(githubApply, method, "GitHub settings apply command must own provider mutation");
}
const githubApplyLastMutation = Math.max(
  githubApply.lastIndexOf('method: "PATCH"'),
  githubApply.lastIndexOf('method: "PUT"'),
  githubApply.lastIndexOf('method: "POST"'),
);
expect(githubApply.lastIndexOf("await fetchLiveGithubSettings") > githubApplyLastMutation, "GitHub settings apply command must fresh-read provider state after mutation");

const occurrenceCount = (text, needle) => text.split(needle).length - 1;
const requireRepositoryToolchain = (workflow, label) => {
  const nodeSetups = occurrenceCount(workflow, "node-version-file: .node-version");
  const npmSetups = occurrenceCount(workflow, 'npm install --global "$package_manager"');
  expect(nodeSetups > 0, label + " must use the pinned Node version");
  has(workflow, "packageManager", label + " must read npm packageManager authority");
  expect(npmSetups === nodeSetups, label + " must install repository npm for every Node setup");
  for (const match of workflow.matchAll(/uses:\s+(actions\/(?:checkout|setup-node))@([^\s#]+)/g)) {
    expect(/^[0-9a-f]{40}$/.test(match[2]), `${label} ${match[1]} must use a reviewed full commit SHA`);
  }
};
const ci = read(".github/workflows/ci.yml");
requireRepositoryToolchain(ci, "CI");
has(ci, "run: npm ci", "CI must use npm ci");
has(ci, "run: npm run check", "CI must run the repository acceptance gate");
has(ci, "ref: ${{ github.event.pull_request.head.sha || github.sha }}", "CI must checkout the exact PR head");
has(ci, "run: npm run audit:dependencies", "CI must run the separate network advisory gate");
const releaseTag = read(".github/workflows/tag-release.yml");
requireRepositoryToolchain(releaseTag, "release tag workflow");
has(releaseTag, "workflow_run:", "release tagging must be post-CI");
has(releaseTag, 'workflows: ["CI"]', "release tagging must observe CI");
has(releaseTag, "github.event.workflow_run.conclusion == 'success'", "release tagging must require successful CI");
has(releaseTag, "github.event.workflow_run.head_branch == 'main'", "release tagging must require main");
has(releaseTag, "ref: ${{ github.event.workflow_run.head_sha }}", "release tagging must checkout exact accepted main SHA");
has(releaseTag, "SHARKTANK_TAG_WORKFLOW_REF: ${{ github.workflow_ref }}", "release tagging must bind its workflow identity");
has(releaseTag, "run: npm run tag:release", "release tagging must use the guarded repository command");
expect(!releaseTag.includes("gh release"), "release tagging must not publish GitHub Releases");
expect(!releaseTag.includes("deploy:wizardgangprod"), "release tagging must not deploy production");
const release = read(".github/workflows/release.yml");
requireRepositoryToolchain(release, "release workflow");
has(releaseTag, 'gh workflow run release.yml --ref main -f tag="$RELEASE_TAG" -f expected_sha="$EXPECTED_SHA"', "release tag workflow must explicitly dispatch exact release identity");
has(release, "workflow_dispatch:", "release workflow must accept explicit release dispatch");
has(release, "expected_sha:", "release workflow must require the accepted commit SHA");
has(release, "needs: publish-release", "production deploy must remain downstream of GitHub Release publication");
has(release, "uses: ./.github/workflows/deploy.yml", "release workflow must delegate production deployment to the reusable stage");
has(release, "tag: ${{ inputs.tag }}", "release workflow must pass the exact dispatched tag to reusable deployment");
has(release, "expected_sha: ${{ inputs.expected_sha }}", "release workflow must pass the accepted commit SHA to reusable deployment");
has(release, 'run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-publication.mjs"', "release workflow must use guarded create-or-verify publication");
has(release, "SHARKTANK_RELEASE: ${{ inputs.tag }}", "release publication must bind exact dispatched tag");
has(release, "SHARKTANK_RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}", "release publication must bind Release workflow identity");
const releasePublication = read("scripts/release-publication.mjs");
has(releasePublication, '"api"', "release publication must inspect existing GitHub Release state before mutation");
has(releasePublication, '"release", "create"', "release publication must retain first-publication capability");
has(releasePublication, '"--verify-tag"', "release creation must verify the existing annotated tag");
has(releasePublication, '"--generate-notes"', "release creation must retain generated notes");
has(releasePublication, '"--title"', "release creation must retain the exact tag title");
has(releasePublication, 'env.GITHUB_ACTIONS !== "true"', "release publication must be workflow-only");
has(releasePublication, "SHARKTANK_RELEASE_WORKFLOW_REF", "release publication must bind exact Release workflow identity");
expect(!/["']edit["']|["']delete["']/.test(releasePublication), "release publication must not edit or delete an existing Release");
const reusableDeploy = read(".github/workflows/deploy.yml");
requireRepositoryToolchain(reusableDeploy, "reusable deploy workflow");
has(reusableDeploy, "workflow_call:", "production deploy must be callable only as a reusable workflow");
expect(!reusableDeploy.includes("workflow_dispatch:"), "production deploy must not expose an arbitrary manual dispatch path");
expect(!reusableDeploy.includes("push:"), "production deploy must not expose a branch or tag push trigger");
has(reusableDeploy, "environment: production", "production deploy must use the protected production environment");
has(reusableDeploy, "ref: ${{ inputs.tag }}", "production deploy must checkout the exact released tag");
has(reusableDeploy, "SHARKTANK_RELEASE: ${{ inputs.tag }}", "production deploy must bind exact reusable release identity");
has(reusableDeploy, "SHARKTANK_RELEASE_WORKFLOW_REF: ${{ github.workflow_ref }}", "production deploy must bind the caller Release workflow identity");
has(reusableDeploy, 'node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-identity.mjs"', "production deploy must revalidate exact release identity");
has(reusableDeploy, 'node "$RUNNER_TEMP/sharktank-release-tools/scripts/deploy-prod.mjs"', "reusable deploy workflow must own production deployment");
expect(packageJson.scripts?.["tag:release"] === "node scripts/release-tag.mjs", "release tagging must expose one guarded command");
expect(packageJson.scripts?.["test:release-tagging"] === "node --test scripts/release-tag-cases.mjs", "release tagging must have focused disposable-Git coverage");
expect(packageJson.scripts?.["test:release-publication"] === "node --test scripts/release-publication-cases.mjs", "release publication must have focused create-or-verify coverage");
expect(packageJson.scripts?.["check:release-workflow"] === "node --test scripts/release-workflow-cases.mjs", "release workflow must have focused behavior coverage");
expect(packageJson.scripts?.["test:release-identity"] === "node --test scripts/release-identity-cases.mjs", "release identity must have focused behavior coverage");
expect(packageJson.scripts?.["test:deploy-prod"] === "node --test scripts/deploy-prod-cases.mjs", "production deploy guard must have focused behavior coverage");
expect(packageJson.scripts?.["check:release-identity"] === "node scripts/release-identity.mjs", "release workflow must expose the reusable identity gate");
expect(packageJson.scripts?.["check:implementation-plan"] === "node --test scripts/implementation-plan-cases.mjs && node scripts/check-implementation-plan.mjs", "implementation plan must have focused current/future queue coverage");
has(release, 'run: node "$RUNNER_TEMP/sharktank-release-tools/scripts/release-identity.mjs"', "release verify must run exact release identity validation");
has(release, "run: npm run audit:dependencies", "release verify must run the separate network advisory gate");
expect(packageJson.scripts?.["audit:dependencies"] === "node scripts/dependency-advisories.mjs", "network advisory command must use the committed policy");
expect(packageJson.scripts?.["test:dependency-advisories"] === "node --test scripts/dependency-advisory-cases.mjs", "advisory policy must have pure cases");
const deploy = read("scripts/deploy-prod.mjs");
has(deploy, "SHARKTANK_RELEASE", "deployment must bind to release identity");
has(deploy, "tagsAtHead.includes(release)", "deployment must require the release tag at HEAD");
has(deploy, "if (dryRun) loadDotEnv();", "local dotenv authority must be limited to dry-run");
expect(!/^loadDotEnv\(\);$/m.test(deploy), "real production deploy must not load local dotenv authority");
has(deploy, 'env.GITHUB_ACTIONS !== "true"', "real production deploy must require GitHub Actions");
has(deploy, "SHARKTANK_RELEASE_WORKFLOW_REF", "real production deploy must require caller Release workflow identity");
has(deploy, "validateReleaseIdentity", "real production deploy must revalidate exact annotated release identity");
expect(packageJson.scripts?.dev === "node scripts/local.mjs", "dev must use the safe whole-stack lifecycle");
expect(packageJson.scripts?.local === packageJson.scripts?.dev, "local and dev must share one lifecycle implementation");
expect(packageJson.scripts?.["dev:worker"] === "wrangler dev --port 8787", "dev:worker must be the explicit Worker-only path");
expect(packageJson.scripts?.start === "npm run dev:worker", "start must preserve Worker-only behavior through the explicit command");
expect(packageJson.scripts?.["check:local-readiness"] === "node --test scripts/local-readiness-cases.mjs", "local readiness must have focused behavior coverage");

for (const requiredCheck of [
  "npm run test:plan-queue","npm run check:implementation-plan","npm run test:release-tagging","npm run test:release-publication","npm run check:release-workflow","npm run test:release-identity","npm run test:deploy-prod",
  "npm run typecheck","npm test","npm run test:php","npm run build","npm run check:repository-baseline",
  "npm run check:change-contract","npm run test:github-settings","npm run check:history","npm run test:public-secrets","npm run check:public-secrets","npm run check:provenance",
  "npm run check:local-readiness","npm run check:dev-command","npm run check:local-http","npm run test:dependency-advisories","npm run check:whitespace",
]) has(packageJson.scripts?.check ?? "", requiredCheck, "npm run check must remain complete");
expect(!(packageJson.scripts?.check ?? "").includes("npm audit"), "canonical check must not run the network advisory lookup");

if (failures.length) {
  for (const failure of failures) console.error("FAIL " + failure);
  console.error("\n" + failures.length + " repository baseline acceptance check(s) failed.");
  process.exit(1);
}
console.log("WG-ARCH-001 repository-baseline inventory passed: pinned Node/npm policy, TS7/Vite8/Vitest5/React19/R3F9/Wrangler4, strict TypeScript coverage, React document boundaries, generated-output CSP surfaces, root/release/history policy, single-commit GitHub settings expectation, tag-driven release policy, and complete repository gate.");
