# CLAUDE.md — ModuleReact3Fiber

Portable deterministic full-3D game engine + React Three Fiber client used by SharkTank. The current production host is the SharkTank Cloudflare Worker with Room Durable Objects owning competitive gameplay authority.

## Hard design constraints

1. **Engine purity.** `src/engine/**`, `src/store/**` and `src/protocol/**` stay free of DOM, Three.js, React and Node-only APIs. The authoritative Room Durable Object imports the same server-safe engine/protocol source used by deterministic tests.
2. **Deterministic + serializable.** `RoomState` is plain JSON. All simulation randomness goes through seeded RNG state held in live memory. No `Date.now()` or `Math.random()` inside authoritative simulation steps.
3. **Full-3D authority.** Competitive state is full X/Y/Z. Shark orientation is yaw + pitch; roll/banking is presentation-only. Score-relevant prey, combat, Feeding Frenzy, Apex and round transitions remain server-owned.
4. **No Room persistence.** The SharkTank Room keeps gameplay and sessions in memory only. Server-safe store utilities may remain for other consumers, but the Room does not snapshot, restore, or replay gameplay through provider storage.
5. **Entry-point hygiene.** The Worker imports only `engine`/`store`/`protocol`, never `client`. React Three Fiber and Three.js stay browser-only.
6. **Client authority boundary.** Local prediction and remote interpolation may smooth snapshots but cannot author score, damage, prey, death/respawn, cooldowns, round state or authoritative movement.
7. **Shared controls.** Desktop WASD pitch/yaw + arrow-key look and mobile dual-stick flight/look feed the same steering semantics. Bite and burst stay separate actions; mobile supports simultaneous ability pointers.

## Current production integration

- `Room` Durable Objects own authoritative simulation and WebSocket sessions.
- Wire state schema 11 and realtime protocol 11 are the current client/server identities; Room engine state is memory-only.
- The production renderer is the R3F `GameViewport` / `Scene`; there is no alternate gameplay renderer.
- Stable Durable Object class names, migration tag `v1`, bindings and release/deploy guards belong to the host repository and are not module refactor targets.

## Conventions

- TypeScript, ESM, `.js` extensions in relative imports.
- Keep changes small and typed; the host `npm run check` is the canonical credential-free gate.
- Keep authoritative engine/protocol behavior independent of render quality and browser-only accessibility presentation.
