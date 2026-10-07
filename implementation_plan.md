# Implementation plan

## Owner direction — one lean, bigger, smoother and fun SharkTank

The owner played production `v2.0.0-r1` and found it chunky, hard to play and not fun. The direction for this wave:

- **One tank** of 8 players and 24 bots, entered straight from Play.
- **A bigger ocean** with coral reefs and many more kinds of fish.
- **Smooth motion, forgiving controls and generous hit boxes**, mobile first.
- **Better music**, a clean mobile UI and smoother animation.
- **Minimal overhead and no telemetry.** The server is already reduced to the game surface; remaining dead code is removed as the queue advances.

The queue comes from two code deep dives plus live production measurements taken on 2026-10-02. The permanent empty-queue rule that authorized this plan-only refill states: `The queue is empty. Select no implementation task.` That sentence describes the pre-change state only. Work only the first open task. Keep later tasks and their order unless the owner changes priority. Each task is sized for about ten minutes of focused implementation; CI, review, merge and release approval are extra.

### What the deep dives found

- **Dead code remains outside the active game path.**
  - The Camera motion setting is read by nothing.
- **Remote motion freezes most of the time.** Snapshots arrive at 10.1 Hz (median gap 99.4 ms) but the interpolation delay is 45 ms. Replaying measured arrivals through the client's rule leaves remote sharks and fish frozen on about 72% of 60 Hz frames, and the clock drifts (+0.7 ms/s) with no correction. Swim animation follows the same stalled clock.
- **The wire is heavy for phones.** About 30 KB of JSON per snapshot carries every prey in the tank: about 295 KB/s, roughly 1 GB per hour.
- **Controls fight the player.**
  - Pitch has no auto-level in a 24-unit water column, and pitch is snapped to zero at the surface and seabed.
  - Overlapping sharks get their headings snapped instantly.
  - The wall kills on contact.
  - Dash waits a round trip, and steering is sent at most 10 Hz with coarse deadbands.
- **Hit boxes are stingy.** Eating measures from the body centre with a fixed 1.2 radius while the snout reaches about 2.6 × scale ahead. Bites need centre-to-centre within 3.4 in a 50° cone, every kill needs three or more bites, and health never regenerates.
- **The ocean is small and samey.** Radius 82 and a 24-unit column, defined in five separate places. There are only two fish looks. The three "reef" rock clusters and the wreck sit outside the wall where nobody can reach them.
- **The mobile UI buries the game.**
  - Dash, Bite and the gear sit on top of the leaderboard, out of thumb reach.
  - Five HUD cards, a text radar, a two-line Frenzy banner and 136 px name pills leave about a third of the screen clear.
  - Portrait shows no controls at all, because the portrait lock disables gameplay before its rotate prompt can render.
- **Audio and visuals are thin.** Music is a six-note `setInterval` loop, off by default, and SFX are single-oscillator chirps. Sharks are unlit spheres with three-sided cone fins.

### Product outcome

By the end of this queue a new player on a phone can:

1. tap Play and be swimming in the one tank within seconds, or see clearly that it is full;
2. steer with one thumb in landscape or portrait while pitch, camera and walls look after themselves;
3. see every shark and fish move smoothly over a light connection;
4. explore a bigger ocean of coral reefs full of distinct fish, from sardine schools to tuna, rays, squid and a rare golden fish;
5. eat whatever their mouth visibly touches, grow through five obvious tiers in one round, and settle a fight in one or two bites;
6. hear an underwater score that rises with Frenzy, Apex and danger;
7. read the HUD in one glance, with most of the screen left for the ocean.

On the server, the Worker serves only the game shell, its assets, `/version.json` and the tank WebSocket. The Room runs entirely in memory.

### Rules for this wave

- **Server authority does not move.** The Room owns movement, eating, damage, score, growth, prey and rounds. Client assists (auto-level, aim assist, Simple steering, bite buffering) only shape the player's own intent.
- **Minimal overhead.**
  - No telemetry, analytics, audit logs, usage metering or persisted game state.
  - After ST-149 the only Durable Object is `Room`.
  - Nothing new may add a server write, a log stream or a tracking request.
