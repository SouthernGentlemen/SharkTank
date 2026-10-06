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

Sharks use one authoritative `position`; client snapshots and prediction use the same single-position model. Engine, client and wire state use `Shark` / `sharks` with a single `position`. Protocol 12 omits legacy segments, boosting, chargeTicks and schemaVersion. Prey tuples carry a stable short id hash, species code, X/Y/Z at 0.1 precision and yaw/pitch at 0.01; the parser restores presentation fields from the permanent sixteen-species table.

In-memory engine schema 11 and realtime protocol 12 are current. The Worker imports only server-safe engine/protocol entries.

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

Remote sharks, prey and effects share a 150 ms interpolation delay, derived from the protocol’s 100 ms broadcast cadence. Snapshot bracketing uses authoritative ticks on the client clock, estimating tick rate and tracking the minimum packet offset over two seconds with phase correction limited to 5 ms per second. Reconnects and tick regressions reset the clock.

Remote actors extrapolate for at most 120 ms beyond the newest snapshot, then hold. Sharks follow authoritative yaw/pitch and dash-derived speed (including Frenzy); prey use their last snapshot velocity. Per-actor presentation offsets blend back over 120 ms without a position jump when packets resume. Competitive state remains authoritative.

Shark and prey swim phases use continuous client frame seconds at the existing frequencies, independent of snapshot arrival or holds. Remote banking uses snapshot-pair yaw rates with a low-pass filter before roll easing. Reduced motion keeps swim flex in the rest pose.

Steering intent sends at most every 50 ms (20 Hz), with 0.015 rad yaw/pitch thresholds. A trailing timer sends smaller final changes after 50 ms of settling, within 100 ms of the last input change while connected. Reconnect and cleanup discard pending orientation. Competitive movement remains server-owned.

Local dash prediction starts on a connected burst press when the latest authoritative cooldown is ready, using the engine dash envelope. Authoritative lunge state confirms it; an unconfirmed lunge cancels after 250 ms and uses bounded movement reconciliation. Damage and cooldown remain server-owned.

Local shark reconciliation uses a shared visual offset for the mesh, labels and camera target. Corrections up to 12 units blend with a 120 ms half-life while prediction continues; larger discontinuities, spawn, respawn and reconnect snap. This presentation offset never changes competitive state.

Per-session welcome and state snapshots retain every shark, effect and round field, but include only prey within 72 units of the living player's position (the tank centre while dead or absent). The server still simulates every prey. All quality presets finish fog by 70 units. Prey disappearance produces an eat sound or caption only within 12 units of a living shark mouth. Typical 32-shark session snapshots fit within 14 KB.

Graphics quality defaults to Auto: Medium for coarse-pointer or ≤ 4 GB device-memory hints, High otherwise. Saved explicit choices win. A two-second frame average above 1.25 × the 60 Hz target lowers DPR in 0.25 steps to a floor of 1; ten seconds below 0.8 × target raises it toward the preset/device cap. Resolution adaptation preserves quality, actors and cues. Suspension gaps reset sampling.

Shark climb and dive pitch share a proportional limit over the final three units before the surface or seabed. The Room, local prediction and input use the same helper, preserving inward steering and leveling outward movement without contact snapping.

The arena wall is a non-lethal returning current: it turns shark headings inward with growing strength over the final 4 units and clamps positions 0.5 units inside the wall. Local prediction shares the current and clamp; bite and retirement remain the only death actions.
