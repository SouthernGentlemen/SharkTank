# Implementation plan

## Owner direction — full-3D SharkTank rebuild

SharkTank is moving from a planar `.io`-style game with a Canvas2D production renderer into one full volumetric React Three Fiber experience.

This queue is the owner's direction for the rebuild. Work only the first open task, preserve the order of later tasks unless the owner explicitly changes it, and keep every task independently green on `main`.

### Product outcome

The finished `/play/` experience must be:

- one React Three Fiber / Three.js gameplay renderer with no Canvas2D gameplay fallback;
- a true X/Y/Z underwater world rather than a flat X/Z arena rendered with 3D primitives;
- third-person shark swimming with authoritative yaw + pitch, visual banking/roll, chase-camera motion and real depth;
- fully playable on phones and tablets with simultaneous dual analog touch controls;
- fully playable with mouse + keyboard and keyboard-only controls;
- populated by recognizable sharks, gameplay fish/prey and a stylized ocean environment;
- realtime multiplayer with the Room Durable Object remaining authoritative over movement, scoring, combat, prey, rounds and replayable state;
- readable and responsive enough for competitive play before visual spectacle is added;
- accessible through the existing DOM HUD/settings/announcements/captions layer rather than trying to render all UI inside WebGL;
- performant enough to target 60 FPS on normal desktop hardware and a stable 30-60 FPS quality-scaled mobile experience.

### Current baseline being replaced

The present production game mounts `GameCanvas.tsx`, which renders through `CanvasRenderingContext2D`. The repository also contains an R3F `Scene.tsx`, but that scene is not the production gameplay surface and is still mechanically planar: state uses `{ x, z }`, shark/food collision is 2D, orientation is a single heading angle, and the scene places actors near a constant Y plane.

That split is temporary technical debt. The rebuild ends with one gameplay renderer and one 3D gameplay model.

### Rebuild rules

