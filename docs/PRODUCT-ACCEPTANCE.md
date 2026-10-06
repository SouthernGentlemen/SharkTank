# Product acceptance

Use this procedure on the exact candidate commit. Automated checks establish deterministic contracts; real-browser and physical-device rows must be performed where specified.

A manual-only row is not a pass until somebody actually performs it on the exact accepted commit. Until then its result is `NOT RUN`.

## Automated acceptance

Use Node 26.10.0 and npm 12.1.0 from a clean checkout.

```sh
npm ci
npm test -- tests/full-3d-product-acceptance.test.ts
npm run check
npm run audit:dependencies
git diff --check HEAD^
```

The focused product test covers the device-local player record, menu/tank/game lifecycle, death and respawn, score updates, round reset, desktop/mobile input math, quality modes, accessibility presentation hooks, room capacity, prey bounds and Feeding Frenzy.

The snapshot timeline test replays 10 Hz arrivals with ±25 ms jitter at 60 Hz and requires fewer than 2% clamped frames after startup.

The local HTTP gate checks the root redirect, `/play/`, `/version.json`, static assets, shared 404 handling and a Room WebSocket hello/welcome exchange.

## Real-browser desktop acceptance

Run `npm run dev -- --no-open` and open `/play/` in a hardware-accelerated desktop browser.

1. Choose Play and join SharkTank. Confirm the full-3D WebGL ocean renders.
2. Verify W/S pitch, A/D yaw, all four Arrow-key look directions, Space burst and F bite.
3. Confirm optional mouse look changes camera look without taking steering authority.
4. Play through death, authoritative respawn and return to the same tank.
5. Observe active round, Apex, result and next-round reset.
6. Switch Low, Medium and High quality while playing; gameplay actors and cues must remain present.
7. Play through Feeding Frenzy and confirm controls, shared state and readable cues remain intact.

Record browser/version, OS, GPU/WebGL renderer, exact commit and PASS/FAIL for every step.

## Accessibility and visual acceptance

On the same commit:

1. Traverse menus, gameplay tools, pause/settings/help, death and result flows with Tab and Shift+Tab.
2. Verify Reduced motion and High contrast during active play.
3. Verify captions and shark labels remain readable during busy gameplay.
4. Test at 200% browser zoom and higher.
5. Run the target platform screen reader and verify names, reading order, dialogs and bounded announcements.

Automated contracts do not substitute for these real-browser observations.

## Physical touch acceptance

Use a physical coarse-pointer phone or tablet.

1. Hold flight and look controls simultaneously and verify independent response.
2. Activate burst and bite while both controls remain held.
3. Switch the flight-stick side and repeat.
4. Rotate between portrait and landscape and confirm input releases/recovery are safe.
5. Verify controls, captions and round actions remain reachable around safe-area cutouts.

Browser device emulation may help layout debugging but does not satisfy the physical multi-touch rows.

## Support-surface acceptance

Spot-check the exact candidate environment:

- `/` redirects to `/play/`.
- `/play/` loads the built game and first-party assets.
- `/version.json` matches the candidate release identity.
- `/room/room-1/ws` accepts protocol 11 WebSocket play.
- Unknown application paths, including the retired `/api/health`, return the shared 404.

Do not use production credentials for local acceptance.

## Recording results

Record the environment and PASS/FAIL for desktop lifecycle, controls, quality modes, accessibility modes, zoom/reflow, screen reader, physical multi-touch, rotation/safe area and Feeding Frenzy readability. Any failure blocks release acceptance until corrected.
