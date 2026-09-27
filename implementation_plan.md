# Implementation plan

## Open tasks

MVP target for every task below: SharkTank is the game at `/play/`, a short server-rendered overview at `/`, one live operations page at `/evidence/`, and the authenticated operator console at `/admin/`, with only the JSON that the game, those pages and operators call. ISO/IEC 27001 and 42001 assurance lives at demo.wizardgang.ai/assurance. Keep billing measurement and the spend hard stop, Durable Object class names and migration `v1`, stored Lobby and Room state, R2 copies, deterministic replay, strict CSP, no-JavaScript completeness of Worker pages, and the protected release and deployment path. Each task updates the tests, acceptance scripts and documents its change invalidates. Retired routes return the standard 404 unless the owner decides otherwise. Only ST-108 may create a tag, GitHub Release or production deployment.

Shared validation for every task: pinned `npm ci`, focused tests for the touched modules and scripts, canonical `npm run check`, `npm run audit:dependencies`, committed-range whitespace, exact-head required CI, post-merge CI, history and completed-branch cleanup.


### ST-105 — [API] Reduce public and operator endpoints to the MVP set

- Dependency: ST-104 has merged.
- Why: The endpoints proved the concept, but several have no MVP caller: the `/docs/` OpenAPI page and both OpenAPI JSON routes; `/api/leaderboard`, whose top-25 list no UI shows although the Lobby rewrites it on room reports; `/incidents.json` and `/logs.json`, which duplicate the evidence page while operators keep `/admin/*`; and the ISO-era security-report intake, lockdown, dry-run resolution and test-alert controls. `/status.json` also publishes the Lobby `instance` block (boot ID and rate-bucket counts) that the source marks operator-only.
- Scope: Keep public `/api/health`, `/api/tank`, `/api/profile`, `/api/audit`, `/room/:id/ws`, `/status.json`, `/spend.json`, `/version.json` and `/logs/game/:tank.txt`. Keep operator `/admin/`, `/admin/status.json`, `/admin/maintenance`, `/admin/billing-reset`, `/admin/backup.json`, `/admin/backup/run`, `/admin/backup/drill`, `/admin/log.json`, `/admin/log.jsonl`, `/admin/game/:tank` and `/admin/replay/:tank`. Remove `/docs/`, `/openapi.json`, `/docs/openapi.json` and `src/worker/openapi.ts`; `/api/leaderboard`, the public `global` list and the Lobby writes that maintain it; `/incidents.json` and `/logs.json`; and `/api/security-report`, `/admin/security-report`, `/admin/security-resolve` and `/admin/test-alert` with their admin UI and Lobby handlers. Stop publishing `instance` in `/status.json`; it stays in `/admin/status.json`. Stored incidents and receipts with retired causes keep rendering, and Lobby storage keys stay in place. Remove page, footer and `robots.txt` references to retired endpoints, and make GitHub private vulnerability reporting the only intake in SECURITY.md.
- Non-goals: Billing, the spend gate, maintenance, backups and restore drills, and replay stay as they are. No Durable Object class or migration change. No release.
- Owner decision: Retire the security-report and test-alert controls by default, or keep them.
- Acceptance: Each removed route returns 404, as JSON under `/api/`; `/status.json` carries no `instance` or `global`; the admin console still toggles maintenance, resets billing and runs backups and drills; historical security and test-alert incidents still render on `/evidence/`.
- Authorities: SECURITY.md, src/worker/index.ts, src/worker/lobby-do.ts, src/worker/presentation.ts, src/worker/presentation-react.tsx, vendor/ModuleReact3Fiber/src/protocol/index.ts, scripts/check-public-ia.mjs, scripts/check-evidence.mjs.

### ST-106 — [FEAT] Rebuild the evidence page around live operations and billing