- **One protocol change.** Protocol 12 is current. Its prey species table covers every planned species, so later fish tasks need no protocol change. With nothing persisted after ST-144, there is no stored schema to migrate.
- **Determinism stays intact.** Engine rule changes stay seeded and testable, and update the determinism tests in the same task.
- **Docs and contract tests move with behavior.** README, ARCHITECTURE, ACCESSIBILITY and PRODUCT-ACCEPTANCE describe current behavior and are updated in the same commit as the change. A test is never deleted without replacing its behavior proof, unless the feature it covered is deleted too.
- **Removals are complete.** A task that removes a feature also removes its routes, styles, settings, copy, scripts, tests and docs in the same commit.
- **Accessibility stays DOM-first.**
  - New cues get a non-colour form and, when meaningful, a caption or bounded announcement.
  - Reduced motion disables shake, wobble, flashes, wakes, kelp sway and spine-wave amplitude without hiding competitive state.
  - Nothing flashes faster than three times per second.
- **Mobile budgets are respected.** No React state updates per frame. Repeated actors, coral and particles stay instanced and quality-bounded. Touch targets are at least 48 px and safe-area aware.
- **No new runtime dependencies.** React 19, React Three Fiber 9 and Three remain the stack. Audio is first-party Web Audio synthesis, and any visual asset is first-party and committed locally.
- **Releases happen only at the queued checkpoints** (ST-141, ST-224, ST-243, ST-259, ST-268, ST-281, ST-297). Before each, the owner runs the relevant PRODUCT-ACCEPTANCE manual rows on a real phone and a desktop browser, then approves the protected `production` environment.
- **Validation for every task** is the focused tests named in the task, plus `npm ci`, `npm run check`, `npm run audit:dependencies` and `git diff --check` on the exact head.

### Current defaults

Tasks follow these defaults unless the owner changes them before the task starts:

1. A bigger ocean: radius 120 (from 82), water column 36 (from 24) and about 480 ambient fish (from 200) (ST-260).
2. Fish and coral variety:
   - eight school looks (sardine, anchovy, silverside, clownfish, blue tang, yellow tang, angelfish, parrotfish);
   - new tuna, rays, squid and a rare golden fish;
   - brain, branching, plate, fan and tube coral plus kelp (ST-261–ST-267).
3. Touch play defaults to one-thumb **Simple** steering, with dual-stick as **Advanced**; desktop WASD flight with arrow-key look is unchanged. Portrait play is allowed (ST-250, ST-253).
4. The wall becomes a non-lethal current (ST-247).
5. Combat rules (ST-257):
   - a shark at least 1.5× the victim's length devours it in one bite;
   - even fights take two bites;
   - health regenerates at 4 HP/s.
6. Music is a first-party adaptive score, on by default at 35% once the first tap unlocks audio, with a visible mute (ST-275–ST-278).
7. Releases are semantic versions at each checkpoint: `v2.2.0`, `v2.3.0`, `v2.4.0`, `v2.5.0`, `v2.6.0`.
8. The release and change-control tooling (controlled commits, protected releases, GitHub settings checks) stays as it is for now.

### Tuning reference

| Knob | Today | Target | Task |
| --- | --- | --- | --- |
| Remote interpolation | 150 ms shared delay, rate estimation, bounded clock correction and ≤ 120 ms extrapolation | 1.5 × snapshot interval (150 ms), drift-locked, ≤ 120 ms extrapolation | ST-233–ST-235 |
| Snapshot weight | ≤ 14 KB typical per-session; ≤ 25 KB unfiltered stress fixture | ≤ 14 KB typical × 10 Hz | ST-241 |
| Steering send | ≤ 20 Hz, 0.015 rad deadband, trailing final send | 20 Hz, 0.015 rad, trailing final send | ST-237 |
| Pitch on release | Auto-levels at ~1.2 rad/s by default; optional held pitch | Auto-levels at ~1.2 rad/s | ST-244 |
| Surface and seabed | Shared proportional pitch limit over the final 3 units | Proportional glide band (3 units) | ST-245 |
| Shark overlap | Positional push, headings kept | Positional push, headings kept | ST-246 |
| Wall | Inward current over the final 4 units, clamped 0.5 units inside | Inward current from 4 units inside, no death | ST-247 |
| Eating | Body centre, radius 1.2 + prey r, 2 chomps/tick | Mouth, 1.2 + 0.55 × scale + prey r, swept, 4 chomps/tick | ST-255 |
| Biting | Centre-to-centre ≤ 3.4 (+0.8), 50° cone | Mouth to victim body surface ≤ 1.8 + 0.3 × scale, 65° cone | ST-256 |
| Damage | 34–42 per bite, ≥ 3 bites, no regen | Devour at ≥ 1.5× length; 50 (60 burst) even; 20 nibble; 4 HP/s regen | ST-257 |
| Ocean | Radius 82, column 24, ~200 fish | Radius 120, column 36, ~480 fish | ST-260 |
| Fish | 2 looks | 8 school looks + tuna, squid, rays, golden fish | ST-263–ST-267 |
| Coral | 3 rock clusters outside the wall | Reef sites of brain, branching, plate, fan and tube coral plus kelp | ST-261–ST-262 |
| Growth | +0.18 length per point; flat scale curve | Five tiers reachable in one round; Megalodon ≈ 2.5× spawn scale | ST-269 |
| Music | Six-note loop on `setInterval`, off by default | Layered adaptive score on the audio clock, on at 35% | ST-275–ST-278 |

