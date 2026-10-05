# Architecture

SharkTank is one Cloudflare Worker deployment with one React Three Fiber browser game, one Durable Object class and static assets.

```text
browser ── HTTPS ──> Worker router ──> Room Durable Object
   │                    │               memory-only authoritative simulation
   │                    └─────────────> Static Assets
   ├── localStorage
   │   name / skin / best / settings
   └── WebSocket ──────────────────────> Room Durable Object
```

## Product surface

The retired `/evidence/`, `/status.json` and `/spend.json` surfaces return 404; `/version.json` remains the public release-identity endpoint.

- `/` — permanent redirect to `/play/`.
- `/play/` — the interactive realtime full-3D game.
- `/admin/*` — shared wg-edge operator gate; the SharkTank app has no admin handler.
- Unknown paths — shared shell 404 with JSON or HTML according to `Accept`.

The only routable gameplay Room is stable id `room-1`, displayed as **SharkTank**; `room-2` through `room-4` are retired at the Worker boundary. The Worker exports only `Room`. The new top-level `sharktank` config creates a fresh SQLite-backed `Room` class with migration `v1`. It does not transfer old data or define `Lobby`; `wizardgangprod` remains untouched until its separately governed retirement.

## Worker, engine and renderer boundaries

The vendored `platform/wg-edge/` shell owns host/TLS checks, `/version.json`, security headers, errors and 404s. `src/worker/index.ts` passes the game routes to `createEdge`; `src/worker/routes.ts` owns route predicates, and `src/worker/responses.ts` owns game responses. The app emits no HTML; it serves the Vite-built game document through Static Assets. The game shell and assets use first-party-only script CSP without a nonce or analytics allowance.

`/play/` is the one explicit browser application boundary. `src/client/game-document.tsx` owns the React 19 game shell, `src/client/main.tsx` mounts the browser app, and Vite owns the client module graph and content-hashed assets. Name, skin, best score and systems settings share one device-local `localStorage` record; the legacy `snakeio.settings.v1` settings record migrates into it on first load.

The gameplay renderer is React Three Fiber / Three.js only. `GameViewport` mounts one R3F `Canvas`; `Scene` composes the ocean environment, shark actors, prey, effects and chase camera. Gameplay is full X/Y/Z. Authoritative orientation is yaw + pitch. Roll/banking is presentation-only. Canvas2D is not a hidden fallback.

`vendor/ModuleReact3Fiber/src/engine/`, `src/protocol/` and `src/store/` are deterministic/server-safe and import no DOM, React or Three.js. Browser-only code lives under `src/client/`. The Worker imports only server-safe module entries.

## Competitive authority

The Room Durable Object owns competitive gameplay authority. The deterministic engine advances plain in-memory Room state from ordered actions and seeded RNG. RoomState no longer carries a persisted schema field; wire state schema 11 still carries the authoritative ocean volume, sharks, prey, effects, Feeding Frenzy state and round/Apex/result state, and realtime protocol 11 remains the transport identity.

Authoritative shark movement uses X/Y/Z with yaw + pitch. Score-relevant prey/fish are authoritative X/Y/Z actors. Directional bite + burst is the combat model; ordinary body overlap separates/deflects and is non-lethal. Score, damage, prey consumption, death/respawn, cooldown ownership and round transitions are server-owned.

Feeding Frenzy is an authoritative 3D convergence event. Apex is the final authoritative round phase. Each Room owns the five-minute round, result window and next-round reset. Late joins on the live object receive the current authoritative phase rather than reconstructing it from a browser timer. If the Room object restarts, it deliberately begins a fresh round.

The deterministic engine remains framework-agnostic and server-safe. Room inputs are not retained as a replay log, and gameplay state is not restored from storage.

## Client prediction and interpolation

Client presentation never becomes competitive authority.

The local shark uses local prediction so input feels immediate, then reconciles yaw, pitch and X/Y/Z against authoritative snapshots. Large divergence hard-resets to server state; smaller divergence eases toward it within bounded correction rules.

Remote sharks and prey use remote interpolation/timeline caches between authoritative snapshots. Reconnect resets those timelines so stale presentation state is not carried across sessions. Transient audiovisual events are filtered by authoritative tick freshness.

Prediction, interpolation, camera banking, particles and audio cannot write score, damage, prey, round state or authoritative movement.

## Control ownership

Desktop uses the same two-axis mental model as mobile:

- W/S — pitch up/down.
- A/D — yaw left/right.
- Arrow Up/Down/Left/Right — independent chase-camera look offsets.
- Space — burst.
- F — directional bite.
- Escape — pause.
- Mouse movement — optional camera-look mirror only.

Mobile uses independent dual-stick input. The flight stick owns pitch/yaw; the opposite look stick owns chase-camera offsets. Each stick owns its own captured pointer. Bite and burst use separate simultaneous ability pointers. Mirrored flight-stick layouts, coarse pointers, safe areas and orientation changes are explicit control concerns.

## Accessibility boundary

Accessibility remains DOM-first around the WebGL gameplay surface. HUD, leaderboard, settings, dialogs, focus management, live announcements, captions, projected labels and depth-aware competitive cues stay semantic HTML/React. The R3F viewport exposes an accessible description of the active control map.

Reduced motion changes camera easing, banking/swish animation, particles and environmental motion without hiding competitive state. High contrast and non-color Apex/depth cues remain presentation layers over the same authoritative snapshots. Captions are produced independently of whether Web Audio playback succeeds.

Real assistive-technology behavior, physical multi-touch, rotation, safe-area cutouts, zoom/reflow and computed browser contrast remain product-acceptance checks.

## Performance boundary

Quality scaling is presentation-only. It may reduce DPR, antialiasing, particles, water/environment detail, repeated-prop complexity, model detail, audio emitter count and non-critical update cadence. It cannot remove authoritative actors or competitive cues.

Repeated prey/environment work is bounded or batched where practical. Render-frame transforms stay outside React state when possible. The Room remains authoritative regardless of client quality preset.

## Operations, persistence and release

The Worker has no operational Durable Object. Billing, backup, restore and scheduled R2 copies are removed.

Room Durable Objects run gameplay and sessions entirely in memory. On object boot the Room clears legacy Durable Object storage, starts a fresh round, and uses standard WebSockets with in-memory sessions; no Room snapshot or metadata is read or written, no hibernation attachment is restored, and the tick loop keeps the object active while sockets are connected. The `wizardgangprod` Worker is not deployed again; the later `sharktank` cut-over creates fresh class identity and migration history.

Ordinary controlled changes do not create tags, GitHub Releases or production deployments. Release identity is package version + immutable annotated tag + GitHub Release + exact accepted commit. The Release workflow calls baseline's pinned `deploy-worker.yml` with `secrets: inherit` after publication. That workflow owns the protected `production` approval and exact Worker deployment proof. Its current tag input is semantic `vX.Y.Z`.

## WG-ARCH-001 project-specific boundaries

SharkTank uses Node.js 26.10.0 and npm 12.1.0. It uses Room Durable Objects for coordinated game state.

Repository delivery is squash-only so each controlled ST change lands as one non-merge commit on `main`. Protected `verify` is required on the exact current PR head, completed branches delete automatically, and release tags are immutable.
