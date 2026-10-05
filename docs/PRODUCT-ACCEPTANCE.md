# Full-3D product acceptance

This is the reproducible product-acceptance procedure for the full-3D SharkTank client. It separates evidence that the repository can prove deterministically from observations that require a real browser, physical touch hardware, assistive technology, or human visual review.

A manual-only row is not a pass until somebody actually performs it on the exact accepted commit and records the result. Unit tests, source assertions, device emulation, or a green CI run do not substitute for a real-browser/device observation.

## Automated acceptance

From a clean checkout of the exact candidate commit, using Node 26.10.0 and npm 12.1.0:

```sh
npm ci
npm test -- tests/full-3d-product-acceptance.test.ts
npm run check
npm run audit:dependencies
git diff --check HEAD^
```

The focused product test composes existing deterministic contracts into one acceptance wall for the device-local player record, menu/tank/game lifecycle, death and respawn, authoritative best-score update, round result/reset, desktop and mobile input math, mouse-look mirroring, low/medium/high quality profiles, reduced-motion/high-contrast/caption/color-label presentation hooks, a maximum tracked-shark room, maximum prey bounds, and a sustained authoritative Feeding Frenzy.

The canonical check starts a credential-free local Worker with a test-owned operator token. Its HTTP acceptance covers `/`, `/evidence/`, `/play/`, unauthenticated and authenticated `/admin/`, the surviving health/tank APIs, explicit 404s for retired `/api/profile` and `/api/audit`, static game assets, and an upgraded Room Durable Object WebSocket hello/welcome exchange. Provider credentials are stripped from that local process.

The repository baseline and product acceptance also pin the compatibility boundaries surrounding the accepted full-3D release: package version 2.0.0 with tracked release revision 1, Room schema 11, realtime protocol 11, Durable Object classes `Room` and `Lobby`, migration tag `v1`, bindings, squash-only GitHub settings, protected `verify`, immutable release tags, release-before-deploy sequencing, and the protected production environment.

## Real-browser desktop acceptance

Use the exact candidate commit. Run `npm ci` and `npm run dev -- --no-open`, then open the local `/play/` URL in a hardware-accelerated desktop browser.

1. From the main menu, choose Play, enter the tank list, join a tank, and confirm the real WebGL ocean scene renders rather than a 2D fallback or blank canvas.
2. Fly with W/S pitch and A/D yaw. Use all four Arrow keys to look independently. Confirm Space bursts and F bites. Confirm gameplay does not require the mouse.
3. Move the pointer over the gameplay surface and confirm optional mouse-look mirrors camera look without changing the shark's authoritative steering.
4. Cross the arena boundary to trigger death, wait for the authoritative respawn window, activate Respawn, and confirm control returns to the same tank.
5. Observe active round, Apex, result, and next-round reset. Use the result dialog's Ready for next round control and confirm the authoritative next round begins.
6. Switch Graphics quality through Low, Medium, and High while playing. Confirm the same sharks, prey, HUD state, Apex/depth cues, and controls remain present; only presentation cost/detail changes.
7. Keep the room active through a Feeding Frenzy. Confirm the event begins on shared state, remains playable for the full event window, shows central-water-column cues/captioned state, then ends without losing controls or authoritative actors.

Record browser name/version, OS, GPU/WebGL renderer, exact commit SHA, and PASS/FAIL for every step.

## Accessibility and visual acceptance

On the same exact commit in a real browser:

1. Traverse menu, tank, gameplay tools, pause, settings, help, death, and result flows using Tab and Shift+Tab. Verify visible focus, expected focus entry/restoration, and Escape behavior for dialogs.
2. Enable Reduced motion and confirm competitive state remains visible while camera easing, banking, particles, environmental drift, and Frenzy motion are reduced or snapped.
3. Enable High contrast and inspect computed styles in the running browser. Verify text, controls, focus indicators, HUD, result/death overlays, and competitive cues remain distinguishable.
4. Enable Captions for audio cues and verify meaningful cues remain readable over representative gameplay, including a busy Feeding Frenzy.
5. Enable Show shark name labels and verify sharks remain distinguishable without relying on color alone.
6. Test at 200 percent browser zoom and higher. Verify reflow, dialogs, tools, labels, captions, and controls do not clip or hide required actions.
7. Run the platform screen reader used for the target browser (for example VoiceOver, NVDA, JAWS, or TalkBack). Verify screen transitions, bounded announcements, dialogs, leaderboard/navigation cues, death/result state, and controls have usable names and reading order.

Do not convert an unrun assistive-technology, computed-contrast, zoom, WebGL, or visual-readability check into PASS because automated contracts are green.

## Physical touch acceptance

Use a physical coarse-pointer phone or tablet running the exact candidate build in a controlled non-production environment.

1. In landscape, hold the flight and look sticks simultaneously and verify independent pitch/yaw and camera-look response.
2. While both sticks are held, activate Dash and Bite with separate pointers. Verify neither stick is stolen or cancelled.
3. Switch the flight-stick side and repeat; verify the look stick and action controls mirror to the opposite side.
4. Rotate portrait to landscape and back. Verify gameplay input releases safely, the portrait guidance appears when required, and returning to landscape restores usable controls.
5. Exercise a device with safe-area insets/cutouts. Verify sticks, action buttons, tools, captions, death/result controls, and HUD remain reachable and unobscured.

Browser device emulation is useful for layout debugging but does not satisfy the simultaneous physical multi-touch or safe-area hardware rows.

## Support-surface acceptance

The automated local HTTP gate is the primary deterministic proof. For a manual browser spot-check on the exact candidate environment:

- `/` renders the overview.
- `/evidence/` renders evidence and its live-refresh control.
- `/admin/` rejects an unauthenticated request and renders the operator console only with the test environment's acceptance credential.
- `/api/health` returns its current JSON contract.
- `/api/tank`, `/api/profile`, `/api/audit`, and `/logs/game/room-1.txt` return 404; the browser keeps name, skin, best score and settings in one device-local record and sends no client telemetry.
- `/room/<room-id>/ws` upgrades only as a WebSocket, accepts protocol 11 hello/input, and returns authoritative protocol 11 state.

Never use production credentials to satisfy ST-131.

## Acceptance record

Record manual observations outside source history or in the PR evidence for the candidate being accepted:

| Area | Environment | Result | Notes |
| --- | --- | --- | --- |
| Desktop lifecycle + WebGL | browser / OS / GPU / SHA | NOT RUN | |
| Desktop keyboard + mouse look | browser / OS / SHA | NOT RUN | |
| Low / Medium / High quality | browser / OS / SHA | NOT RUN | |
| Reduced motion + high contrast | browser / OS / SHA | NOT RUN | |
| Captions + colorblind labels | browser / OS / SHA | NOT RUN | |
| Focus + 200% zoom/reflow | browser / OS / SHA | NOT RUN | |
| Screen reader | AT / browser / OS / SHA | NOT RUN | |
| Physical dual-stick + abilities | device / OS / browser / SHA | NOT RUN | |
| Rotation + safe area | device / OS / browser / SHA | NOT RUN | |
| Feeding Frenzy readability | browser/device / SHA | NOT RUN | |

Any observed failure is a product defect and blocks release acceptance until corrected. ST-131's automated repository proof does not claim these manual rows were executed; it makes the remaining human/browser/device boundary explicit and reproducible instead of treating unavailable checks as passing.
