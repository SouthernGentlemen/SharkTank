# ModuleReact3Fiber

First-party deterministic full-3D game engine, realtime protocol, and React Three Fiber client vendored into SharkTank.

## Current use

- `src/engine/` contains pure deterministic full X/Y/Z simulation over serializable `RoomState`. Seeded RNG state stays in the live state so deterministic runs can be compared without persisting gameplay.
- `src/protocol/` defines wire state schema 11 and realtime protocol 11 HTTP/WebSocket shapes shared by the Worker and browser client.
- `src/client/` contains the browser-only React Three Fiber game client, DOM UI, controls, local prediction, remote interpolation and presentation audio.

The SharkTank Worker imports only the server-safe engine and protocol entry points. Browser code imports `App` directly from tracked client source. Keep that boundary intact so React/Three code does not enter the Worker bundle.

## Gameplay boundary

The engine models authoritative sharks and prey in full X/Y/Z with yaw + pitch orientation. Roll/banking is presentation-only. Score-relevant prey, directional bite + burst combat, Feeding Frenzy, Apex and round/result/reset state are server-owned.

The client renders one R3F `GameViewport` / `Scene`. Local prediction and remote interpolation smooth authoritative snapshots but cannot author competitive state. Desktop uses WASD flight plus arrow-key look; mobile uses independent dual-stick control plus simultaneous ability pointers.

## Entry points

| Import | Contents | Server-safe? |
| --- | --- | --- |
| `module-react3fiber/engine` | deterministic full-3D engine core, types, rules and RNG | Yes |
| `module-react3fiber/protocol` | Schema/protocol 11 realtime transport types and parsers | Yes |