## Open tasks

### ST-252 — [FEAT] Move Bite and Dash into the thumb arc with cooldown rings

**Goal:** On touch, the ability buttons sit over the leaderboard and out of reach.

**Scope**
- Place a round Bite button (at least 88 px) in the bottom corner opposite the flight stick, with Dash above and inside it; in Dual, place them above the look stick.
- Show cooldowns as radial rings with accessible labels.
- Accept presses during cooldown and buffer one bite pressed within 200 ms of expiry. The Room still enforces cooldown.

**Acceptance:** No overlap with the leaderboard or HUD at 740×360 and 844×390 (CSS contract); pointer ownership is unchanged; buffer tests pass.

**Validation:** `npm test -- tests/mobile-controls.test.ts tests/accessibility-contract.test.ts tests/shark-combat.test.ts`.

---

### ST-253 — [FEAT] Allow portrait play with a portrait control layout

**Goal:** Portrait currently shows no controls at all.

**Scope**
- Replace the portrait gate with a portrait layout: flight stick lower-left, Bite and Dash bottom-right, compact HUD.
- A pure framing helper widens the view for tall aspect ratios.
- Rewrite the `touchNeedsLandscape` tests and update docs.

**Acceptance:** Portrait is playable, and rotation still releases held input safely.

**Validation:** `npm test -- tests/mobile-controls.test.ts tests/full-3d-authority-acceptance.test.ts tests/full-3d-documentation-contract.test.ts tests/swimming-camera.test.ts`.

---

### ST-254 — [REFACTOR] Share one size curve and mouth and body geometry between engine and renderer

**Goal:** Hit boxes and visuals must agree on how big a shark is and where its mouth is.

**Scope**
- Move `sharkScaleForLength` into the engine.
- Add `mouthPoint`, about 1.9 × scale ahead of the position, and `bodySegment`, which runs from the snout tip (about 2.56 × scale ahead) to the tail (about 2.45 × scale behind).
- The renderer and camera import them. No rule changes yet.

**Acceptance:** Scale values are identical to today, and the engine imports no Three or DOM code.

**Validation:** `npm test -- tests/shark-models.test.ts tests/volumetric-engine.test.ts`.

---

### ST-255 — [FEAT] Eat from the mouth with a size-scaled, swept radius

**Goal:** Prey the snout visibly touches is not eaten, and dashes can pass fish between ticks.

**Scope:** Eat when prey is within `1.2 + 0.55 × scale` plus prey radius of the capsule from the previous tick's mouth position to the current one. Allow 4 chomps per tick for humans and 2 for bots.

**Acceptance:** Snout contact eats, prey beside the tail does not, and a dash through a line of bait eats every fish in the capsule (tests).

**Validation:** `npm test -- tests/prey-schools.test.ts tests/volumetric-engine.test.ts tests/determinism.test.ts`.

---

### ST-256 — [FEAT] Land bites anywhere on the victim's body with a wider cone

**Goal:** A bite that visibly lands on a tail misses.

**Scope**
- A bite lands when the mouth is within `1.8 + 0.3 × attacker scale` of the victim's body surface (closest point on `bodySegment`, minus 0.62 × victim scale).
- The target point must lie inside a 65° cone from the attacker's position, and the nearest valid victim wins.
- Bots use the same reach.

**Acceptance:** Tail and flank bites land; bites aimed away miss (tests).

**Validation:** `npm test -- tests/shark-combat.test.ts tests/bot-ai-3d.test.ts tests/determinism.test.ts`.

