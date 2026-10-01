# Full-3D accessibility proof

ST-128 re-proves the accessibility contract for the current React Three Fiber game after the full-3D control and renderer rebuild. This is a current-state verification record, not a WCAG certification and not a claim that a visual realtime 3D action game is equivalent to a text game.

## Automated proof

The repository's credential-free check covers deterministic contracts for the full keyboard control map, authoritative round lifecycle, focus-trap implementation, native button semantics, reduced-motion camera and shark presentation, non-color Apex and depth cues, bounded live announcements, spatial-audio captions, touch pointer ownership, safe-area layout, minimum target sizing, high-contrast hooks, the semantic-only depth radar, and the accessible description of the WebGL gameplay view.

The keyboard contract exercises WASD-equivalent pitch/yaw, arrow-equivalent camera look, burst, bite, pause ownership, respawn and exit affordances, and the authoritative active to Apex to result to next-round lifecycle. The engine remains authoritative; accessibility presentation does not send new gameplay truth.

Reduced-motion mode keeps the same authoritative snapshots and controls. It removes or snaps presentation-only camera easing, speed FOV expansion, shark swim animation, excessive bank smoothing, particle travel, environmental drift, and Frenzy pulsing/rotation without hiding Apex, Frenzy, depth, health, score, cooldown, result, reconnect, or navigation state.

The WebGL surface is described as a 3D gameplay view using the player's current key bindings. Meaningful competitive state remains outside WebGL in semantic DOM HUD, leaderboard, dialogs, live regions, captions, projected labels, and the depth radar. Hiding the visual radar keeps its semantic content available.

Gameplay-relevant captions are produced independently of whether Web Audio can actually play, while still respecting spatial range and bounded repeat cadence. Screen-reader announcements remain separate and event-bounded so a full room does not announce every actor update.

## Browser and device checks outside automated proof

This repository does not currently include a real-browser automation harness such as Playwright, Puppeteer, or WebDriver. Static/source contracts and deterministic unit tests therefore do not prove browser or assistive-technology behavior by themselves.

The following remain browser/device acceptance checks: real Tab and Shift+Tab focus traversal; focus restoration after pause, settings, help, result and death transitions; Escape handling in modal dialogs; VoiceOver, TalkBack and desktop screen-reader announcements; 200 percent and higher browser zoom/reflow; physical safe-area cutouts; portrait-to-landscape rotation; simultaneous touch sticks plus ability pointers on hardware; computed contrast in the running browser; and caption readability over representative 3D scenes.

Those checks should be repeated during ST-131 product acceptance. Any failure is a product defect; this document does not waive it.

## Boundaries preserved

The production renderer remains React Three Fiber/WebGL only. There is no Canvas2D or planar accessibility fallback. Desktop jet-style flight, mobile dual-stick input, ST-126 depth-aware cues, non-color signaling, semantic DOM equivalents, reduced motion, captions, spatial underwater audio, Apex, Feeding Frenzy, combat, scoring, prey, movement, Room schema 11, realtime protocol 11, and package version 2.0.0 remain in place.
