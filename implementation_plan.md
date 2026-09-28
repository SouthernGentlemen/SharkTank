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
- **Shark-centric combat.** Contact alone must not remain the primary kill mechanic. The full-3D combat target is directional bite + burst movement + size advantage. The existing rocket mechanic is temporary compatibility and is retired when the 3D combat task lands unless the owner changes direction before then.
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

### ST-115 — [FEAT] Add third-person shark swimming and chase-camera handling

**Goal**

Make movement feel like controlling an animal through water rather than moving a cursor token on a plane.

**Scope**

- Add camera-relative yaw/pitch steering with configurable turn and pitch rates.
- Clamp extreme pitch so players cannot flip into disorienting singularities.
- Add acceleration/deceleration and turn smoothing without making input feel delayed.
- Derive visual roll/bank from yaw rate and smoothly return toward neutral.
- Add chase-camera spring, look-ahead and distance behavior based on shark size/speed.
- Keep camera collision/simple environment avoidance bounded; do not build a general physics system.
- Implement reduced-motion behavior that lowers camera spring, bank, shake and aggressive FOV changes without removing 3D gameplay information.
- Tune spawn orientation to face into useful water volume rather than walls/surface/floor.

**Non-goals**

- No final touch controls in this task.
- No bite/combat rewrite.
- No final environment art.

**Acceptance**

- Full pitch/yaw traversal is possible in a local deterministic tank.
- Camera remains behind/readable through dives, climbs and hard turns.
- A player can always tell forward direction.
- Reduced motion remains fully playable.

---

### ST-116 — [FEAT] Rebuild desktop controls for full-3D play

**Goal**

Make desktop control like flying a jet through water, using two keyboard directional clusters that map one-for-one to the two mobile sticks.

**Owner-default desktop map**

- `W` — pitch up / climb.
- `S` — pitch down / dive.
- `A` — yaw left.
- `D` — yaw right.
- `Arrow Up` / `Arrow Down` — look camera up/down around the shark.
- `Arrow Left` / `Arrow Right` — look camera left/right around the shark.
- Bite and burst use separate remappable action keys; choose defaults during implementation that do not conflict with the two directional clusters.
- The shark maintains forward swim; burst temporarily increases forward speed. Visual roll/bank follows yaw rate rather than consuming another key axis.

**Scope**

- Implement the WASD flight stick as the authoritative player pitch/yaw intent source.
- Implement arrow keys as an independent chase-camera look stick with bounded yaw/pitch offsets and smooth recenter when released.
- Keep mouse look optional as a mirror for the camera-look stick, never as a requirement for steering or full gameplay.
- Keep keyboard-only play complete: climb, dive, turn, look, bite, burst, pause, respawn and exit must all be possible without a pointer.
- Preserve remappable keybind infrastructure and extend it for pitch/look/action controls without blank or conflicting bindings.
- Prevent menus/forms/dialogs from leaking gameplay input and clear held-key state on blur/visibility/focus transitions.
- Keep the existing single-key-shortcut accessibility switch effective.
- Update help text and control captions to describe the jet-like control model.

**Non-goals**

- No gamepad requirement.
- No mobile implementation yet.
- No combat semantics change beyond wiring placeholder actions.

**Acceptance**

- WASD alone can continuously fly the shark through yaw + pitch in full 3D while forward swim remains coherent.
- Arrow keys can look around the shark independently without changing authoritative swim direction.
- Mouse is optional, not required for full play.
- Opening any dialog releases active steering/look/ability state.
- Focus transitions do not leave the shark stuck turning, pitching, looking or bursting.

---

### ST-117 — [FEAT] Add dual-stick mobile pitch/yaw controls

**Goal**

Make mobile a first-class 3D control surface with two simultaneous analog inputs rather than adapting the old one-stick planar control.

**Owner-default layout**

- Left floating analog stick is the exact WASD equivalent: stick up/down drives shark pitch up/down and stick left/right drives shark yaw left/right.
- Right floating analog stick is the exact arrow-key equivalent: stick up/down/left/right controls bounded chase-camera look offsets around the shark without changing authoritative swim direction.
- The shark continuously swims forward like a jet through water; left-stick yaw produces visual banking and left-stick pitch controls climb/dive.
- Releasing the right stick smoothly recenters the chase camera behind the shark rather than snapping.
- Bite and burst use separate touch buttons positioned outside the stick travel circles, and the input system must allow ability touches while both stick pointers remain captured.
- Handedness swaps the complete twin-stick/action layout, not just one stick.