---

### ST-257 — [FEAT] Devour much smaller sharks in one bite and regenerate health

**Goal:** Every kill needs three or more bites and health never recovers.

**Scope**
- Damage:
  - an attacker at least 1.5× the victim's length devours it in one bite;
  - otherwise a bite deals 50 (60 with burst), so even fights take two bites;
  - a victim at least 1.5× the attacker takes 20.
- Rewards: score `max(5, round(victim score × 0.25))`, capped at 60; growth `victim length × 0.25`, clamped to 0.5–8.
- Living sharks regain 4 HP/s. The Apex bounty is unchanged.

**Acceptance:** Deterministic tests cover devour, two-bite, nibble, rewards and regeneration.

**Validation:** `npm test -- tests/shark-combat.test.ts tests/round-apex.test.ts tests/bot-ai-3d.test.ts tests/determinism.test.ts`.

---

### ST-258 — [FEAT] Mark which sharks you can eat and which can eat you

**Goal:** Make the size rule readable at a glance.

**Scope:** A pure `edibilityFor(me, other)` returns `prey`, `even` or `threat` using the 1.5× rule. Tint shark rims and name tags green, amber or red, and add a non-colour glyph (▼ eat, ■ even, ▲ danger) to tags and the radar text.

**Acceptance:** Helper tests pass; colour is never the only cue.

**Validation:** `npm test -- tests/depth-navigation.test.ts tests/accessibility-contract.test.ts`.

---

### ST-259 — [OPS] Release the controls and combat update as v2.3.0

**Goal:** Ship ST-244 through ST-258.

**Scope:** Semantic minor release after the owner records the manual rows: landscape and portrait, Simple and Dual, thumb-arc abilities, keyboard easing and the new combat.

**Acceptance:** `v2.3.0` is live. Protected approval is honored; stop and report if it is pending.

---

### ST-260 — [FEAT] Make the tank bigger with one shared ocean constant

**Goal:** The ocean is small, and its size is defined in five places.

**Scope**
- One engine `OCEAN` constant (radius 120, seabed −18, surface +18) replaces the Room, client-cue, camera-default and engine copies.
- Scale the prey budget: about 480 ambient fish, a cap of 720, 8 spawns per tick, 24 schools and 60 Frenzy chum.
- Bots, spawning, Frenzy volume and fog keep working at the new size.

**Acceptance:** Tests use the shared constant; at full population the per-player snapshot still meets the ST-241 budget.

**Validation:** `npm test -- tests/ocean-arena.test.ts tests/volumetric-engine.test.ts tests/swimming-camera.test.ts tests/bot-ai-3d.test.ts tests/feeding-frenzy-3d.test.ts tests/client-performance.test.ts`.

---

### ST-261 — [FEAT] Grow coral reefs across the seabed

**Goal:** The only reefs are three rock clusters outside the wall.

**Scope**
- Add a server-safe engine `reefs` module: a fixed set of reef sites (position and radius) derived from `OCEAN` that keeps clear of the Frenzy column.
- The client fills each site with instanced brain, branching, plate, fan and tube coral; counts are quality-scaled.
- Move the wreck inside the wall as a landmark and delete the out-of-bounds rock clusters.
- Coral is scenery and a spawn anchor for now; sharks swim through it.

**Acceptance:** The layout is deterministic (test); coral stays within the draw and instance budgets at every quality.

**Validation:** `npm test -- tests/ocean-arena.test.ts tests/client-performance.test.ts` plus the reef layout test.

---

### ST-262 — [FEAT] Sway the kelp and vary coral colour and size

**Goal:** Reefs should look alive, not stamped.

**Scope:** Add swaying kelp clusters between reef sites (vertex sway, frozen under reduced motion). Give coral per-piece colour from a reef palette (pink, purple, orange, yellow, teal, red), size variation and depth-based tint.

**Acceptance:** Presentation tests pass; reduced motion freezes the sway.

**Validation:** `npm test -- tests/ocean-arena.test.ts tests/accessibility-contract.test.ts`.

---

### ST-263 — [FEAT] Keep reef fish schooling around the coral

**Goal:** Tie the reef fish to the reefs so coral matters.

**Scope:** Reef prey spawn inside reef sites, and their schools circle their home site instead of drifting across the tank; flee behavior is unchanged. Bait schools roam open water.

