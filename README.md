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

The deterministic engine and protocol are server-safe. The client uses local prediction for the player's shark and remote interpolation for other sharks and prey, but presentation never writes competitive truth. Sharks use one authoritative `position`; client snapshots and prediction use the same single-position model. Engine, client and wire state use `Shark` / `sharks` with a single `position`. Protocol 12 omits legacy segments, boosting, chargeTicks and schemaVersion. Prey tuples carry a stable short id hash, species code, X/Y/Z at 0.1 precision and yaw/pitch at 0.01; the parser restores presentation fields from the permanent sixteen-species table.

In-memory engine schema 11 and realtime protocol 12 are current.

## Controls

Desktop flight uses **W/S pitch**, **A/D yaw**, and the **Arrow keys look** around the chase camera. **Space bursts**, **F bites**, and **Escape pauses**. Mouse movement may mirror camera look but is not required for play.

Mobile defaults to **Simple** one-thumb pitch/yaw with automatic camera recentring. Advanced **dual-stick** adds independent camera look. Bite and burst keep independent simultaneous pointers.

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
- `src/protocol/` — protocol 12 transport shapes.
- `src/game/` — React Three Fiber renderer, controls, prediction, interpolation and audio.
- `scripts/` — local development, validation and release tooling.

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

The chase camera follows closer and higher, framing a level-swimming shark in the lower third with more water ahead. Follow distance still scales with shark size and speed, and camera/aim positions stay clamped inside the water. Reduced motion still disables speed-based camera expansion and snaps directly to the follow pose.

Client aim assist gently nudges steering toward prey or living sharks at most two-thirds your length, within a 20° cone and 14 units. Its combined angular correction is capped at 0.25 rad/s. It defaults on with touch controls and off with keyboard controls; an explicit Controls Settings toggle persists on the device. Hits, damage and score remain server-owned.

Touch steering defaults to Simple: one floating flight stick starts anywhere in the chosen flight half, with automatic camera recentring and no look stick. Advanced dual-stick retains independent flight and camera look. Controls Settings switches schemes live and saves the choice on this device; switching releases active stick gestures. Desktop controls are unchanged.

Simple touch vertical deflection sets a proportional climb or dive target up to 0.85 rad; releasing the stick targets level even when Auto-level is off. Horizontal deflection remains a yaw rate. Advanced dual-stick and keyboard pitch retain their existing rate controls. Server movement and water-bound pitch limits remain authoritative.

Touch Bite is an 88 px round pad in the bottom corner opposite flight, with Dash above and inward. Advanced places the arc above the look pad. Radial rings and spoken labels show authoritative cooldowns; pads accept cooldown presses, with one bite buffered only during the final 200 ms. Pause, disconnect, rotation and hidden-page cleanup discard buffered intent. The Room still enforces cooldowns.

Portrait touch play uses a lower-left flight stick and bottom-right Bite and Dash by default; the flight-side setting mirrors the layout. Advanced keeps its look stick above the action pads. The HUD is compact, and tall aspect ratios widen camera framing up to 100° without changing server state. Rotation releases held sticks, ability pointers and buffered bites before play resumes.

The server-safe engine owns the unchanged shark size curve and oriented rest-pose geometry: mouth at 1.9 × scale, snout tip at 2.56 × scale and tail at 2.45 × scale behind. Renderer landmarks and camera framing share this geometry; damage and cooldown rules remain unchanged. Automated geometry tests cover size limits, yaw and pitch.

Prey consumption uses a swept capsule from the previous tick’s mouth to its current mouth, with radius 1.2 + 0.55 × shark scale plus prey radius. Humans eat at most four prey per tick and bots two; score and growth remain server-owned.

Bites measure the attacker mouth to the nearest point on the victim body axis, subtracting 0.62 × victim scale. Reach is 1.8 + 0.3 × attacker scale, with a 65° cone from the attacker position to that point. The nearest valid body surface wins, with stable id ties; bots use the same reach. Tail, flank and aimed-away cases have deterministic tests.

Bites devour sharks at most two-thirds the attacker’s length. Other bites deal 50 damage (60 during burst; regeneration between bites can require an additional hit), or 20 against a victim at least 1.5× longer. Kill rewards are 25% of victim score rounded and clamped to 5–60, and 25% of victim length clamped to 0.5–8; Apex bounty remains additive. Living sharks regenerate 4 HP/s up to 100 on the server clock; round results freeze health. Spawn protection and bite cooldown remain authoritative.

Client presentation classifies every other living shark at the same 1.5× devour boundary: ▼ eat, ■ even and ▲ danger. Shark rims and projected name tags use green, amber and red alongside those glyphs, and the depth radar repeats the glyph plus text label, so color is never the only cue. This presentation does not change server-owned combat authority.