- Dependency: ST-105 has merged.
- Why: `/evidence/` is about 511 KB, and 377 KB of it is 772 inline log rows. It leads with a "Server availability" metric, timeline lane and legend entry that are constants computed from an empty incident list, and each request makes three Lobby reads and four Room reads.
- Scope: Order the page as a live status strip (tank access, tank availability from recorded incidents, active players, the tank activity table and the pause control), then billing (gauge, trend and meter table unchanged), incidents (chart, active and resolved), control receipts (verdict and the 50 newest), state copies and restore drills, and recent logs (the 100 newest service records plus per-tank 24-hour TXT downloads instead of inline capture tables). Remove the synthetic server metric, lane and legend entry and `portalAvailability` from `/status.json`. Remove the controlled-degradation ladder, keeping one sentence about the hard stop in billing, and the machine-data block. Update the jump links and live-refresh script, and render from one Lobby status read and one 100-row service-log read with no Room reads.
- Non-goals: Billing calculations, the spend gate, incident and receipt storage, and retention windows stay as they are. No release.
- Acceptance: A Vitest case renders the page from synthetic worst-case data (5,000 service records and 2,000 captures per tank) and asserts at most 100 service rows, no inline capture rows and no server-availability figure; `check-public-ia` asserts the section order; the page stays complete without JavaScript, under strict CSP, with keyboard-reachable chart links and an accessible pause control.
- Authorities: src/worker/presentation.ts, src/worker/presentation-data.ts, src/worker/index.ts, scripts/check-public-ia.mjs, tests/accessibility-contract.test.ts.

### ST-107 — [DOCS] Consolidate repository documentation

- Dependency: ST-106 has merged.
- Why: After the cull, `docs/` mostly restates README, AGENTS.md, CONTRIBUTING.md and the portfolio standard held with the demo, and one copy is already wrong: `docs/CHANGE-MANAGEMENT.md` says a delivery deletes an empty plan and `do needful` plans fresh work, contradicting the permanent queue in AGENTS.md.
- Scope: Delete `docs/SECURITY-MODEL.md`, `docs/OPERATIONS.md`, `docs/CONTINUITY.md`, `docs/DEPLOYMENT.md`, `docs/CHANGE-MANAGEMENT.md` and `docs/RELEASE-MANAGEMENT.md`. Give README a short product statement, the command map, and concise operations and security, release and deployment, and controlled-work sections carrying what is still true; drop its documentation index. Trim `docs/ARCHITECTURE.md` to the MVP system while keeping the statements `check-repository-baseline` requires. Keep `docs/history/*.csv` as provenance validator inputs. Trim the PR template to commands that still exist and the vendored module README to current usage.
- Non-goals: AGENTS.md, CONTRIBUTING.md and the empty-queue template stay byte-identical. No validator change. No release.
- Owner decision: Keep `docs/ARCHITECTURE.md` by default because the shared WG-ARCH-001 baseline requires it; retiring it needs a separate portfolio baseline change.
- Acceptance: `docs/` holds only `ARCHITECTURE.md` and the provenance CSVs; every repository Markdown link resolves; README states the release, deployment and production boundaries.
- Authorities: AGENTS.md, CONTRIBUTING.md, README.md, docs/, scripts/check-repository-baseline.mjs, scripts/check-provenance.mjs, .github/pull_request_template.md.

### ST-108 — [OPS] Release the MVP surface

- Dependency: ST-107 has merged.
- Why: Production keeps serving v1.3.8, with the whole proof-of-concept surface, until a governed release ships the cull.
- Scope: Advance `package.json` and `package-lock.json` together to the release version. After merged-main CI, the Release Tag workflow tags the accepted commit and dispatches the Release workflow, which publishes the GitHub Release and deploys through the protected `production` stage when `PRODUCTION_DEPLOY_ENABLED=true`. Verify `/version.json`, the three canonical pages, retired-route 404s and the unauthenticated admin 401 on the public origin.
- Non-goals: No DNS, secret, Durable Object, R2 or GitHub-settings change.
- Owner decision: `v2.0.0` by default because public routes and endpoints are removed; alternatively `v1.4.0`, or hold the release.
- Acceptance: One annotated tag on the accepted commit, a matching non-draft GitHub Release, Cloudflare deployment evidence that the version serves 100% of traffic, and passing public checks where the edge allows them.
- Authorities: README.md, .github/workflows/tag-release.yml, .github/workflows/release.yml, .github/workflows/deploy.yml, scripts/release-tag.mjs, scripts/release-publication.mjs, scripts/deploy-prod.mjs.