**Acceptance:** Deterministic tests show reef fish staying near their home sites.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/determinism.test.ts`.

---

### ST-264 — [FEAT] Give every school its own species look

**Goal:** Only two fish looks exist.

**Scope**
- Render the protocol-12 school codes as distinct species:
  - bait: sardine, anchovy and silverside;
  - reef: clownfish, blue tang, yellow tang, angelfish and parrotfish.
- Each species differs in colours, stripes and proportions, with ±15% size variation, wobble (at most 0.3 units) and a slight emissive so fish stay visible in fog.
- Positions stay authoritative.

**Acceptance:** Species mapping tests pass; reduced motion disables wobble.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/accessibility-contract.test.ts`.

---

### ST-265 — [FEAT] Add tuna schools and gliding rays

**Goal:** Give hunters bigger, faster and rarer prey.

**Scope**
- Tuna: value 5, schools of 4–6 in open mid-water, fast with a strong flee.
- Rays: value 8, glide solo just above the seabed near reef sites, slow with a short flee.
- Add their specs and population quotas, and teach bots their value.

**Acceptance:** Deterministic spawn, movement and flee tests pass, and the population quotas hold.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/bot-ai-3d.test.ts tests/determinism.test.ts`.

---

### ST-266 — [FEAT] Add darting squid and a rare golden fish

**Goal:** Create chase moments.

**Scope**
- Squid: value 4, mid-water, darting in short deterministic bursts when chased.
- Golden fish: value 12, at most one alive on a deterministic schedule of about 30 s, very skittish, leaving after 60 s if uneaten.

**Acceptance:** Deterministic dart, schedule and lifetime tests pass.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/determinism.test.ts`.

---

### ST-267 — [FEAT] Model tuna, squid, rays and the golden fish

**Goal:** Every new species should read at a glance.

**Scope:** Instanced presentation for:
- a streamlined silver-blue tuna;
- a squid with a mantle and trailing tentacles;
- a flat ray with flapping wings;
- a glowing golden fish with a sparkle and a caption when nearby.

**Acceptance:** Presentation tests pass and draw budgets hold.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/client-performance.test.ts tests/accessibility-contract.test.ts`.

---

### ST-268 — [OPS] Release the bigger ocean update as v2.4.0

**Goal:** Ship ST-260 through ST-267.

**Scope:** Semantic minor release after the owner records the manual rows for the bigger ocean, reefs, species readability and frame budgets on a real phone.

**Acceptance:** `v2.4.0` is live. Protected approval is honored; stop and report if it is pending.

---

### ST-269 — [FEAT] Grow through five named tiers within a round

**Goal:** Growth is invisible and has no milestones.

**Scope**
- Add engine tiers (Pup, Reef Shark, Tiger Shark, Great White, Megalodon) with `tierForLength` and `tierProgress`.
- Retune per-prey growth and the scale curve so steady eating reaches Reef at about 30 s, Tiger at about 90 s, Great White at about 3 minutes and Megalodon at about 4.5 minutes, with Megalodon about 2.5× spawn scale.

**Acceptance:** A deterministic steady-eater simulation hits each tier time within ±25%, and the camera still frames Megalodon.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/shark-models.test.ts tests/swimming-camera.test.ts tests/determinism.test.ts` plus the tier test.

---

### ST-270 — [FEAT] Give smaller sharks a turning edge over bigger ones

**Goal:** Give small sharks counterplay against hunters.

**Scope:** One engine helper scales turn and pitch rates from about 1.15× at Pup to about 0.85× at Megalodon. The Room and the predictor share it.

**Acceptance:** Helper and prediction-parity tests pass.

**Validation:** `npm test -- tests/volumetric-engine.test.ts tests/realtime-3d-network.test.ts tests/determinism.test.ts`.

---

### ST-271 — [FEAT] Seed prey near human sharks and greet each spawn with a school

**Goal:** Food should always be nearby.

**Scope:** Spawn about 35% of bait top-ups 10–30 units from a living human shark, chosen by deterministic RNG over sorted ids. Drop a small bait school ahead of each human spawn.

**Acceptance:** Deterministic tests pass and snapshot budgets hold.

**Validation:** `npm test -- tests/prey-schools.test.ts tests/client-performance.test.ts tests/determinism.test.ts`.

---

### ST-272 — [FEAT] Stop bots farming fresh spawns

