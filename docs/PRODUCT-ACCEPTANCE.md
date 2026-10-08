# Product acceptance

Use this procedure on the exact candidate commit. Automated checks establish deterministic contracts; real-browser and physical-device rows must be performed where specified.

A manual-only row is not a pass until somebody actually performs it on the exact accepted commit. Until then its result is `NOT RUN`.

### Standing owner acceptance direction

Owner direction recorded 2026-10-07: owner-operated manual acceptance and owner sign-off gates are authorized for release progression without a separate re-prompt unless the owner later revokes this direction. When an exact-candidate manual observation record is not present, record the gate as owner-authorized rather than inventing an observed PASS.

This standing direction does not bypass automated CI, dependency advisory gates, exact-head validation, immutable release identity, protected GitHub production approval, or provider/production verification.

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

The snapshot timeline test replays 10 Hz arrivals with ±25 ms jitter at 60 Hz and server clocks 1% fast or slow over ten minutes, requiring fewer than 2% clamped frames after startup, render lag within 20 ms of target, and continuous frame-sized clock advances.

Protocol 12 tests require a 32-shark session with visible prey from 480 ambient fish to fit within 14 KB and the 360-prey/32-effect stress fixture within 25 KB. They verify tuple decoding, all sixteen reserved species codes, drop bonus variants and rejection of protocol 11 clients. Stale clients see "Game update required. Reload to reconnect."

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

1. Verify Simple starts a floating flight stick anywhere in the chosen flight half, hides the look stick and recentres the camera. Switch live to Advanced, then hold flight and look controls simultaneously and verify independent response.
2. In Simple, hold the stick up/down and verify a steady climb/dive angle, then release and verify leveling with Auto-level both on and off. Activate burst and bite while both Advanced controls remain held.
3. Switch the flight-stick side and repeat.
4. Play in portrait with Simple and Advanced, verify flight, Bite, Dash and compact HUD, then rotate while holding sticks and abilities and confirm input releases/recovery are safe.
5. Verify controls, captions and round actions remain reachable around safe-area cutouts.

Browser device emulation may help layout debugging but does not satisfy the physical multi-touch rows.

## Support-surface acceptance

Spot-check the exact candidate environment:

- `/` redirects to `/play/`.
- `/play/` loads the built game and first-party assets.
- `/version.json` matches the candidate release identity.
- `/room/room-1/ws` accepts protocol 12 WebSocket play.
- Unknown application paths, including the retired `/api/health`, return the shared 404.

Do not use production credentials for local acceptance.

## Recording results

Record the environment and PASS/FAIL for desktop lifecycle, controls, quality modes, accessibility modes, zoom/reflow, screen reader, physical multi-touch, rotation/safe area and Feeding Frenzy readability. Any failure blocks release acceptance until corrected.

Late-snapshot tests cover 120 ms of continuous shark and prey motion during a 200 ms gap, holding beyond the cap, and continuous recovery when authoritative packets resume.

Shark and prey swim phases use continuous client frame seconds at the existing frequencies, independent of snapshot arrival or holds. Remote banking uses snapshot-pair yaw rates with a low-pass filter before roll easing. Reduced motion keeps swim flex in the rest pose.

Steering intent sends at most every 50 ms (20 Hz), with 0.015 rad yaw/pitch thresholds. A trailing timer sends smaller final changes after 50 ms of settling, within 100 ms of the last input change while connected. Reconnect and cleanup discard pending orientation. Competitive movement remains server-owned.

Local dash prediction starts on a connected burst press when the latest authoritative cooldown is ready, using the engine dash envelope. Authoritative lunge state confirms it; an unconfirmed lunge cancels after 250 ms and uses bounded movement reconciliation. Damage and cooldown remain server-owned.

Local shark reconciliation uses a shared visual offset for the mesh, labels and camera target. Corrections up to 12 units blend with a 120 ms half-life while prediction continues; larger discontinuities, spawn, respawn and reconnect snap. This presentation offset never changes competitive state.

Per-session welcome and state snapshots retain every shark, effect and round field, but include only prey within 72 units of the living player's position (the tank centre while dead or absent). The server still simulates every prey. All quality presets finish fog by 70 units. Prey disappearance produces an eat sound or caption only within 12 units of a living shark mouth. Typical 32-shark session snapshots fit within 14 KB.