- **No permanent dual renderer.** Once R3F reaches current-playability parity, delete the Canvas2D gameplay path, sprite renderer and 2D-only drawing helpers. Do not maintain a hidden fallback game.
- **DOM remains DOM.** Menus, HUD, leaderboard, dialogs, settings, captions, focus management and screen-reader output remain React/HTML unless a concrete gameplay reason requires otherwise.
- **Server authority stays intact.** The client may predict and interpolate, but cannot author score, damage, prey consumption, kills, round state or authoritative movement.
- **Three.js does not enter the Worker bundle.** Engine/protocol/store code must remain server-safe and framework-agnostic.
- **Use full X/Y/Z state.** Three's Y axis is vertical; X/Z remain the horizontal plane. "Full 3D" means gameplay state, collision, prey, projectiles/abilities, spawning and camera targets all carry depth, not merely visual Y offsets.
- **Keep orientation compact.** Authoritative shark steering uses yaw + pitch (or an equivalent normalized forward vector derived from them). Roll is visual banking driven by turn rate unless a later task proves roll must become gameplay state.
- **Mobile is first-class, not a later port.** Touch input must support two simultaneous pointer captures, safe-area insets, orientation changes and coarse-pointer devices from the first 3D-control task onward.
- **One control model across mobile and desktop.** The two mobile sticks map directly to the two desktop directional clusters so players learn one mental model instead of separate touch and keyboard games.
- **Owner-default primary flight control:** the shark constantly swims forward like an aircraft through water. Left mobile stick is the WASD-equivalent flight stick: up/down pitches the shark to climb/dive and left/right yaws the shark. The shark visually banks into yaw; roll is not a separate authoritative input.
- **Owner-default camera/look control:** right mobile stick is the arrow-key-equivalent look stick: up/down/left/right offsets the third-person chase camera around the shark for situational awareness and aiming. Releasing it smoothly recenters behind the shark.
- **Desktop default:** W/S pitch up/down, A/D yaw left/right; Arrow Up/Down/Left/Right control the same chase-camera look offsets as the right mobile stick. This is the primary desktop scheme: keyboard-driven, jet-like flight through 3D water. Mouse look may be an optional mirror for the arrow-key look axis, but it must not be required to steer, climb, dive or fight.
- **Abilities:** bite and burst remain separate actions from the two directional sticks/clusters and must be reachable without changing the primary pitch/yaw model. Mobile must support additional simultaneous ability pointers while both sticks are active.
- **Shark-centric combat.** Directional bite + burst movement + bounded size advantage is the authoritative combat model. Contact is non-lethal separation/deflection, and ranged weapons are not part of the core kit.
- **Fish are gameplay, not decoration.** Score-relevant prey is authoritative. Decorative distant schools/particles may be client-only only when they cannot affect score, collision or competitive information.
- **Ocean, not empty space.** The final world needs a water surface, seabed, depth fog, caustic/light treatment, suspended particulate/bubbles, readable boundaries and landmarks such as reef/rock/wreck structures. The world remains stylized and performant rather than photorealistic.
- **Assets ship locally.** No runtime hotlinking of models/textures/audio. Add only first-party or license-compatible assets with provenance that is safe for this MIT repository.
- **Avoid dependency sprawl.** Keep React 19, R3F 9 and Three as the rendering baseline. Add a rendering/asset dependency only when a queued task demonstrates that the platform primitives are insufficient.
- **Do not change stateful Cloudflare identity casually.** Keep Durable Object class names, migration tag `v1`, namespace bindings, R2 bindings, domain/DNS, secrets, protected environments and deployment guards unchanged unless a specific queued task explicitly requires otherwise.
- **Safe state evolution is mandatory.** A gameplay schema bump may reset transient room simulation when necessary, but must preserve the Room/Lobby Durable Object identities and operational metadata. Existing stored snapshots and replay logs must never be misread as the new schema.
- **No intermediate release by default.** Rebuild tasks may merge to `main` with the package version unchanged. Production stays on the accepted `v2.0.0` release until the final release task, unless the owner explicitly queues an earlier release.
- **Every task must leave `main` buildable and testable.** Temporary compatibility adapters are allowed only when they are bounded to a later removal task already in this queue.

### Experience targets

The target play loop is:

1. Enter an ocean arena and immediately understand where the shark is facing.
2. Fly the shark through the water with jet-like pitch/yaw controls and a chase camera that can look independently.
3. Hunt visible fish/prey to grow.
4. Read nearby rivals by silhouette, size, motion and name/skin cues.
5. Position above/below/behind another shark.
6. Burst to close or escape.
7. Land a directional bite instead of winning because two centers overlapped.
8. Grow from agile scavenger toward an obvious apex threat.
9. Converge on server-wide Feeding Frenzy events.
10. Reach a clear round climax/result and immediately have a reason to play again.

### Performance and network budgets

These are acceptance targets, not permission to fake authority:

- retain the current 32-shark tank target unless measurement proves a smaller cap is required;
- keep score-relevant simulation deterministic and replayable;
- prefer compact yaw/pitch/position fields over shipping render-only transforms;
- keep high-frequency socket payloads bounded and measured after 3D coordinates are added;
- use interpolation for remote actors and prediction/reconciliation for the local actor;
- use instancing or equivalent batching for repeated fish, bubbles, particles and environmental props;
- avoid React state updates per render frame;
- quality presets may reduce shadows, particles, water detail, model LOD, render DPR and decorative schools, but may not remove authoritative actors or competitive cues;
- mobile layout must respect display cutouts/safe areas and remain playable in landscape; portrait may present a rotate affordance if the gameplay viewport cannot meet minimum control spacing.

## Open tasks


### ST-128 — [A11Y] Re-prove accessibility after the full-3D control and renderer change

**Goal**

Keep SharkTank unusually accessible for a realtime 3D browser game instead of losing existing guarantees during the rewrite.

**Scope**

