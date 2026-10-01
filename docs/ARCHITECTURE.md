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

## Feeding Frenzy authority

Feeding Frenzy is an authoritative 3D convergence event owned by the Room simulation. Every 75 seconds of simulation time the server opens a 20-second central event cylinder. Its radius is 30% of the ocean radius and its half-height is 32% of the playable water column, bounded away from the surface and seabed. The server deterministically places 40 chum actors throughout that volume with seeded horizontal placement and vertically stratified depth; every third piece is worth 5 points and the rest use the ordinary 3-point chum value.

While the event is active, the authoritative movement multiplier is 1.16 and the authoritative dash cooldown multiplier is 0.5. Bots use the same X/Y/Z prey coordinates, ocean geometry, event state, movement and dash action as players; there is no bot-only teleport or scoring path. Event chum is retired when the authoritative end tick is reached so long-lived Rooms do not accumulate event-only actors.

Realtime snapshots use schema/protocol 11 and carry authoritative `tick`, `frenzyUntilTick`, and round state. Shared engine rules derive whether the event is active and its remaining duration, so late join/reconnect does not depend on a browser timer. Normal play keeps the deterministic 75-second cadence; the Apex phase guarantees one final 20-second frenzy ending exactly at the round boundary. The client adds presentation only: the central beacon/column changes state, the HUD shows the server-derived countdown and bounded modifiers, and audio/caption hooks announce start/end. Reduced-motion mode removes pulsing/rotation without hiding state; low-quality mode reduces landmark ring complexity without removing the navigation cue.

## Round and Apex authority

Each Room runs a server-owned five-minute competitive round (6,000 ticks at 20 Hz), with the final 45 seconds designated as the Apex phase and a 10-second result/reset window. The highest score wins; score ties resolve by stable shark id so replay produces the same winner. During Apex, the current score leader is the authoritative Apex target. That shark receives a bounded 1.08× swim modifier, carries a visible geometric marker, and is worth a 12-point / 1.2-growth elimination bounty. Bots see the same Apex id and can pursue it through the ordinary combat path.

At the round end the Room freezes competitive simulation, records the winner, removes event-only chum, and rejects movement/combat/respawn inputs until reset. The next round resets score, growth, health, death/respawn state, prey, effects, and frenzy state while retaining Room id/seed/ocean, connected player identity/cosmetics, Durable Object identity, and separately stored operational metadata. Late joins receive the complete active/Apex/result state in their welcome snapshot; joining during the result window waits inertly for the next server reset.

Schema 11 deliberately resets schema-10-or-older transient Room snapshots rather than guessing a round boundary, while preserving stable identity/seed/ocean values and rotating incompatible replay logs. Personal best writes are accepted only from authoritative Room results; public profile writes own cosmetics/settings and cannot submit score.


## Spatial underwater audio presentation

Underwater audio is a browser-only presentation layer over schema/protocol 11 snapshots. The chase camera supplies a throttled listener transform, while gameplay cues consume authoritative shark, prey, explosion, Feeding Frenzy and round/Apex state already present on the client. Audio never sends gameplay actions, changes scores, chooses targets, or creates a parallel simulation.

The Web Audio graph uses bounded HRTF world emitters where supported, deterministic distance attenuation, restrained rear filtering, representative nearby-shark/prey cues, distinct combat/prey signatures, and a low underwater ambience. World one-shots are range-limited, rate-limited and voice-capped; low quality uses a smaller emitter budget. Browsers without spatial panning fall back to stereo or gain-only presentation without affecting gameplay.

Audio context startup remains user-gesture safe. Hidden tabs suspend the context; leaving play stops ambience, music and transient voices; page teardown disposes the graph. Music remains opt-in at the existing zero default. Master/SFX/music controls continue to own gain, and captions mirror gameplay-relevant cue types while the existing visual HUD, Frenzy, Apex and round state remain independently readable.


## Static assets and security

Wrangler keeps `run_worker_first` enabled with `html_handling` and `not_found_handling` set to `none`. The Worker explicitly fetches Vite's built `/index.html` through the `ASSETS` binding only for the game shell. Known assets keep their own paths; unknown application and asset paths remain ordinary 404s.

Worker pages use the fingerprinted `PAGE_CSS_PATH` stylesheet. The game shell uses Vite-processed CSS. Dynamic visual state uses SVG attributes or finite class/data tokens rather than inline styles. Production `style-src` is limited to `'self'`; narrowly scoped inline scripts require per-response nonces. Operator routes require TLS and platform-secret authentication, and state-changing operator actions require the same-origin action contract.

## WG-ARCH-001 project-specific boundaries

SharkTank adopts the WG-ARCH-001 repository toolchain, presentation, security, release, and evidence baseline with product-specific boundaries rather than unused platform features. The toolchain is pinned to Node.js 26.10.0 and npm 12.1.0, with supported engine policy Node 26.x/npm 12.x. The product uses Durable Objects for coordinated game state and R2 for retained copies; it does not add D1, GraphQL, OAuth/SSO/SAML, or MCP without a product requirement.

Repository delivery is intentionally squash-only so each controlled ST change lands as one non-merge commit on `main`. Merge commits and rebase merges are disabled by the committed GitHub-settings authority, protected `verify` is required on the exact current PR head, and release tags are immutable.
