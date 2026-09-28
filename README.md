# SharkTank

SharkTank is a realtime multiplayer game at `/play/`, backed by authoritative Cloudflare Durable Objects. The same Worker serves a short overview at `/`, live operations and billing evidence at `/evidence/`, and an authenticated operator console at `/admin/`. The remaining JSON, text, API, and WebSocket routes exist only to support those surfaces and the game.

**[Overview](https://sharktank.wizardgang.ai)** · **[Play](https://sharktank.wizardgang.ai/play/)** · **[Evidence](https://sharktank.wizardgang.ai/evidence/)**

## Command map

Use Node.js 26.10.0 from `.node-version` and npm 12.1.0 from `packageManager`. Run `npm ci` before repository validation.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Safe local whole-stack lifecycle: validates local ownership, rebuilds, starts Wrangler, waits for HTTP readiness, and opens the app. Use `npm run dev -- --no-open` for headless use. |
| `npm run local` | Alias for the same safe local lifecycle. |
| `npm run dev:worker` | Raw Wrangler-only development path on port 8787. `npm start` delegates here. |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Build the Vite production output locally. |
| `npm run check` | Canonical credential-free acceptance gate: plan/change contracts, type checks, tests, build, repository/history/provenance/settings checks, local HTTP acceptance, dependency-policy cases, and whitespace. |
| `npm run audit:dependencies` | Separate live network advisory gate. CI and release verification require it. |
| `npm run check:public-ia -- http://127.0.0.1:8787` | Focused local check of the public MVP information architecture. |
| `npm run check:evidence -- http://127.0.0.1:8787` | Focused local check of the public evidence surface. |
| `npm run verify:github-settings` | Read-only comparison of live GitHub merge/ruleset settings with the committed authority. Requires repository-administration read access. |
| `npm run apply:github-settings` | Explicit bounded mutation of GitHub merge/ruleset settings to the committed authority, followed by a fresh verification. |
| `npm run deploy:wizardgangprod:dry-run` | Local deployment dry-run. It requires a semantic release tag at `HEAD` and the Cloudflare account identifier but does not deploy production. |

The shared WG-ARCH-001 dependency cohort is enforced by repository validation. SharkTank intentionally retains React/React DOM 19.2.8 for the checked-in React Three Fiber module peer range; changing that exception requires consumer and game-client validation.

## Operations and security

Public HTTP and WebSocket input is untrusted. The Worker enforces request/message bounds, allowed rooms and event types, origin checks, rate limits, TLS for operator traffic, strict response security headers, and server-side authority over simulation and score. Durable Objects own authoritative Lobby and Room state; the browser is not authoritative.

The public evidence surface intentionally exposes redacted live status, billing, incidents, control receipts, continuity results, recent service logs, and bounded per-room text logs. Operator routes under `/admin/` require platform-secret credentials; state-changing actions also require same-origin action headers and leave control receipts. Source-repository vulnerabilities are reported through GitHub private vulnerability reporting as described in [SECURITY.md](SECURITY.md).

Spend enforcement fails closed. Incident handling should confirm the signal, use the smallest appropriate containment, preserve incident/receipt evidence, restore service, verify the public evidence/version surfaces, and record corrective action. Raising the hard spend limit is an owner decision, not an automated recovery step.

The scheduled Worker copies Lobby state to the configured R2 binding. Restore drills read the retained copy into a scratch Durable Object, compare state digests, record the result, and wipe scratch state; they never overwrite live production state. Room simulation remains deterministic from its seed, ordered actions, and RNG state. Do not rename Durable Object classes, migration tag `v1`, or storage bindings as a rollback shortcut.

## Release and deployment boundary

Ordinary controlled changes do not create tags, GitHub Releases, or production deployments. A release change advances `package.json` and `package-lock.json` together. After the accepted `main` commit passes CI, the Release Tag workflow compares the version with its parent. An unchanged version is a no-op; a valid increase creates or verifies one immutable annotated `vX.Y.Z` tag on that accepted commit and dispatches the Release workflow with the exact tag and accepted SHA.

The Release workflow checks out the immutable tag, installs the lockfile, runs `npm run check` and `npm run audit:dependencies`, verifies tag/package/commit identity and accepted-main ancestry, then creates or verifies the matching non-draft, non-prerelease GitHub Release without rewriting it. Only after publication succeeds may the reusable deployment stage run.

Production deployment is optional behind `PRODUCTION_DEPLOY_ENABLED=true`, the protected `production` GitHub environment, Cloudflare credentials, and a second exact release-identity check. Real deployment is accepted only from the SharkTank Release workflow in GitHub Actions and does not load local `.env` authority. GitHub Actions and immutable tags/Releases are the authority for repository release history; Cloudflare/provider evidence is the authority for actual production deployment state. Roll back by deploying a previously verified tag through the same controlled workflow.

## Controlled work

[AGENTS.md](AGENTS.md) is the delivery contract and `implementation_plan.md` is the permanent current/future queue. Work only the first open task unless the owner changes priority. SharkTank uses the `ST-NNN` namespace, branch names of the form `st-NNN-imperative-summary`, and controlled titles of the form `[ST-NNN] [TYPE] Imperative summary`.

Each task is delivered as one controlled branch commit with the required structured body, including its plan removal. Require the exact PR head to pass protected `verify`, re-fetch current `main`, mergeability and governed settings, then squash-merge only that validated head. Confirm one controlled commit on `main`, green post-merge CI, completed-branch deletion, and unchanged provider policy. Never bypass required checks, add bypass actors, move published release tags, or create a release/deployment unless the queued task explicitly requires it.

The provenance CSVs under `docs/history/` remain validator inputs for imported source lineage, not a changelog or forward history. Git/GitHub retain controlled implementation history. Automated dependency-bump pull requests are not accepted.

## Repository map

- `src/worker/` — Worker routing, Durable Objects, operations, and public evidence.
- `src/client/` — game browser entry plus optional enhancement for Worker-rendered pages.
- `vendor/ModuleReact3Fiber/` — first-party deterministic game engine, protocol, storage seam, and React Three Fiber client.
- `scripts/` — local development, validation, release, and deployment tooling.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current MVP architecture and SharkTank-specific WG-ARCH-001 boundaries.