**Scope**

- Track independent pointer IDs for left and right sticks and support both at the same time.
- Use pointer capture defensively so fingers may leave their original zones without dropping control.
- Give both sticks dead zones, radial normalization and bounded response curves.
- Smooth camera recenter after the look stick releases.
- Prevent touch gestures from scrolling/zooming the page while actively playing without breaking ordinary page accessibility outside the game.
- Respect `env(safe-area-inset-*)`, browser chrome, orientation changes and coarse-pointer detection.
- Ensure ability pads can be pressed while either/both sticks remain held.
- Preserve forced on/off/auto touch-control settings.
- Add left-handed layout support.
- Add a landscape gameplay layout and an explicit portrait policy. If portrait cannot maintain safe dual-stick geometry, show a clear rotate-to-landscape affordance instead of rendering unusable controls.

**Non-goals**

- No decorative mobile redesign.
- No native-app-only APIs.
- No requirement for haptics, though later tasks may add them opportunistically.

**Acceptance**

- Automated control math tests cover two simultaneous pointers, cancellation, orientation change, safe-area layout and handedness.
- A player can continuously yaw/pitch with the left stick, look independently with the right stick, and activate an ability without either stick pointer being cancelled.
- No touch path falls back to mouse-click semantics from the old Canvas2D game.

---

### ST-118 — [FEAT] Build the stylized ocean arena

**Goal**

Replace the empty/grid-like arena presentation with a readable underwater world that gives motion and depth strong visual reference.

**Scope**

- Add a visible water surface and seabed defining the gameplay volume.
- Add depth fog/haze and color attenuation appropriate to the quality preset.
- Add lightweight caustic/light-shaft treatment.
- Add suspended particulate and bubbles with quality-scaled density.
- Add a readable outer play boundary that is obvious before the player crosses it.
- Add large navigation landmarks: reef/rock formations, a wreck or equivalent focal structure, and central Feeding Frenzy landmark/feeding zone.
- Keep competitive collision simple. Decorative geometry must not imply collision where none exists.
- Use local assets with license/provenance recorded in repository history.
- Keep the ocean stylized, saturated and readable; photorealism is not a requirement.

**Non-goals**

- No procedural open world.
- No terrain destruction.
- No general rigid-body physics.
- No remote asset CDN.

**Acceptance**

- A stationary screenshot from several depths unmistakably reads as an ocean environment.
- Players can judge climb/dive motion from world cues even with particles reduced.
- Low quality retains surface/floor/boundary/landmark readability.

---

### ST-119 — [FEAT] Replace primitive actors with animated shark models

**Goal**

Make every player/rival visibly read as a shark with a strong silhouette and responsive animation.

**Scope**

- Add one optimized local shark mesh/GLB pipeline with an appropriate license/provenance record.
- Support skin palette/material variation without duplicating whole model payloads.
- Add animation states for cruise, hard turn/bank, burst, bite, hit/death and spawn where the asset supports them.
- If the chosen asset does not contain every clip, layer procedural fin/tail/body motion rather than blocking the task on a huge animation library.
- Scale model presence with gameplay size while keeping hit geometry owned by the engine, not by arbitrary mesh triangles.
- Keep name/colorblind labels projected from the actual head/actor position.
- Keep meshes/animations out of server-safe imports.

**Non-goals**

- No character creator.
- No species roster yet.
- No realistic gore.

**Acceptance**

- Direction, pitch and speed are visually legible from shark pose.
- Skin colors remain distinguishable against the ocean at supported quality levels.
- The actor remains performant at the full 32-shark tank target.

---

### ST-120 — [FEAT] Replace abstract pellets with authoritative fish and prey schools

**Goal**

Turn "eat dots to grow" into "hunt fish to grow" without giving the client authority over score.

**Scope**

- Introduce score-relevant prey entities with X/Y/Z position, compact type/value/radius data and deterministic movement.
- Start with a small gameplay taxonomy such as bait fish, richer fish and large frenzy chum/prey rather than dozens of species.
- Give prey deterministic schooling/flee behavior that reacts to nearby sharks without requiring heavyweight pathfinding.
- Make prey consumption server-authoritative and retain bounded spawn counts.
- Render prey efficiently through instancing/batching and simple animation.
- Distinguish authoritative prey from client-only distant decorative schools so decorative actors can never affect score.
- Convert shark-death food drops into a shark-appropriate prey/chum/carcass presentation instead of glowing dots.
- Update bot food-seeking logic only enough to understand the new prey representation; full 3D bot behavior is the next task.

