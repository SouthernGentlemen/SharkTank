# Architecture

SharkTank is one Cloudflare Worker deployment with a React browser game, two Durable Object classes, and one R2 binding.

```text
browser ── HTTPS ──> Worker router ──> Lobby Durable Object
   │                    │             profiles, presence, logs,
   │                    │             receipts, spend, backups
   │                    ├───────────> Room Durable Objects
   └── WebSocket ───────┘             authoritative simulation
                        │
                        ├───────────> Static Assets
                        └───────────> R2 state copies
```

## Public and operator boundaries

The canonical human destinations are `/`, `/controls/`, `/evidence/`, and `/play/`. Compatibility human routes redirect directly to their owning canonical section. Machine-readable evidence remains on its stable JSON/text routes, public APIs live under `/api/`, authenticated operations live under `/admin/`, and room WebSockets terminate at `/room/:id/ws`.

The Lobby Durable Object uses the stable name `global`. Room objects use stable room identifiers. Production Durable Object class names, migration tag `v1`, environment identity, and storage bindings are stateful compatibility boundaries and must not be changed as ordinary refactors.

## Worker structure

`src/worker/index.ts` owns request sequencing and controller flow. `src/worker/routes.ts` owns route declarations and predicates, `src/worker/responses.ts` owns shared security-aware response construction, and `src/worker/presentation-data.ts` owns public presentation shaping and redaction.

`src/worker/presentation-react.tsx` renders ordinary human documents with React 19 `renderToStaticMarkup`. `src/worker/presentation.ts` supplies focused evidence and conformance generators through one audited raw-artifact boundary. Ordinary Worker documents are complete without JavaScript and are not hydrated. `src/client/human-docs.ts` provides optional progressive enhancement only.

## Game client boundary

`/play/` is the one explicit browser application boundary. `src/client/game-document.tsx` owns the React 19 game document shell and Vite renders it to static markup during `transformIndexHtml`; checked-in `index.html` is only the Vite HTML-entry sentinel.

`src/client/main.tsx` mounts the interactive game with `createRoot` into `#root`. Vite owns the client module graph, CSS extraction, content-hashed production assets, and the lazy `GameScreen` chunk. No client-side router is used, and Worker-rendered human documents are not hydrated.

## Static assets and CSP

Wrangler keeps `run_worker_first` enabled with `html_handling` and `not_found_handling` set to `none`. The Worker explicitly fetches Vite's built `/index.html` through the `ASSETS` binding for the game shell. Known assets keep their own paths; unknown application and asset paths remain ordinary 404s and cannot fall back to the game document.

Worker pages use the fingerprinted `PAGE_CSS_PATH` stylesheet. The game shell and mounted game use Vite-processed CSS. Dynamic visual state uses SVG attributes or finite data/class tokens rather than inline style strings. Production `style-src` is limited to `'self'`; narrowly scoped inline scripts require per-response nonces.

## WG-ARCH-001 project-specific boundaries

SharkTank adopts the WG-ARCH-001 repository toolchain, presentation, security, release, and evidence baseline with explicit product-specific boundaries rather than adding unused platform features. Its current toolchain is Node.js 26.10.0 in `.node-version` and npm 12.1.0 in `packageManager`, with supported engine policy Node 26.x/npm 12.x. `/play/` is the documented client-application exception to the ordinary progressive-enhancement model. The product uses Durable Objects for coordinated game state and R2 for retained copies; it does not add D1, GraphQL, OAuth/SSO/SAML, or MCP because the current product has no requirement for them.

Repository delivery is also intentionally squash-only so each controlled ST change lands as one non-merge commit on `main`. That single-commit policy is the current SharkTank delivery authority and is enforced by the committed GitHub-settings expectation; merge commits and rebase merges are not accepted for controlled ST work.

## Accessibility and deterministic runtime

The governance pages and supported game controls use semantic structure, keyboard operation, visible focus, managed focus, alternative status output, configurable contrast/text scale, and reduced-motion support. The implemented interface target is WCAG 2.0 AA; no certification is claimed.

`vendor/ModuleReact3Fiber` is first-party source and supplies the deterministic engine and protocol used by the Worker and browser client.
