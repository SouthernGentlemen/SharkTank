# SharkTank

SharkTank is a realtime multiplayer game backed by authoritative Cloudflare Durable Objects. The same deployment publishes operational status, incidents, logs, continuity evidence, receipt-chain integrity, and spend limits.

**[Overview](https://sharktank.wizardgang.ai)** · **[Play](https://sharktank.wizardgang.ai/play/)** · **[Evidence](https://sharktank.wizardgang.ai/evidence/)**

## Command map

Use the shared WG-ARCH-001 toolchain authority: Node.js 26.10.0 from `.node-version` and npm 12.1.0 from `packageManager`. The engine policy remains Node 26.x/npm 12.x, and `npm run check` fails when acceptance runs on a different exact Node/npm pair. Run `npm ci` before repository validation.

The shared TypeScript, Vite, Vitest, Wrangler and Node types versions match the portfolio cohort. SharkTank retains React and React DOM 19.2.8 because `@react-three/fiber@9.7.0` and the checked-in `module-react3fiber` source declare a React peer range below 19.3. SharkTank owns this exception; update both consumer peer contracts and test the game client before a later React convergence task. The install script policy permits only reviewed exact esbuild and workerd versions; optional fsevents is disabled.

| Command | Purpose and current side effects |
| --- | --- |
| `npm run dev` | Standard local development lifecycle. It uses the same `scripts/local.mjs` implementation as `npm run local`: may install missing Node dependencies, stops only checkout-owned Wrangler processes, fails closed on a foreign listener on port 8787, clears only validated disposable `dist/` and `.wrangler/` state, builds, starts Wrangler, waits for bounded HTTP readiness on port 8787, then reports/opens the application URL. For headless/cloud use, run exactly `npm run dev -- --no-open`; readiness still runs and only browser launch is suppressed. |
| `npm run local` | Compatibility alias for the same safe lifecycle used by `npm run dev`. Headless use is exactly `npm run local -- --no-open` and still requires readiness. |
| `npm run dev:worker` | Narrow raw-Wrangler development path on port 8787 without the safe local lifecycle reset. `npm start` preserves its prior behavior by delegating to this explicit command. Wrangler may load ignored `.dev.vars` for local values. |
| `npm test` | Runs the Vitest suite. It does not build, start the local stack, or mutate provider state. |
| `npm run build` | Runs the Vite production build into local generated output. It does not publish a release or deploy production. |
| `npm run check` | Complete credential-free repository acceptance: type checks, tests, build, repository/change/history/provenance/settings tests, local HTTP acceptance, pure dependency-advisory policy cases, and patch whitespace. Its local HTTP gate owns a temporary Worker on port 8792. The gate launches Wrangler with a temporary test-owned environment file, so ignored developer `.dev.vars` values are not part of repository acceptance. |
| `npm run audit:dependencies` | Separate live network advisory gate at moderate severity or higher. CI and release verification require it. |
| `npm run verify:github-settings` | Read-only live GitHub settings verification against `config/github-repository-settings.json`. Requires an admin-capable `GH_ADMIN_TOKEN` or `GH_TOKEN` with Repository Administration read access. |
| `npm run apply:github-settings` | Explicitly mutates repository merge settings and rulesets to the committed authority, then re-reads them. Requires Repository Administration write access. This is not part of ordinary repository acceptance. |
| `npm run deploy:wizardgangprod:dry-run` | Runs the production deployment script with Wrangler `--dry-run`. It still requires `SHARKTANK_RELEASE` to be a semantic `vX.Y.Z` tag at `HEAD` and `CLOUDFLARE_ACCOUNT_ID` (the script can load the ignored `.env`), and it performs a build, but it does not deploy production. |

## Release and production boundary

After a merged `main` commit passes CI, the Release Tag workflow compares the root package version with its parent. Ordinary commits create no tag; an intentional lockstep `package.json`/`package-lock.json` version increase creates exactly one annotated `vX.Y.Z` tag on that accepted commit, while a matching existing tag is idempotent and any conflicting tag fails without being moved. The tag workflow explicitly dispatches the Release workflow on `main` with that exact tag and accepted commit. The release workflow checks out the tag, installs its locked dependencies, runs `npm run check` plus the live dependency-advisory gate, verifies annotated tag/package/commit identity and accepted-main ancestry, and creates or verifies the matching non-draft/non-prerelease GitHub Release without rewriting it. Only after publication succeeds may it call the reusable `.github/workflows/deploy.yml` stage with that same tag and commit. Production deployment remains optional behind `PRODUCTION_DEPLOY_ENABLED=true`, the protected `production` environment, Cloudflare credentials, and an independent exact-tag identity check. The real deployment command additionally refuses unless it is running in GitHub Actions for the exact SharkTank Release workflow dispatch context; it never loads local `.env` authority. The ignored `.env` is available only to the explicit local dry-run.

Release publication and production deployment are therefore separate evidence boundaries but ordered stages: deployment cannot start from the tag workflow before the GitHub Release exists, and the reusable deploy workflow has no independent branch or manual trigger. A green CI or release verification job proves repository acceptance only; it does not by itself prove that a GitHub Release was published or that production changed. Do not run production deployment paths merely to validate a pull request.

## Repository map

- `src/worker/` — Worker routing, Durable Objects, operations, and public evidence.
- `src/client/` — browser application entry and progressive enhancement.
- `vendor/ModuleReact3Fiber/` — first-party deterministic game engine and client source.
- `scripts/` — local development, verification, release, and deployment tooling.

## SharkTank-specific controlled work

Use the `ST-NNN` namespace and `[ST-NNN] [TYPE] Imperative summary` for branch commits and pull requests. Branches use `st-NNN-imperative-summary`. The required exact-head check is `verify`; see [change management](docs/CHANGE-MANAGEMENT.md) for the controlled title, body, and evidence contract. Automated dependency-bump pull requests are not accepted. Git history owns forward ST sequencing; reconstruction provenance ledgers record imported source lineage rather than new change history.

Keep structural migrations behavior-preserving unless the task changes behavior. The realtime game is the client-application boundary; ordinary documentation and operations pages must remain complete without JavaScript. Keep presentation work out of the Worker entry point when focused modules can own it. Preserve Durable Object identities and migrations, R2 production state, protocol semantics, and fail-closed release and deployment behavior. Do not add D1, GraphQL, MCP, SAML, Tailwind, or another platform feature solely for baseline conformity.

For organization baseline questions, consult WG-ARCH-001 §27 in the [architecture standard](https://github.com/SouthernGentlemen/wizardgang-architecture-demo/blob/main/docs/ARCHITECTURE-STANDARD.md). SharkTank requirements may extend that standard when the product needs them.

## Current-state documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY-MODEL.md)
- [Operations](docs/OPERATIONS.md)
- [Continuity and recovery](docs/CONTINUITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Release management](docs/RELEASE-MANAGEMENT.md)
- [Change management](docs/CHANGE-MANAGEMENT.md)
- [Security reporting](SECURITY.md)

These documents describe the current system and operating policy. Git/GitHub are authoritative for implementation and release history; provider evidence is authoritative for deployment/runtime provider state.

## GitHub auto-merge

The committed repository settings enable per-PR auto-merge. Enabling this repository capability does not enroll a PR: an authorized contributor chooses auto-merge for that PR. GitHub then waits for required reviews and exact-head checks and uses the repository's squash-only merge policy. Run `npm run verify:github-settings` for a read-only live check; `npm run apply:github-settings` applies the committed authority and independently verifies it.