Graphics quality defaults to Auto: Medium for coarse-pointer or ≤ 4 GB device-memory hints, High otherwise. Saved explicit choices win. A two-second frame average above 1.25 × the 60 Hz target lowers DPR in 0.25 steps to a floor of 1; ten seconds below 0.8 × target raises it toward the preset/device cap. Resolution adaptation preserves quality, actors and cues. Suspension gaps reset sampling.

The arena wall is a non-lethal returning current: it turns shark headings inward with growing strength over the final 4 units and clamps positions 0.5 units inside the wall. Local prediction shares the current and clamp; bite and retirement remain the only death actions.

The chase camera follows closer and higher, framing a level-swimming shark in the lower third with more water ahead. Follow distance still scales with shark size and speed, and camera/aim positions stay clamped inside the water. Reduced motion still disables speed-based camera expansion and snaps directly to the follow pose.
Camera projection tests cover cruise and burst at minimum, spawn and maximum presentation scales across four headings; existing tests retain pitch, look controls and water-bound checks. Real-browser visual acceptance remains NOT RUN until performed on the exact candidate.

Touch steering defaults to Simple: one floating flight stick starts anywhere in the chosen flight half, with automatic camera recentring and no look stick. Advanced dual-stick retains independent flight and camera look. Controls Settings switches schemes live and saves the choice on this device; switching releases active stick gestures. Desktop controls are unchanged.

Simple touch vertical deflection sets a proportional climb or dive target up to 0.85 rad; releasing the stick targets level even when Auto-level is off. Horizontal deflection remains a yaw rate. Advanced dual-stick and keyboard pitch retain their existing rate controls. Server movement and water-bound pitch limits remain authoritative.

Touch Bite is an 88 px round pad in the bottom corner opposite flight, with Dash above and inward. Advanced places the arc above the look pad. Radial rings and spoken labels show authoritative cooldowns; pads accept cooldown presses, with one bite buffered only during the final 200 ms. Pause, disconnect, rotation and hidden-page cleanup discard buffered intent. The Room still enforces cooldowns.

Portrait touch play uses a lower-left flight stick and bottom-right Bite and Dash by default; the flight-side setting mirrors the layout. Advanced keeps its look stick above the action pads. The HUD is compact, and tall aspect ratios widen camera framing up to 100° without changing server state. Rotation releases held sticks, ability pointers and buffered bites before play resumes.

The server-safe engine owns the unchanged shark size curve and oriented rest-pose geometry: mouth at 1.9 × scale, snout tip at 2.56 × scale and tail at 2.45 × scale behind. Renderer landmarks and camera framing share this geometry; damage and cooldown rules remain unchanged. Automated geometry tests cover size limits, yaw and pitch.

Bites measure the attacker mouth to the nearest point on the victim body axis, subtracting 0.62 × victim scale. Reach is 1.8 + 0.3 × attacker scale, with a 65° cone from the attacker position to that point. The nearest valid body surface wins, with stable id ties; bots use the same reach. Tail, flank and aimed-away cases have deterministic tests.

Bites devour sharks at most two-thirds the attacker’s length. Other bites deal 50 damage (60 during burst; regeneration between bites can require an additional hit), or 20 against a victim at least 1.5× longer. Kill rewards are 25% of victim score rounded and clamped to 5–60, and 25% of victim length clamped to 0.5–8; Apex bounty remains additive. Living sharks regenerate 4 HP/s up to 100 on the server clock; round results freeze health. Spawn protection and bite cooldown remain authoritative.

The shared engine `OCEAN` defines the production tank: radius 120, seabed −18 and surface +18. Room creation, client volume cues and camera defaults share it; live snapshots remain authoritative. Prey budgets are 480 ambient fish, a cap of 720, eight top-ups per tick, 24 schools and 60 Frenzy chum. All quality modes retain the 70-unit fog boundary and 72-unit per-session prey visibility.

Ambient schools are spread uniformly by area outside the central Frenzy volume; Frenzy supplies its central chum. This keeps the larger prey population within the unchanged per-session snapshot budget.
