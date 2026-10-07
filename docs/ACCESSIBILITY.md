# Accessibility

SharkTank keeps accessible interaction in the semantic DOM around the React Three Fiber gameplay surface. This is the current product boundary, not a certification claim.

## Current behavior

The keyboard map covers W/S pitch, A/D yaw, Arrow-key camera look, burst, bite, pause, respawn and exit. Simple mobile controls use independent pointers for flight and abilities; Advanced adds a separate look pointer.

Menus, HUD, leaderboard, settings, dialogs, captions, live announcements, projected shark labels and depth cues remain semantic HTML/React. The WebGL view has an accessible description of the active controls.

Reduced motion limits camera easing, banking, particles and environmental motion without hiding gameplay state. High contrast and non-color cues preserve Apex, depth, health, score and navigation meaning. Captions are produced independently of Web Audio playback.

Local prediction, remote interpolation and graphics quality are presentation paths only. Accessibility settings cannot remove authoritative actors or competitive state. Settings stay in the device-local player record.

In-memory engine schema 11 and realtime protocol 12 remain current.

## Manual acceptance

The repository does not currently include a real-browser automation harness. Automated tests do not replace real browser, device or assistive-technology checks. On the exact candidate commit, verify:

- Tab and Shift+Tab traversal, focus entry/restoration and Escape behavior.
- VoiceOver, TalkBack or the target desktop screen reader.
- 200% and higher zoom/reflow.
- Computed contrast in the running browser.
- Reduced-motion and high-contrast presentation during active play.
- Caption readability during busy scenes.
- Physical simultaneous dual-stick plus ability pointers on hardware, rotation and safe-area cutouts.
- Real WebGL rendering on the target browser/device.

Use [PRODUCT-ACCEPTANCE.md](PRODUCT-ACCEPTANCE.md) for the complete release-facing procedure.

Remote sharks, prey and effects share a 150 ms interpolation delay, derived from the protocol’s 100 ms broadcast cadence. Snapshot bracketing uses authoritative ticks on the client clock, estimating tick rate and tracking the minimum packet offset over two seconds with phase correction limited to 5 ms per second. Reconnects and tick regressions reset the clock.

Remote actors extrapolate for at most 120 ms beyond the newest snapshot, then hold. Sharks follow authoritative yaw/pitch and dash-derived speed (including Frenzy); prey use their last snapshot velocity. Per-actor presentation offsets blend back over 120 ms without a position jump when packets resume. Competitive state remains authoritative.

Shark and prey swim phases use continuous client frame seconds at the existing frequencies, independent of snapshot arrival or holds. Remote banking uses snapshot-pair yaw rates with a low-pass filter before roll easing. Reduced motion keeps swim flex in the rest pose.

Steering intent sends at most every 50 ms (20 Hz), with 0.015 rad yaw/pitch thresholds. A trailing timer sends smaller final changes after 50 ms of settling, within 100 ms of the last input change while connected. Reconnect and cleanup discard pending orientation. Competitive movement remains server-owned.

Local dash prediction starts on a connected burst press when the latest authoritative cooldown is ready, using the engine dash envelope. Authoritative lunge state confirms it; an unconfirmed lunge cancels after 250 ms and uses bounded movement reconciliation. Damage and cooldown remain server-owned.

Local shark reconciliation uses a shared visual offset for the mesh, labels and camera target. Corrections up to 12 units blend with a 120 ms half-life while prediction continues; larger discontinuities, spawn, respawn and reconnect snap. This presentation offset never changes competitive state.

Per-session welcome and state snapshots retain every shark, effect and round field, but include only prey within 72 units of the living player's position (the tank centre while dead or absent). The server still simulates every prey. All quality presets finish fog by 70 units. Prey disappearance produces an eat sound or caption only within 12 units of a living shark mouth. Typical 32-shark session snapshots fit within 14 KB.

The chase camera follows closer and higher, framing a level-swimming shark in the lower third with more water ahead. Follow distance still scales with shark size and speed, and camera/aim positions stay clamped inside the water. Reduced motion still disables speed-based camera expansion and snaps directly to the follow pose.

Touch steering defaults to Simple: one floating flight stick starts anywhere in the chosen flight half, with automatic camera recentring and no look stick. Advanced dual-stick retains independent flight and camera look. Controls Settings switches schemes live and saves the choice on this device; switching releases active stick gestures. Desktop controls and the current landscape requirement are unchanged.

Simple touch vertical deflection sets a proportional climb or dive target up to 0.85 rad; releasing the stick targets level even when Auto-level is off. Horizontal deflection remains a yaw rate. Advanced dual-stick and keyboard pitch retain their existing rate controls. Server movement and water-bound pitch limits remain authoritative.

Touch Bite is an 88 px round pad in the bottom corner opposite flight, with Dash above and inward. Advanced places the arc above the look pad. Radial rings and spoken labels show authoritative cooldowns; pads accept cooldown presses, with one bite buffered only during the final 200 ms. Pause, disconnect, rotation and hidden-page cleanup discard buffered intent. The Room still enforces cooldowns.
