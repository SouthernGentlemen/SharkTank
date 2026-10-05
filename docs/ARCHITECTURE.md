# Architecture

SharkTank is one Cloudflare Worker deployment with one React Three Fiber browser game, two Durable Object classes, static assets, and one R2 binding.

```text
browser ── HTTPS ──> Worker router ──> Lobby Durable Object
   │                    │             status, billing,
   │                    │             receipts, logs, backups
   │                    ├───────────> Room Durable Objects
   ├── localStorage                    memory-only authoritative full X/Y/Z simulation
   │   name / skin / best / settings
   └── WebSocket ───────┘
                        │
                        ├───────────> Static Assets
                        └───────────> R2 state copies
```

## Product surface

The retired `/evidence/`, `/status.json` and `/spend.json` surfaces return 404; `/version.json` remains the public release-identity endpoint.

- `/` — server-rendered product and live-operating overview.
- `/play/` — the interactive realtime full-3D game.
- `/admin/` — the authenticated operator console and operator-only actions.

The Lobby Durable Object uses the stable name `global`. The only routable gameplay Room is stable id `room-1`, displayed as **SharkTank**; `room-2` through `room-4` are retired at the Worker boundary. Durable Object class names, migration tag `v1`, environment identity and storage bindings are stateful compatibility boundaries.

## Worker, engine and renderer boundaries

`src/worker/index.ts` owns request sequencing and controller flow. `src/worker/routes.ts` owns route predicates, `src/worker/responses.ts` owns security-aware responses, and `src/worker/presentation-data.ts` owns public shaping and redaction.

`src/worker/presentation-react.tsx` renders the overview, admin, downtime and not-found documents with React 19 `renderToStaticMarkup`. These documents are complete without JavaScript.

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

Lobby state no longer stores player profiles or public client-action events. It still holds the operations state scheduled for retirement in later queue tasks: status, billing, receipts, server-originated service logs and backup evidence. Scheduled copies are written through the R2 binding. Restore drills reconstruct retained Lobby state into scratch Durable Object state without overwriting live production data.

Room Durable Objects run gameplay and sessions entirely in memory. On object boot the Room clears legacy Durable Object storage, starts a fresh round, and uses standard WebSockets with in-memory sessions; no Room snapshot or metadata is read or written, no hibernation attachment is restored, and the tick loop keeps the object active while sockets are connected. Stable Room/Lobby Durable Object identities and migration tag `v1` are not ordinary refactor targets.

Ordinary controlled changes do not create tags, GitHub Releases or production deployments. Release identity is package version + immutable annotated tag + GitHub Release + exact accepted commit. Production deployment remains gated by the current Release workflow, protected `production` environment and Cloudflare credentials.

## WG-ARCH-001 project-specific boundaries

SharkTank uses Node.js 26.10.0 and npm 12.1.0. It uses Durable Objects for coordinated game/operational state and R2 for retained copies.

Repository delivery is squash-only so each controlled ST change lands as one non-merge commit on `main`. Protected `verify` is required on the exact current PR head, completed branches delete automatically, and release tags are immutable.