**Non-goals**

- No ecosystem simulation.
- No breeding/hunger economy.
- No persistence of individual fish across empty-room shutdowns beyond existing snapshot semantics.

**Acceptance**

- The arena contains recognizable moving fish at multiple depths.
- Eating a fish visibly and audibly maps to one authoritative score/growth event.
- Full-room prey count stays within measured CPU/network/render budgets.

---

### ST-121 — [FEAT] Teach bots to hunt and evade in full 3D

**Goal**

Make always-on rivals exercise the same volumetric rules as human players so lightly populated rooms remain useful and fun.

**Scope**

- Update bot steering to choose full 3D target directions.
- Make bots avoid surface/floor/outer boundary.
- Make bots seek prey schools, react to Feeding Frenzy targets and use burst movement through the same authoritative action semantics.
- Add simple threat logic: smaller bots may evade nearby apex sharks; larger bots may pursue vulnerable rivals.
- Keep bots deterministic from room state and RNG.
- Do not give bots information unavailable to the server simulation or impossible turning/pitch rates.
- Keep bot CPU bounded at the existing target population.

**Non-goals**

- No machine-learning agent.
- No perfect aim.
- No bot-only combat rules.

**Acceptance**

- Bots use the water column rather than collapsing back onto one Y plane.
- Seeded bot simulations remain deterministic.
- A full bot-populated room stays within a measured server-tick budget.

---

### ST-122 — [FEAT] Replace contact kills and rockets with shark combat

**Goal**

Make fighting another player an intentional 3D interaction built around sharks rather than center-point overlap and ranged rockets.

**Owner default**

The full-3D core kit is **bite + burst swim + size/position advantage**. Retire rockets in this task unless the owner explicitly changes that direction before implementation.

**Scope**

- Add a directional bite action with server-authoritative cooldown, forward cone/range and hit resolution.
- Add shark health or an equivalently explicit damage model so equal-size contact is not an arbitrary instant kill.
- Scale bite effectiveness modestly with shark size while capping snowball behavior.
- Make burst movement a mobility/engagement tool; if burst modifies bite impact, encode that rule explicitly and test it.
- Remove "larger center touches smaller center => kill" as the primary combat resolution.
- Keep physical overlap readable with separation/deflection where needed.
- Remove rockets/projectiles, their cooldowns, renderer, input and protocol fields when the bite path fully replaces them.
- Make deaths identify the killer/attack when known so the death overlay and audit events are meaningful.
- Preserve spawn protection in a form appropriate to bite combat.
- Retune death drops/growth so a kill is rewarding without making one early kill decide the whole round.

**Non-goals**

- No weapon inventory.
- No ranged combat replacement.
- No complex status-effect system.

**Acceptance**

- A player can explain why they died from visible attacker/action feedback.
- Collision without a bite does not arbitrarily delete an equal/smaller shark.
- Bigger sharks have an advantage but are not immune to positioning mistakes.
- All combat outcomes remain authoritative and replayable.

---

### ST-123 — [FEAT] Turn Feeding Frenzy into a 3D server-wide event

**Goal**

Make the existing deterministic event the signature convergence moment of each arena.

**Scope**

- Spawn frenzy prey/chum throughout a defined 3D central volume rather than a flat center disc.
- Make the feeding landmark/environment visibly activate.
- Give all clients an unmistakable visual, audio and captioned start/end cue.
- Make frenzy affect movement/cooldowns/prey value only through documented authoritative rules.
- Make bots converge intelligently through depth.
- Keep event timing deterministic from round/tick state.
- Reduce effects appropriately for reduced-motion and low-quality settings without hiding event state.

**Non-goals**

- No random client-only event schedule.
- No loot boxes or progression economy.

**Acceptance**

- Joining mid-frenzy yields the correct remaining time and world state.
- Every participant converges on the same authoritative 3D event.
- The event is understandable with sound off and with reduced motion enabled.

---

### ST-124 — [FEAT] Add round structure and an Apex climax

**Goal**

Give the game a beginning, escalation, climax, result and replay loop instead of one endless room lifetime.

**Owner-default round shape**

Use a roughly 5-minute active round as the first tuning target, followed by a short result/reset window. Exact constants may be tuned from tests but must stay deterministic and server-owned.

