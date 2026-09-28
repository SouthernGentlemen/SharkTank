# ModuleReact3Fiber

First-party deterministic game engine, protocol, storage seam, and React Three Fiber client vendored into SharkTank.

## Current use

- `src/engine/` contains pure deterministic simulation over serializable `RoomState`. Seeded RNG state is part of the snapshot so Room Durable Objects can replay authoritative state.
- `src/protocol/` defines the JSON/API and WebSocket shapes shared by the Worker and browser client.
- `src/store/` provides the server-safe `BlobStore` abstraction and JSON helpers used by the module.
- `src/client/` contains the browser-only React Three Fiber game client.

The SharkTank Worker imports only the server-safe engine, store, and protocol entry points. Browser code may import the client entry. Keep that boundary intact so React/Three code does not enter the Worker bundle.

## Entry points

| Import | Contents | Server-safe? |
| --- | --- | --- |
| `module-react3fiber/engine` | deterministic engine core, types, and RNG | Yes |
| `module-react3fiber/store` | `BlobStore`, `JsonStore`, and `MemoryBlobStore` | Yes |
| `module-react3fiber/protocol` | API paths plus request/response types | Yes |
| `module-react3fiber/client` | `GameCanvas`, hooks, and scene code | No |
