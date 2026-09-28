# Implementation plan

## Open tasks

MVP target for every task below: SharkTank is the game at `/play/`, a short server-rendered overview at `/`, one live operations page at `/evidence/`, and the authenticated operator console at `/admin/`, with only the JSON that the game, those pages and operators call. ISO/IEC 27001 and 42001 assurance lives at demo.wizardgang.ai/assurance. Keep billing measurement and the spend hard stop, Durable Object class names and migration `v1`, stored Lobby and Room state, R2 copies, deterministic replay, strict CSP, no-JavaScript completeness of Worker pages, and the protected release and deployment path. Each task updates the tests, acceptance scripts and documents its change invalidates. Retired routes return the standard 404 unless the owner decides otherwise. Only ST-108 may create a tag, GitHub Release or production deployment.

Shared validation for every task: pinned `npm ci`, focused tests for the touched modules and scripts, canonical `npm run check`, `npm run audit:dependencies`, committed-range whitespace, exact-head required CI, post-merge CI, history and completed-branch cleanup.

### ST-108 — [OPS] Release the MVP surface

- Dependency: ST-107 has merged.
- Why: Production keeps serving v1.3.8, with the whole proof-of-concept surface, until a governed release ships the cull.
- Scope: Advance `package.json` and `package-lock.json` together to the release version. After merged-main CI, the Release Tag workflow tags the accepted commit and dispatches the Release workflow, which publishes the GitHub Release and deploys through the protected `production` stage when `PRODUCTION_DEPLOY_ENABLED=true`. Verify `/version.json`, the three canonical pages, retired-route 404s and the unauthenticated admin 401 on the public origin.
- Non-goals: No DNS, secret, Durable Object, R2 or GitHub-settings change.
- Owner decision: `v2.0.0` by default because public routes and endpoints are removed; alternatively `v1.4.0`, or hold the release.
- Acceptance: One annotated tag on the accepted commit, a matching non-draft GitHub Release, Cloudflare deployment evidence that the version serves 100% of traffic, and passing public checks where the edge allows them.
- Authorities: README.md, .github/workflows/tag-release.yml, .github/workflows/release.yml, .github/workflows/deploy.yml, scripts/release-tag.mjs, scripts/release-publication.mjs, scripts/deploy-prod.mjs.