**Goal:** Keep the size ladder climbable for people.

**Scope:** Bots ignore sharks until 4 s after spawn grace ends and only hunt humans they can devour. They retire on reaching Great White instead of at score 240.

**Acceptance:** Bot AI tests pass.

**Validation:** `npm test -- tests/bot-ai-3d.test.ts tests/determinism.test.ts`.

---

### ST-273 — [FEAT] Celebrate every tier-up with an evolution moment

**Goal:** Make growth feel like progress.

**Scope:** When the local shark crosses a tier, show a toast ("Evolved: Tiger Shark"), a ring burst and a chime, and announce it politely. Reduced motion keeps only the toast.

**Acceptance:** Detection tests show no repeat on reconnect or respawn.

**Validation:** `npm test -- tests/accessibility-contract.test.ts` plus the helper test.

---

### ST-274 — [FEAT] Count eat streaks and float score gains

**Goal:** Make eating feel great.

**Scope:** Track local eating gains in 1.5 s windows. Show a "×N streak" chip, float "+N" by the score, and raise the eat cue's pitch with the streak. This is cosmetic only.

**Acceptance:** Streak tests pass; announcements stay bounded; reduced motion disables the float.

**Validation:** `npm test -- tests/spatial-audio.test.ts tests/accessibility-contract.test.ts` plus the helper test.

---

### ST-275 — [REFACTOR] Schedule music on the audio clock with lookahead

**Goal:** Music notes come from `setInterval`, which jitters on phones.

**Scope:** A timer wakes about every 25 ms and schedules notes up to 100 ms ahead on `AudioContext.currentTime`. The melody is unchanged until ST-276.

**Acceptance:** Fake-clock scheduler tests pass; start, stop and visibility handling are unchanged.

**Validation:** `npm test -- tests/spatial-audio.test.ts` plus the scheduler test.

---

### ST-276 — [FEAT] Compose a layered underwater score with pads and bass

**Goal:** Replace the six-note loop.

**Scope:** An evolving minor-key progression (about eight bars, four chords) on detuned, filtered pads and a soft bass, each on its own gain.

**Acceptance:** Score-data tests cover the progression and voice ranges.

**Validation:** `npm test -- tests/spatial-audio.test.ts` plus the score test.

---

### ST-277 — [FEAT] Add percussion and a lead motif to the score

**Goal:** Give the score layers that can carry intensity.

**Scope:** A soft kick and shaker built from filtered noise, plus a sparse lead motif, as optional layers on their own gains.

**Acceptance:** Pattern tests pass.

**Validation:** Score tests.

---

### ST-278 — [FEAT] Drive music intensity from gameplay and turn music on by default

**Goal:** Music should rise with danger, Frenzy and Apex, and players should actually hear it.

**Scope**
- Crossfade layer mixes over at least 1 s:

  | State | Mix |
  | --- | --- |
  | Calm | Pads and bass |
  | Hunt (threat near or low health) | Adds percussion |
  | Frenzy | Fast percussion and motif |
  | Apex | Tension variation |
  | Round result | Short sting, then calm |

- Default music goes to 0.35 and still starts after the first gesture; the music toggle is visible on touch without opening the gear.

**Acceptance:** State-to-mix tests pass; the settings-default pin is updated; the WCAG 1.4.2 control is reachable in one tap.

**Validation:** `npm test -- tests/spatial-audio.test.ts tests/feeding-frenzy-3d.test.ts tests/accessibility-contract.test.ts`.

---

### ST-279 — [FEAT] Route audio through an underwater reverb and limiter bus

**Goal:** Make everything sound underwater, without clipping.

**Scope:** A generated-impulse convolver and a gentle low-pass on the music and SFX sends, then a compressor/limiter before the output.

**Acceptance:** Graph tests with a fake AudioContext pass; volumes still map 0–1.

**Validation:** `npm test -- tests/spatial-audio.test.ts`.

---

### ST-280 — [FEAT] Replace harsh beeps and droning cues with crunches, whooshes, plucks and a swim layer

**Goal:** SFX are square and saw chirps, and the swim and presence cues drone about once a second.

**Scope**
- Bite: a noise crunch with a thump. Dash: a noise-sweep whoosh. Eat: a soft pluck pitched by the streak. Tier-up: a chime. Gentler death and respawn stingers.
- One continuous speed-driven swim layer replaces the periodic chirps.
- Nearby-shark presence becomes occasional and distance-scaled; captions are kept.

