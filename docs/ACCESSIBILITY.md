# Full-3D accessibility

SharkTank keeps accessibility in the semantic DOM surrounding the React Three Fiber gameplay surface. This document describes the current implementation and proof boundary; it is not a WCAG certification and does not claim that a visual realtime 3D action game is equivalent to a text game.

## Automated proof

The credential-free repository check covers deterministic contracts for the full keyboard control map, authoritative round lifecycle, focus traps, native button semantics, reduced-motion camera and shark presentation, non-color Apex and depth cues, bounded live announcements, spatial-audio captions, touch pointer ownership, safe-area layout, minimum target sizing, high-contrast hooks, the semantic depth radar, and the accessible description of the WebGL gameplay view.

The keyboard contract exercises W/S pitch, A/D yaw, arrow-key camera look, burst, bite, pause ownership, respawn and exit affordances, plus the authoritative active → Apex → result → next-round lifecycle. The Room Durable Object and deterministic engine remain authoritative; accessibility presentation does not create gameplay truth.

Reduced-motion mode keeps the same authoritative snapshots and controls. It removes or snaps presentation-only camera easing, speed FOV expansion, shark swim animation, banking smoothing, particle travel, environmental drift and Frenzy pulsing/rotation without hiding Apex, Frenzy, depth, health, score, cooldown, result, reconnect or navigation state.

The WebGL surface is described as a 3D gameplay view using the player's current key bindings. Meaningful competitive state remains outside WebGL in the semantic DOM HUD, leaderboard, dialogs, live regions, captions, projected labels and depth radar. Hiding the visual radar keeps its semantic content available.

Gameplay-relevant captions are produced independently of whether Web Audio can play, while respecting spatial range and bounded repeat cadence. Screen-reader announcements remain separate and event-bounded so a full room does not announce every actor update.

## Browser and device acceptance

The repository does not currently include a real-browser automation harness such as Playwright, Puppeteer or WebDriver. Static/source contracts and deterministic unit tests therefore do not prove browser, physical-device or assistive-technology behavior by themselves.

The reproducible cross-mode procedure is in [PRODUCT-ACCEPTANCE.md](PRODUCT-ACCEPTANCE.md). Product acceptance must still exercise real Tab and Shift+Tab traversal; focus restoration after pause/settings/help/result/death transitions; Escape handling in dialogs; VoiceOver/TalkBack/desktop screen readers; 200 percent and higher zoom/reflow; physical safe-area cutouts; portrait-to-landscape rotation; simultaneous dual-stick plus ability pointers on hardware; computed contrast in the running browser; real WebGL rendering; and caption readability over representative 3D scenes.

Any failure in those checks is a product defect; the automated proof does not waive it.

## Preserved boundaries

The production renderer is React Three Fiber/WebGL only and gameplay is full X/Y/Z. There is no Canvas2D or planar accessibility fallback. Desktop jet-style flight, mobile dual-stick input, depth-aware non-color cues, semantic DOM equivalents, reduced motion, captions, spatial underwater audio, Apex, Feeding Frenzy, directional bite + burst combat, scoring, prey and movement all consume the same authoritative state.

Local prediction and remote interpolation are presentation paths only. Accessibility and performance settings cannot remove authoritative actors or competitive cues. Room schema 11, realtime protocol 11 and package version 2.0.0 remain current.