- Re-audit keyboard-only gameplay through the WASD flight stick, arrow-key look stick, bite, burst, pause, respawn and exit.
- Re-audit focus handling across menu/tank/game/death/settings/help transitions.
- Re-audit reduced motion across camera follow, banking, shake, particles and frenzy.
- Preserve high-contrast/colorblind identification that does not rely on hue alone.
- Keep live announcements bounded so 32 actors do not spam assistive technology.
- Ensure captions cover gameplay-relevant spatial audio.
- Keep touch targets and control spacing appropriate on supported mobile layouts.
- Ensure the WebGL canvas has an accurate accessible description while meaningful state stays available through DOM summaries.

**Non-goals**

- No claim that a visual 3D action game can be made equivalent to a text game.
- No removal of competitive visual cues solely to simplify audits.

**Acceptance**

- Existing accessibility tests are updated rather than deleted.
- Keyboard-only path can complete a full round loop.
- Reduced-motion mode retains complete gameplay state and control.

---

### ST-129 — [TEST] Prove 3D authority, replay, reconnect and mobile input end to end

**Goal**

Create the acceptance wall for the new game before old compatibility code and documentation are finalized.

**Scope**

- Add deterministic engine cases for 3D movement, boundary handling, prey, bite combat, frenzy and round reset.
- Prove replay reproduces 3D world state for the supported log generation.
- Prove WebSocket validation rejects malformed 3D input.
- Prove local prediction/reconciliation math against authoritative movement fixtures.
- Prove stale-client/protocol mismatch behavior if version negotiation exists.
- Prove reconnect, death, respawn, late join and round transition flows.
- Add mobile multi-pointer control cases for simultaneous sticks + ability.
- Add R3F/client smoke coverage appropriate to the current test environment without pretending jsdom renders WebGL.
- Keep `npm run check` the canonical credential-free gate.

**Acceptance**

- Every core gameplay state transition has deterministic server-side coverage.
- Replay and reconnect are not weaker than they were in the planar game.
- The build has no hidden dependency on the deleted Canvas2D renderer.

---

### ST-130 — [DOCS] Consolidate the repository around the full-3D architecture

**Goal**

Make current documentation describe the game that actually exists and remove 2D-era residue once the implementation is accepted.

**Scope**

- Update README and architecture documentation to describe the R3F-only gameplay boundary, 3D authority, controls, fish/prey, combat, rounds and performance model.
- Update comments/module documentation that still describe snake.io, planar headings, one-stick touch or Canvas2D rendering.
- Remove dead exports/files/tests left only for the old renderer/protocol.
- Keep provenance/history CSVs as provenance inputs; do not turn docs into a changelog.
- Keep operator/evidence/release documentation current and concise.

**Non-goals**

- No new governance framework.
- No release yet.
- No retrospective history dump into current-state docs.

**Acceptance**

- Repository search finds no reachable 2D gameplay renderer or stale instructions claiming the game is planar.
- The documented command map and architecture match the built code.

---

### ST-131 — [TEST] Run full-3D product acceptance across quality and control modes

**Goal**

Treat the finished game as a product, not merely a passing unit-test suite.

**Scope**

- Exercise menu -> tank -> game -> round -> death/respawn -> result -> next round.
- Exercise the shared control model across desktop WASD + arrow keys, optional mouse-look mirroring, and mobile dual-stick control paths.
- Exercise low/medium/high graphics presets.
- Exercise reduced motion, high contrast, captions and colorblind labels.
- Exercise representative full-room bots/prey and sustained frenzy.
- Verify public MVP support surfaces remain unaffected: `/`, `/evidence/`, authenticated `/admin/`, game API and WebSocket boundary.
- Verify no changes to release/deploy guards, Durable Object names, migration tag `v1`, bindings or provider policy were smuggled into the gameplay wave.

**Acceptance**

- All acceptance evidence is reproducible from repository commands/tests plus the documented browser/manual checks that cannot be automated credibly.
- Any discovered blocker becomes a narrowly scoped queued fix before release; do not waive it by weakening tests.

---

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