**Acceptance:** Voice and cadence tests pass and peak levels are bounded.

**Validation:** `npm test -- tests/spatial-audio.test.ts tests/feeding-frenzy-3d.test.ts tests/accessibility-contract.test.ts`.

---

### ST-281 — [OPS] Release the growth and music update as v2.5.0

**Goal:** Ship ST-269 through ST-280.

**Scope:** Semantic minor release after the owner records the manual rows for tiers, streaks, bot fairness and audio on a real phone and a desktop browser.

**Acceptance:** `v2.5.0` is live. Protected approval is honored; stop and report if it is pending.

---

### ST-282 — [FEAT] Replace the HUD cards with one compact top bar and status chips

**Goal:** Five cards and a two-line Frenzy banner cover the top of a phone.

**Scope:** One row holding the tier badge with progress, score, round clock, rank and a slim health bar. Frenzy and Apex become small chips under it ("FRENZY 12s", "APEX 0:32"). Keep the screen-reader snapshot and announcements.

**Acceptance:** The HUD fits one row at 740×360 and at most two rows at 375 px wide (CSS contract).

**Validation:** `npm test -- tests/accessibility-contract.test.ts tests/round-apex.test.ts tests/feeding-frenzy-3d.test.ts`.

---

### ST-283 — [FEAT] Collapse the leaderboard to the top three plus you

**Goal:** A ten-row board is too much for a phone.

**Scope:** Show the top three plus your row. On touch it starts collapsed and expands on tap. Keep `aria-current` and Apex marking.

**Acceptance:** Component tests pass; no overlap with the HUD or ability arc.

**Validation:** `npm test -- tests/accessibility-contract.test.ts tests/round-apex.test.ts`.

---

### ST-284 — [FEAT] Point to off-screen threats, Apex, Frenzy and golden fish from the screen edge

**Goal:** In a bigger ocean, players need direction at a glance rather than in a text list.

**Scope**
- A pure helper projects targets and clamps off-screen ones to an inset ellipse, showing at most four:
  - sharks that can devour you within 40 units;
  - the Apex;
  - the Frenzy centre;
  - the golden fish.
- They render as small DOM arrows with glyphs and distance.
- The text radar becomes screen-reader-only by default.

**Acceptance:** Projection tests pass, including behind-camera cases; reduced motion and high contrast are respected.

**Validation:** `npm test -- tests/depth-navigation.test.ts tests/accessibility-contract.test.ts`.

---

### ST-285 — [FEAT] Shrink name tags and fade them with distance

**Goal:** 136 px name pills overlap the HUD.

**Scope:** Auto-size tags (11–12 px text), cap them at five (Apex, threats, nearest), hide your own after 3 s, fade them between 30 and 55 units, and clamp them below the top bar. Keep edibility glyphs and the label setting.

**Acceptance:** Selection tests pass; tags never sit behind the HUD.

**Validation:** `npm test -- tests/depth-navigation.test.ts tests/full-3d-product-acceptance.test.ts`.

---

### ST-286 — [FEAT] Rebuild the death and round-result cards

**Goal:** Make deaths quick to recover from and round ends worth celebrating.

**Scope**
- Death card: who got you, your tier and score, and a large Respawn button with a countdown ring.
- Result card: a top-three podium, your rank and score, and a primary "Play again".
- Keep the focus behavior and Escape.

**Acceptance:** DeathOverlay and round-result tests pass.

**Validation:** `npm test -- tests/accessibility-contract.test.ts tests/round-apex.test.ts tests/full-3d-product-acceptance.test.ts`.

---

### ST-287 — [FEAT] Refresh the main menu with an inline name and live skin preview

**Goal:** Make the first screen about the game, not a form.

**Scope:** Put the name field and skin swatches beside a big Play button and a small shark preview, folding Customize into the menu. Keep the radio-group semantics and the name policy.

**Acceptance:** Menu tests pass.

**Validation:** `npm test -- tests/game-document.test.tsx tests/name-policy.test.ts tests/accessibility-contract.test.ts`.

---

### ST-288 — [FEAT] Coach the first thirty seconds with one-time hints

**Goal:** Teach new players without a tutorial screen.

**Scope:** First-run hints stored on the device: "Drag to swim", "Eat fish to grow" with an arrow to the nearest school, and "Bite smaller sharks ▼". Each clears on success, is announced politely and can be skipped.

