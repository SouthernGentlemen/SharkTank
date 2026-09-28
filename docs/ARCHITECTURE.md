# Architecture

SharkTank is one Cloudflare Worker deployment with a React browser game, two Durable Object classes, static assets, and one R2 binding.

```text
browser ── HTTPS ──> Worker router ──> Lobby Durable Object
   │                    │             profiles, status, billing,
   │                    │             receipts, logs, backups
   │                    ├───────────> Room Durable Objects
   └── WebSocket ───────┘             authoritative simulation
                        │
                        ├───────────> Static Assets
                        └───────────> R2 state copies
```

## MVP surface

The canonical human surface is deliberately small:

- `/` — server-rendered product and live-operating overview.
- `/evidence/` — server-rendered live status, billing, incidents, control receipts, continuity evidence, recent service logs, and links to bounded per-room text logs.
- `/play/` — the interactive realtime game.
- `/admin/` — the authenticated operator console and its operator-only data/actions.

Only `/play` and `/evidence` redirect to their trailing-slash forms. Retired human aliases and unsupported application routes fall through to the ordinary 404. The surviving JSON/text endpoints, small game API, and `/room/:id/ws` WebSocket route support the MVP surfaces rather than forming a second public product surface.

The Lobby Durable Object uses the stable name `global`. Room objects use stable room identifiers. Production Durable Object class names, migration tag `v1`, environment identity, and storage bindings are stateful compatibility boundaries and are not ordinary refactor targets.

## Worker and state boundaries

`src/worker/index.ts` owns request sequencing and controller flow. `src/worker/routes.ts` owns route predicates, `src/worker/responses.ts` owns security-aware responses, and `src/worker/presentation-data.ts` owns public shaping and redaction.

`src/worker/presentation-react.tsx` renders the overview, evidence, admin, downtime, and not-found documents with React 19 `renderToStaticMarkup`. These Worker-rendered documents are complete without JavaScript; `src/client/human-docs.ts` is optional progressive enhancement only.

Lobby state includes the operational records needed by the current MVP, including profiles, status, billing, receipts, service logs, and backup evidence. Room Durable Objects own authoritative realtime simulation and game logs. Scheduled copies are written through the R2 binding, and restore drills reconstruct retained state into scratch Durable Object state without overwriting live production data.

## Game client boundary

`/play/` is the one explicit browser application boundary. `src/client/game-document.tsx` owns the React 19 game document shell and Vite renders it to static markup during `transformIndexHtml`; checked-in `index.html` is only the Vite HTML-entry sentinel.

`src/client/main.tsx` mounts the interactive game with `createRoot` into `#root`. Vite owns the client module graph, CSS extraction, content-hashed production assets, and lazy game chunks. No client-side router is used, and Worker-rendered human documents are not hydrated.

`vendor/ModuleReact3Fiber` is first-party source. Its engine and protocol are deterministic/server-safe; its client entry is browser-only. The Worker imports only server-safe entries.

## Static assets and security

Wrangler keeps `run_worker_first` enabled with `html_handling` and `not_found_handling` set to `none`. The Worker explicitly fetches Vite's built `/index.html` through the `ASSETS` binding only for the game shell. Known assets keep their own paths; unknown application and asset paths remain ordinary 404s.

Worker pages use the fingerprinted `PAGE_CSS_PATH` stylesheet. The game shell uses Vite-processed CSS. Dynamic visual state uses SVG attributes or finite class/data tokens rather than inline styles. Production `style-src` is limited to `'self'`; narrowly scoped inline scripts require per-response nonces. Operator routes require TLS and platform-secret authentication, and state-changing operator actions require the same-origin action contract.

## WG-ARCH-001 project-specific boundaries

SharkTank adopts the WG-ARCH-001 repository toolchain, presentation, security, release, and evidence baseline with product-specific boundaries rather than unused platform features. The toolchain is pinned to Node.js 26.10.0 and npm 12.1.0, with supported engine policy Node 26.x/npm 12.x. The product uses Durable Objects for coordinated game state and R2 for retained copies; it does not add D1, GraphQL, OAuth/SSO/SAML, or MCP without a product requirement.

Repository delivery is intentionally squash-only so each controlled ST change lands as one non-merge commit on `main`. Merge commits and rebase merges are disabled by the committed GitHub-settings authority, protected `verify` is required on the exact current PR head, and release tags are immutable.