**Scope**

- Add explicit round state, round number, start/end ticks and result state to the authoritative room.
- Reset competitive gameplay cleanly between rounds without recreating the Durable Object or losing operational metadata.
- Define the winner from a documented score/rank rule.
- Give the current leader a readable Apex marker/identity in the 3D world and DOM leaderboard.
- Increase pressure toward the end of the round through a deterministic final frenzy/event rather than an arbitrary client animation.
- Add result presentation and one-action return into the next round.
- Preserve personal best/profile semantics and update them only from authoritative results.
- Ensure reconnect/late-join behavior explains the current round state immediately.

**Non-goals**

- No account-based ranked matchmaking.
- No seasonal ladder.
- No paid progression.

**Acceptance**

- A complete deterministic test can simulate start -> active play -> climax -> result -> next round.
- Joining at any phase yields correct state.
- Room persistence and operational evidence survive round resets.

---

### ST-125 — [FEAT] Build spatial underwater game audio

**Goal**

Make movement, prey and combat feel physical without sacrificing captions or user control.

**Scope**

- Replace the minimal synth-only presentation where useful with local, license-safe audio assets and/or improved synthesis.
- Add underwater ambience, swim/burst rush, bite impact, prey consumption, hit/death, frenzy and round-result cues.
- Spatialize nearby world cues where Web Audio makes that reliable; keep critical state cues understandable without spatial audio.
- Preserve user-gesture audio start, volume controls, background-tab suspension and cleanup.
- Expand captions for every gameplay-relevant sound cue.
- Keep music opt-in unless the owner changes the current default.

**Non-goals**

- No voice chat.
- No licensed commercial soundtrack.
- No critical gameplay information that exists only in audio.

**Acceptance**

- Combat and prey interactions have distinct readable sound signatures.
- Captions cover the same gameplay-relevant events.
- Audio stops/suspends correctly on lifecycle transitions.

---

### ST-126 — [A11Y] Replace planar navigation UI with depth-aware competitive cues

**Goal**

Remove UI assumptions that only make sense in a top-down plane and make 3D threats/objectives readable.

**Scope**

- Audit the existing minimap, labels, leaderboard, ability rail and frenzy banner against the full-3D game.
- Replace the planar minimap with a depth-aware radar/compass or remove it if the 3D world and threat cues make it unnecessary.
- Add lightweight above/below indication for off-camera nearby threats/prey where needed.
- Make the Apex player discoverable without permanent screen clutter.
- Keep labels bounded/occlusion-aware enough that a full tank does not become a wall of names.
- Tune desktop and mobile HUD density independently while sharing the same information hierarchy.
- Preserve semantic DOM equivalents for critical information.

**Non-goals**

- No diegetic-only HUD requirement.
- No giant cockpit UI.

**Acceptance**

- Players can locate important threats/objectives in depth without a top-down coordinate mental model.
- Mobile HUD does not overlap either touch stick or ability controls.
- Critical cues remain accessible outside WebGL.

---

### ST-127 — [PERF] Harden the 3D client for desktop and mobile frame budgets

**Goal**

Prove the new scene can carry the target actor counts before polish expands further.

**Scope**

- Measure draw calls, geometry/material count, render DPR and representative frame cost.
- Instance/batch fish, bubbles, particles and repeated props.
- Add actor/environment LOD only where measurements justify it.
- Bound shadow use and disable/reduce it by quality preset as needed.
- Tune fog, caustics, particles, decorative schools and post-like effects by graphics quality.
- Add adaptive or capped DPR behavior appropriate to mobile.
- Avoid allocating transient vectors/objects inside hot `useFrame` loops where practical.
- Keep socket and simulation work independent from render FPS.
- Add a low-quality path that is still the same 3D game, never a Canvas2D fallback.

**Performance targets**

- Desktop target: 60 FPS under a representative populated scene.
- Mobile target: stable 30 FPS minimum on the low preset with controls remaining responsive; higher presets may target 60 on capable devices.
- Server target: the full deterministic room remains within the existing tick cadence without runaway bot/prey cost.
- Network target: representative snapshot payload and messages/second remain explicitly measured and bounded.

**Acceptance**

- Performance tests/bench fixtures capture actor counts and payload sizes.
- Quality changes affect presentation cost, not authoritative world truth.
- No 2D renderer is restored as a performance escape hatch.

---

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
