# SharkTank

SharkTank is a realtime full-3D multiplayer shark game at `/play/`, backed by authoritative Cloudflare Durable Objects. Production exposes one gameplay tank: `room-1`, displayed as **SharkTank**, with 8 human seats and 24 server-authoritative bots. The same Worker redirects `/` to `/play/` and serves release identity at `/version.json`.

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
| `npm run check:game-surface -- http://127.0.0.1:8787` | Focused local check of the game HTTP and WebSocket surface. |
| `npm run verify:github-settings` | Read-only comparison of live GitHub merge/ruleset settings with the committed authority. Requires repository-administration read access. |
| `npm run apply:github-settings` | Explicit bounded mutation of GitHub merge/ruleset settings to the committed authority, followed by a fresh verification. |
| `npm run deploy:wizardgangprod:dry-run` | Local deployment dry-run. It requires a semantic release tag at `HEAD` and the Cloudflare account identifier but does not deploy production. |

## Full-3D game boundary

`/play/` has one gameplay renderer: React Three Fiber / Three.js WebGL through `GameViewport` and `Scene`. Gameplay state is full X/Y/Z. Authoritative shark orientation is yaw + pitch; banking/roll is presentation-only. Canvas2D is not a hidden fallback.

The Room Durable Object owns competitive truth: movement, collisions, prey consumption, scoring, damage, death/respawn, Feeding Frenzy, Apex, and round phase/result/reset. The deterministic engine/protocol remain framework-agnostic and server-safe. Three.js and browser APIs stay inside the client entry.

Clients may smooth what the player sees without moving authority. The local shark uses local prediction followed by authoritative X/Y/Z reconciliation. Remote sharks and prey use remote interpolation between server snapshots. Neither path can author score, damage, prey, round state, or authoritative movement.

Wire state schema 11 and realtime protocol 11 are the current client/server identities. Room simulation remains deterministic from seed, ordered actions, tick state, and RNG state, but gameplay is not persisted: each Room object boot starts a fresh round after clearing legacy Durable Object storage.

## Controls and competitive loop

Desktop flight is keyboard-first and jet-style: **W/S pitch**, **A/D yaw**, and the **Arrow keys look** independently around the chase camera. **Space bursts**, **F bites**, and **Escape pauses**. Mouse movement may mirror camera look, but mouse input is not required to steer, climb, dive, or fight.

Mobile uses independent **dual-stick** control: one flight stick maps to pitch/yaw and one look stick maps to chase-camera offsets. The sticks own separate pointers, and bite/burst retain separate simultaneous ability pointers.

Score-relevant fish/prey are authoritative gameplay actors with X/Y/Z position and collision state. Shark combat is directional bite plus burst with bounded size advantage; ordinary body overlap separates/deflects rather than dealing lethal contact damage. There is no ranged core weapon path.

Feeding Frenzy, Apex, five-minute rounds, the result window, and the next-round reset are server-owned.

## Accessibility and performance

The WebGL scene is gameplay presentation, not the semantic UI. HUD, leaderboard, settings, dialogs, captions, announcements, projected labels and depth-aware competitive cues remain DOM-first.

Quality scaling may change DPR, antialiasing, particles, water/environment detail, update cadence, model detail and decorative work. It may not remove authoritative actors or competitive cues.

See [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md), [docs/PRODUCT-ACCEPTANCE.md](docs/PRODUCT-ACCEPTANCE.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Operations and security

Public HTTP and WebSocket input is untrusted. Unknown paths return plain-text 404s. The Worker enforces request/message bounds, allowed rooms, origin checks, rate limits, HTTPS redirects, strict response security headers, and server-side authority over simulation and score. Player name, skin, best score and settings stay in one device-local browser record; they are not profile or telemetry writes. The Room owns authoritative competitive state only in memory for the lifetime of the object, while the Lobby still owns the operational state scheduled for later retirement; browser preferences never become competitive authority.

The retired public evidence/status/spend surfaces and all `/admin/*` routes return 404. The maintenance gate and operator credentials are gone; billing, backup and scheduled copy internals are removed; the remaining Lobby is queued for retirement.

The Worker has no scheduled handler or R2 binding.

## Release and deployment boundary

Ordinary controlled changes do not create tags, GitHub Releases, or production deployments. A normal semantic release advances `package.json` and `package-lock.json` together and resets tracked `releaseRevision` to 0. A same-product release advances `package.json.releaseRevision` exactly once and creates an immutable `vX.Y.Z-rN` revision tag while package and lock product versions remain `X.Y.Z`. An unchanged product version and unchanged revision are a no-op.

The Release workflow verifies exact tag/package/revision/commit identity, runs the canonical checks and advisory gate, publishes the matching GitHub Release, then may enter the existing protected production deployment path. Production exposes the base product identity through `SHARKTANK_RELEASE` and the immutable deployed artifact identity through `SHARKTANK_RELEASE_REVISION`.

## Controlled work

[AGENTS.md](AGENTS.md) is the delivery contract and `implementation_plan.md` is the permanent current/future queue. Work only the first open task unless the owner changes priority.

The provenance CSVs under `docs/history/` remain validator inputs for imported source lineage, not a changelog or forward history.

## Repository map

- `src/worker/` — Worker routing, memory-only Room and operational Lobby Durable Objects, and protected operations.
- `src/client/` — Vite-built game document and browser entry.
- `vendor/ModuleReact3Fiber/src/engine/` — deterministic full-3D authoritative simulation.
- `vendor/ModuleReact3Fiber/src/protocol/` — schema/protocol 11 HTTP and realtime shapes.
- `vendor/ModuleReact3Fiber/src/client/` — browser-only R3F renderer, controls, local prediction, remote interpolation, audio and DOM game UI.
- `scripts/` — local development, validation, release, and deployment tooling.
