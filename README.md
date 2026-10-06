# SharkTank

SharkTank is a realtime full-3D multiplayer shark game served by one Cloudflare Worker. Production has one gameplay tank, `room-1`, displayed as **SharkTank**, with 8 human seats and 24 server-authoritative bots.

## Local development

Use Node.js 26.10.0 from `.node-version` and npm 12.1.0 from `packageManager`.

```sh
npm ci
npm run dev -- --no-open
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run local` | Build, start the local Worker, wait for readiness, and optionally open the game. |
| `npm run dev:worker` | Start Wrangler directly on port 8787. |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Build the Vite client. |
| `npm run check` | Run the credential-free repository acceptance gate. |
| `npm run audit:dependencies` | Run the separate live dependency advisory gate. |
| `npm run check:game-surface -- http://127.0.0.1:8787` | Check the local HTTP and WebSocket game surface. |

## Worker surface

- `/` and `/play` redirect to `/play/`.
- `/play/` serves the React game document and Vite assets.
- `/version.json` exposes release identity through the shared wg-edge shell.
- `/room/room-1/ws` is the only gameplay WebSocket.
- Unknown routes return the shared shell 404.

The Worker exports only `Room`. Player name, skin, best score, controls, audio and accessibility settings stay in one device-local browser record.

## Room authority

The Room Durable Object owns movement, collisions, prey consumption, score, growth, damage, death/respawn, Feeding Frenzy, Apex and round state. Gameplay runs in memory for the life of the Room object; a new object starts a fresh round.

The deterministic engine and protocol are server-safe. The client uses local prediction for the player's shark and remote interpolation for other sharks and prey, but presentation never writes competitive truth. Sharks use one authoritative `position`; client snapshots and prediction use the same single-position model. Engine and client state use `Shark` / `sharks`; the wire adapters retain protocol 11’s `snakes` key until ST-240. Protocol 11 keeps `segments: [position]` for living sharks (empty for dead sharks) and the legacy `boosting: false` / `chargeTicks: 0` fields until the queued protocol update.

Wire state schema 11 and realtime protocol 11 are current.

## Controls

Desktop flight uses **W/S pitch**, **A/D yaw**, and the **Arrow keys look** around the chase camera. **Space bursts**, **F bites**, and **Escape pauses**. Mouse movement may mirror camera look but is not required for play.

Mobile uses **dual-stick** control: one stick owns pitch/yaw and the other owns camera look. Bite and burst keep independent simultaneous pointers.

Combat is directional bite plus burst. Feeding Frenzy and Apex are server-owned round phases.

## Accessibility and performance

The React Three Fiber / Three.js scene is full X/Y/Z. The WebGL canvas is presentation; the HUD, leaderboard, dialogs, captions, announcements, labels and depth cues remain in the semantic DOM.

Reduced motion, high contrast, captions and quality settings may change presentation cost and motion, but they cannot remove authoritative actors or competitive state. See [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) and [docs/PRODUCT-ACCEPTANCE.md](docs/PRODUCT-ACCEPTANCE.md).

## Release and controlled delivery

[AGENTS.md](AGENTS.md) defines controlled delivery and `implementation_plan.md` is the current/future queue. Ordinary task merges do not create a release.

A semantic release advances package and lock versions together. A same-product revision advances `releaseRevision`. The Release workflow verifies the exact accepted commit, publishes the matching GitHub Release, then calls the pinned baseline deployment workflow. Production deployment requires the protected `production` approval and verifies `/version.json`.

## Repository map

- `src/worker/` — Worker routing and the memory-only Room Durable Object.
- `src/client/` — game document and browser entry.
- `src/engine/` — deterministic authoritative simulation.
- `src/protocol/` — schema/protocol 11 transport shapes.
- `src/game/` — React Three Fiber renderer, controls, prediction, interpolation and audio.
- `scripts/` — local development, validation and release tooling.

Remote sharks, prey and effects share a 150 ms interpolation delay, derived from the protocol’s 100 ms broadcast cadence. Snapshot bracketing uses authoritative ticks on the client clock, estimating tick rate and tracking the minimum packet offset over two seconds with phase correction limited to 5 ms per second. Reconnects and tick regressions reset the clock.