**Acceptance:** State-machine tests pass; hints never return.

**Validation:** `npm test -- tests/accessibility-contract.test.ts` plus the helper test.

---

### ST-289 — [FEAT] Light and countershade the sharks

**Goal:** Unlit sharks read as flat blobs.

**Scope:** Use a lit material with dark-dorsal, light-ventral countershading multiplied by the skin colour. Keep high contrast and skin recognition.

**Acceptance:** Material tests pass; draw calls are unchanged.

**Validation:** `npm test -- tests/shark-models.test.ts tests/client-performance.test.ts`.

---

### ST-290 — [FEAT] Replace sphere-and-cone sharks with a smooth body and blade fins

**Goal:** Remove the chunky sphere-and-cone look.

**Scope:** One tapered profile body replaces the body, head and snout spheres, and thin blade fins replace the cones. Segment counts scale with quality.

**Acceptance:** Fewer draws; shark model tests are updated.

**Validation:** `npm test -- tests/shark-models.test.ts tests/client-performance.test.ts`.

---

### ST-291 — [FEAT] Bend the shark body with a continuous spine wave

**Goal:** Smooth swimming instead of rigid parts.

**Scope:** A vertex-shader spine wave uses per-instance phase and amplitude, which rises with speed. Reduced motion sets it to zero, and Low quality may disable it.

**Acceptance:** Animation-parameter tests pass.

**Validation:** `npm test -- tests/shark-models.test.ts tests/accessibility-contract.test.ts`.

---

### ST-292 — [FEAT] Open the jaws on every bite

**Goal:** Show the attack, not just its result.

**Scope:** A lower jaw gapes for about 150 ms on a local bite press, or when a remote shark's bite cooldown advances.

**Acceptance:** Timing tests pass; reduced motion shows a static open frame.

**Validation:** `npm test -- tests/shark-models.test.ts`.

---

### ST-293 — [FEAT] Trail dash wakes and pop prey at the mouth

**Goal:** Make dashing and eating visible.

**Scope:** Draw instanced bubble streaks behind sharks while they lunge, and a small burst in the prey colour where a prey vanished within 12 units of a shark mouth. Both are bounded by the quality particle budget, and reduced motion removes them.

**Acceptance:** Budget and inference tests pass.

**Validation:** `npm test -- tests/client-performance.test.ts tests/prey-schools.test.ts tests/accessibility-contract.test.ts`.

---

### ST-294 — [FEAT] Shake the camera and flash bitten sharks on impact

**Goal:** Hits should be felt and seen. The Camera motion toggle currently does nothing.

**Scope:** Add a short decaying shake on landing a bite, being bitten and devouring, a flash of about 120 ms on bitten sharks, and a red edge vignette when your health drops. All of it obeys the toggle and reduced motion.

**Acceptance:** Envelope tests pass; with the toggle off there is no shake.

**Validation:** `npm test -- tests/swimming-camera.test.ts tests/shark-combat.test.ts tests/accessibility-contract.test.ts`.

---

### ST-295 — [FEAT] Draw a visible current curtain at the arena edge

**Goal:** The soft wall should be visible before you reach it.

**Scope:** A translucent cylindrical current wall with a vertical gradient and slow flow lines, which brightens within 20 units. It replaces the thin boundary rings.

**Acceptance:** Environment tests and the draw inventory are updated.

**Validation:** `npm test -- tests/ocean-arena.test.ts tests/client-performance.test.ts`.

---

### ST-296 — [REFACTOR] Sweep the last dead code, styles and copy

**Goal:** Leave nothing unused behind after the wave.

**Scope:** Re-run the dead-export scan and delete anything unused. Remove unreferenced selectors from `theme.css`, unused settings fields, and stale Help and announcement copy left by replaced UI.

**Acceptance:** The scan finds nothing unused, every `theme.css` selector is referenced by a component, and every setting has a reader.

**Validation:** `npm run typecheck`; `npm test`; `npm run build`.

---

### ST-297 — [OPS] Release the polish update as v2.6.0

**Goal:** Ship ST-282 through ST-296.

**Scope:** Semantic minor release after the owner records the layout, zoom, screen-reader, contrast and visual-readability rows on a real phone and a desktop browser.

**Acceptance:** `v2.6.0` is live. Protected approval is honored; stop and report if it is pending.
