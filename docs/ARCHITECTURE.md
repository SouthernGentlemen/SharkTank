# Architecture

SharkTank is one Cloudflare Worker, one React Three Fiber browser client, one Room Durable Object class and static Vite assets.

```text
browser ── HTTPS ──> Worker ───────> Static Assets
   │                   │
   │                   └───────────> Room Durable Object
   │                                  in-memory authority
   ├── localStorage
   └── WebSocket ──────────────────> Room Durable Object
```

## Worker surface

The shared `platform/wg-edge/` shell owns host/TLS checks, `/version.json`, response security headers, errors and 404s. SharkTank adds only the game routes.

- `/` and `/play` redirect to `/play/`.
- `/play/` is the one explicit browser application boundary.
- `/room/room-1/ws` is the only gameplay socket.
- Static game assets are served through the Worker asset binding.
- Every other application path falls through to the shared 404.

The top-level `sharktank` Worker exports only `Room`. The stable gameplay id is `room-1`, displayed as **SharkTank**.

## Room authority

`Room` owns competitive state: X/Y/Z movement, yaw + pitch, prey, score, growth, damage, death/respawn, Feeding Frenzy, Apex and round transitions. The engine advances deterministic in-memory state from ordered actions and seeded RNG.

Gameplay is not restored after a Room object restart. A new object starts a new round. Browser-local preferences never become gameplay authority.

The pure deterministic `src/engine/` and shared `src/protocol/` stay free of DOM, React, Three.js and Node-only APIs. Simulation randomness uses seeded RNG in live memory.

Sharks use one authoritative `position`; client snapshots and prediction use the same single-position model. Protocol 11 keeps `segments: [position]` for living sharks (empty for dead sharks) and the legacy `boosting: false` / `chargeTicks: 0` fields until the queued protocol update.

Wire state schema 11 and realtime protocol 11 are current. The Worker imports only server-safe engine/protocol entries.

## Client boundary

`src/client/game-document.tsx` owns the React 19 game shell, `src/client/main.tsx` mounts it, and Vite owns the browser module graph.

The browser-only game lives in `src/game/`. One strict root TypeScript program covers the Worker, engine, protocol and client through relative imports.

React Three Fiber / Three.js is the only gameplay renderer. The world is full X/Y/Z with authoritative yaw + pitch; banking is presentation-only. The local shark uses local prediction followed by server reconciliation. Remote sharks and prey use remote interpolation.

`WorldEnvironment` owns the arena boundary and Feeding Frenzy volume cues. `FxLayer` renders only instanced burst particles.

The semantic DOM owns menus, HUD, leaderboard, settings, dialogs, captions, announcements, labels and depth cues. WebGL does not replace those interfaces.

## Controls

Desktop:
- W/S — pitch.
- A/D — yaw.
- Arrow keys — chase-camera look.
- Space — burst.
- F — directional bite.
- Escape — pause.

Mobile uses independent dual-stick pitch/yaw and camera look with separate ability pointers.

## Local development

Use Node 26.10.0 and npm 12.1.0.

```sh
npm ci
npm run dev -- --no-open
npm run check
npm run audit:dependencies
```

`npm run check` is credential-free. Live GitHub settings verification remains a separate read-only command.

## Release and delivery

Controlled repository changes are squash-only and land as one non-merge commit on `main`. Protected `verify` must pass on the exact PR head and merged branches delete automatically.

Release identity is package version + immutable annotated tag + GitHub Release + exact accepted commit. The Release workflow calls the pinned baseline `deploy-worker.yml`, waits for protected `production` approval, deploys `sharktank`, and verifies the live release identity.

## WG-ARCH-001 project-specific boundaries

SharkTank uses Node.js 26.10.0, npm 12.1.0, React 19, React Three Fiber 9, Three.js and Cloudflare Room Durable Objects. Server authority, exact-head CI, immutable release tags and protected production deployment remain repository requirements.
