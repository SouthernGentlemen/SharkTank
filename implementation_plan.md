# Implementation plan

## Owner direction — full-3D SharkTank acceptance and release

The full-3D rebuild is now the current product baseline. This queue is current/future work only: validate the finished product across real quality/control modes, then release it through the existing governed path.

### Current product baseline

- React Three Fiber / Three.js is the only gameplay renderer; there is no hidden Canvas2D gameplay fallback.
- Competitive state is full X/Y/Z with authoritative yaw + pitch; roll/banking is presentation-only.
- The Room Durable Object owns movement, scoring, combat, prey, Feeding Frenzy, Apex, rounds, results, resets and replayable state.
- Deterministic engine/protocol/store code remains server-safe and framework-agnostic.
- Room schema 11 and realtime protocol 11 are current.
- Desktop uses W/S pitch, A/D yaw and arrow-key camera look, with optional mouse-look mirroring.
- Mobile uses independent dual-stick flight/look plus simultaneous bite/burst ability pointers.
- Score-relevant fish/prey are authoritative gameplay actors.
- Shark combat is directional bite + burst; ordinary body overlap is non-lethal separation/deflection.
- Local prediction and remote interpolation are presentation paths only and do not move authority client-side.
- Accessibility remains DOM-first around the WebGL gameplay surface.
- Quality scaling may reduce presentation cost but may not remove authoritative actors or competitive cues.
- Durable Object names, migration tag `v1`, bindings, protected environments and release/deploy guards remain unchanged unless an explicit queued task requires otherwise.
- Production remains on the accepted `v2.0.0` release until the queued release task completes.

Work only the first open task, preserve the order of later tasks unless the owner explicitly changes it, and keep every task independently green on `main`.

## Open tasks




### ST-132 — [OPS] Release the full-3D SharkTank experience

**Goal**

Publish the accepted rebuild through the existing governed release path.

**Owner-default release identity**

Use **`v3.0.0`** unless fresh authority at execution time provides a different owner-approved release version. The major version reflects the deliberately breaking gameplay/protocol transition from the v2 planar MVP to the full-3D product.

**Scope**

- Advance `package.json` and root `package-lock.json` together to the accepted release version.
- Remove ST-132 from this queue and restore the permanent empty-queue template if no owner-directed tasks remain.
- Let merged-main CI trigger the existing Release Tag workflow.
- Require one annotated immutable release tag on the exact accepted main commit.
- Require the existing Release workflow to verify identity and publish the matching GitHub Release.
- Allow production deployment only through the existing protected release/deployment path and only if its current guard permits it.
- After deployment, verify the public MVP surface and specifically verify that `/play/` serves the new full-3D build/assets.
- Do not bypass a protected-environment approval or weaken any deployment/release guard.

**Non-goals**

- No DNS change.
- No secret change.
- No Durable Object rename.
- No migration-tag rewrite.
- No emergency alternate deployment path.

**Acceptance**

- Tag, package, GitHub Release, accepted main commit and deployed release identity agree exactly.
- Existing public overview/evidence/admin boundaries remain correct.
- The deployed game is the R3F-only full-3D experience with no production Canvas2D fallback.
