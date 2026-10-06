# Accessibility

SharkTank keeps accessible interaction in the semantic DOM around the React Three Fiber gameplay surface. This is the current product boundary, not a certification claim.

## Current behavior

The keyboard map covers W/S pitch, A/D yaw, Arrow-key camera look, burst, bite, pause, respawn and exit. Mobile controls use independent pointers for flight, look and abilities.

Menus, HUD, leaderboard, settings, dialogs, captions, live announcements, projected shark labels and depth cues remain semantic HTML/React. The WebGL view has an accessible description of the active controls.

Reduced motion limits camera easing, banking, particles and environmental motion without hiding gameplay state. High contrast and non-color cues preserve Apex, depth, health, score and navigation meaning. Captions are produced independently of Web Audio playback.

Local prediction, remote interpolation and graphics quality are presentation paths only. Accessibility settings cannot remove authoritative actors or competitive state. Settings stay in the device-local player record.

Wire state schema 11 and realtime protocol 11 remain current.

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
