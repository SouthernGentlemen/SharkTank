import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREY_BUDGET,
  GOLDEN_RULES,
  squidDarting,
  PREY_KINDS,
  PREY_SPECS,
  ROOM_SCHEMA_VERSION,
  applyAction,
  createRoom,
  reefSitesFor,
  rotateYawToward,
  yawPitchToward,
  step,
  type Prey,
  type Shark,
} from "../src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION, PREY_SPECIES, encodePrey, decodePrey, toNetState, decodeState, preyWireId } from "../src/protocol/index.js";
import {
  SCHOOL_LOOKS,
  preySizeVariation,
  preyVisualFor,
  resolvePreyAnimation,
  resolvePreyPresentationQuality,
} from "../src/game/game/preyPresentation.js";

import { bodySegment, mouthPoint, sharkScaleForLength } from "../src/engine/sharkGeometry.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function insideOcean(
  point: { x: number; y: number; z: number },
  ocean: { radius: number; seabedY: number; surfaceY: number },
  margin = 0,
): boolean {
  const radius = Math.max(0, ocean.radius - margin);
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && point.x * point.x + point.z * point.z <= radius * radius
    && point.y >= ocean.seabedY + margin
    && point.y <= ocean.surfaceY - margin;
}

function join(state: ReturnType<typeof createRoom>, id: string, isBot = false): Shark {
  applyAction(state, { type: "join", playerId: id, name: id, isBot });
  return state.sharks[id];
}

function place(shark: Shark, x: number, y: number, z: number): void {
  const point = { x, y, z };
  shark.position = { ...point };
}

function prey(overrides: Partial<Prey> & Pick<Prey, "id" | "kind" | "x" | "y" | "z">): Prey {
  const spec = PREY_SPECS[overrides.kind];
  return {
    value: spec.value,
    r: spec.r,
    yaw: 0,
    pitch: 0,
    school: overrides.kind === "carcass" ? -1 : 0,
    ...overrides,
  };
}

describe("ST-120 authoritative fish and prey schools", () => {
  it("uses a compact typed taxonomy, multiple depths, and an explicit bounded room budget", () => {
    expect(PREY_KINDS).toEqual(["bait", "reef", "tuna", "ray", "squid", "golden", "chum", "carcass"]);
    expect(PREY_BUDGET).toMatchObject({ ambient: 480, spawnPerTick: 8, max: 720, frenzyChum: 60, schools: 24 });
    expect(PREY_BUDGET.ambient).toBeLessThan(PREY_BUDGET.max);

    const state = createRoom({ seed: "typed-prey" });
    expect(state.food).toHaveLength(PREY_BUDGET.ambient);
    expect(state.food.every((actor) => Math.hypot(actor.x, actor.z) >= (state.ocean.radius - 2) * 0.3)).toBe(true);
    expect(new Set(state.food.map((actor) => actor.kind))).toEqual(new Set(["bait", "reef", "tuna", "ray", "squid"]));
    expect(new Set(state.food.map((actor) => Math.round(actor.y))).size).toBeGreaterThan(4);
    for (const actor of state.food) {
      expect(PREY_KINDS).toContain(actor.kind);
      expect(Number.isFinite(actor.yaw) && Number.isFinite(actor.pitch)).toBe(true);
      expect(Number.isInteger(actor.school)).toBe(true);
      expect(insideOcean(actor, state.ocean, PREY_BUDGET.boundaryMargin - 0.01)).toBe(true);
    }
  });

  it("moves prey deterministically through X/Y/Z while keeping every actor inside the ocean volume", () => {
    const first = createRoom({ seed: "school-motion" });
    const second = createRoom({ seed: "school-motion" });
    const before = new Map(first.food.map((actor) => [actor.id, { x: actor.x, y: actor.y, z: actor.z }]));

    for (let i = 0; i < 120; i += 1) {
      step(first);
      step(second);
    }

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
    expect(first.food.some((actor) => {
      const old = before.get(actor.id);
      return old && Math.hypot(actor.x - old.x, actor.y - old.y, actor.z - old.z) > 1;
    })).toBe(true);
    expect(first.food.every((actor) => insideOcean(actor, first.ocean, PREY_BUDGET.boundaryMargin - 0.01))).toBe(true);
  });

  it("keeps consumption, score and growth authoritative in the engine", () => {
    const state = createRoom({ seed: "authoritative-eat", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [prey({ id: "meal", kind: "bait", x: 0.72, y: 0, z: 0, school: -1 })];
    const shark = join(state, "eater");
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    shark.invulnTick = 0;
    const beforeLength = shark.length;

    step(state);

    expect(state.food.some((actor) => actor.id === "meal")).toBe(false);
    expect(shark.score).toBe(1);
    expect(shark.length).toBeGreaterThan(beforeLength);

    const renderer = read("../src/game/game/PreyLayer.tsx");
    expect(renderer).not.toContain("score +=");
    expect(renderer).not.toContain("length +=");
    expect(renderer).not.toContain("distance3(");
    expect(renderer).not.toContain("applyAction(");
  });

  it("converts shark death/leave drops into authoritative carcass pieces rather than anonymous pellets", () => {
    const state = createRoom({ seed: "carcass-drop" });
    const shark = join(state, "departing");
    place(shark, 4, 2, -3);
    const ambientIds = new Set(state.food.map((actor) => actor.id));

    applyAction(state, { type: "leave", playerId: shark.id });

    const drops = state.food.filter((actor) => !ambientIds.has(actor.id));
    // ST-122 deliberately reduces corpse density so one early kill cannot seed a runaway growth loop.
    expect(drops.length).toBeGreaterThanOrEqual(14);
    expect(drops.length).toBeLessThanOrEqual(28);
    expect(drops.every((actor) => actor.kind === "carcass" && actor.school === -1)).toBe(true);
    expect(drops.every((actor) => insideOcean(actor, state.ocean))).toBe(true);
  });

  it("keeps authoritative volumetric prey consumable by the bot planner", () => {
    const state = createRoom({ seed: "bot-prey", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    state.food = [
      prey({ id: "upper-reef", kind: "reef", x: 8, y: 6, z: 0, school: -1 }),
      ...Array.from({ length: PREY_BUDGET.ambient - 1 }, (_, i) => (
        prey({ id: `far-${i}`, kind: "carcass", x: 70, y: 0, z: (i % 11) - 5, school: -1 })
      )),
    ];
    const bot = join(state, "bot-compat", true);
    place(bot, 0, 0, 0);
    bot.yaw = bot.targetYaw = 0;
    bot.pitch = bot.targetPitch = 0;

    step(state);

    expect(bot.targetPitch).toBeGreaterThan(0);
    const engine = read("../src/engine/room.ts");
    expect(engine).toContain("choosePreyTarget");
    expect(engine).toContain("yawPitchToward(head, targetPoint)");
  });

  it("renders recognizable procedural fish and distinct chum/carcass drops through bounded instancing", () => {
    expect(preyVisualFor("bait", 1, 0.42).mode).toBe("fish");
    expect(preyVisualFor("reef", 2, 0.58).bodyHeight).toBeGreaterThan(preyVisualFor("bait", 1, 0.42).bodyHeight);
    expect(preyVisualFor("chum", 5, 0.95).mode).toBe("drop");
    expect(preyVisualFor("carcass", 2, 0.72).mode).toBe("drop");

    const renderer = read("../src/game/game/PreyLayer.tsx");
    for (const part of ["bodyMesh", "headMesh", "tailMesh"]) {
      expect(renderer).toContain(`const ${part} = useRef<THREE.InstancedMesh>(null);`);
      expect(renderer).toContain(`ref={${part}}`);
    }
    expect(renderer).toContain("THREE.InstancedMesh");
    expect(renderer).toContain("<sphereGeometry");
    expect(renderer).toContain("<coneGeometry");
    expect(renderer).toContain("<dodecahedronGeometry");
    expect(renderer).toContain("interpolateOrientedPose(prior, actor");
    expect(renderer).toContain("resolvePreyAnimation");
    expect(renderer).toContain("settings.a11y.motion");
    expect(renderer).toContain("PREY_BUDGET.max");
    expect(renderer).not.toContain("icosahedronGeometry");
    expect(renderer).not.toContain("http://");
    expect(renderer).not.toContain("https://");
    expect(renderer).not.toContain("fetch(");
  });

  it("keeps swimming animation presentation-only, reduced-motion-safe and recognizable on low quality", () => {
    const full = resolvePreyAnimation({ seconds: 42.5 / 20, id: "fish-1", speed: 4, reducedMotion: false });
    expect(resolvePreyAnimation({ seconds: 42.5 / 20, id: "fish-1", speed: 4, reducedMotion: false })).toEqual(full);
    expect(Math.abs(full.tailYaw)).toBeGreaterThan(0);
    let last = full;
    for (let frame = 1; frame <= 60; frame += 1) {
      const next = resolvePreyAnimation({ seconds: 42.5 / 20 + frame / 60, id: "fish-1", speed: 4, reducedMotion: false });
      expect(next).not.toEqual(last);
      last = next;
    }
    expect(readFileSync(new URL("../src/game/game/PreyLayer.tsx", import.meta.url), "utf8")).toContain("seconds: clock.elapsedTime");
    expect(resolvePreyAnimation({ seconds: 42.5 / 20, id: "fish-1", speed: 4, reducedMotion: true })).toEqual({ bodyYaw: 0, tailYaw: 0, wobbleY: 0 });

    const low = resolvePreyPresentationQuality("low");
    const high = resolvePreyPresentationQuality("high");
    expect(low.radialSegments).toBeGreaterThanOrEqual(6);
    expect(low.radialSegments).toBeLessThan(high.radialSegments);
  });

  it("ships only compact authoritative prey fields and keeps browser presentation out of Worker imports", () => {
    const state = createRoom({ seed: "wire-prey" });
    const net = decodeState(toNetState(state));
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
    expect(net.food).toHaveLength(PREY_BUDGET.ambient);
    expect(net.food[0]).toMatchObject({
      id: preyWireId(state.food[0].id),
      kind: state.food[0].kind,
      value: state.food[0].value,
    });
    expect("school" in net.food[0]).toBe(false);

    const worker = read("../src/worker/index.ts");
    const roomDo = read("../src/worker/room-do.ts");
    expect(worker).not.toContain("@react-three/fiber");
    expect(worker).not.toContain('from "three"');
    expect(roomDo).not.toContain("@react-three/fiber");
    expect(roomDo).not.toContain('from "three"');

    const packageJson = JSON.parse(read("../package.json")) as { version: string };
    const wrangler = read("../wrangler.jsonc");
    expect(packageJson.version).toBe("2.4.0");
    expect(wrangler).toContain('"tag": "v1"');
    expect(wrangler).toContain('"class_name": "Room"');
    expect(wrangler).not.toContain('"class_name": "Lobby"');
  });
});



describe("ST-263 reef-school homes", () => {
  it("spawns reef schools inside their stable coral sites while bait still roams the open ocean", () => {
    const room = createRoom({ seed: "reef-school-homes" });
    const homes = reefSitesFor(room.ocean);
    const reef = room.food.filter((actor) => actor.kind === "reef");
    const bait = room.food.filter((actor) => actor.kind === "bait");
    expect(reef.length).toBeGreaterThan(50);
    expect(bait.length).toBeGreaterThan(250);
    expect(new Set(reef.map((actor) => actor.school % homes.length)).size).toBe(homes.length);
    const siteCounts = homes.map((_, site) =>
      reef.filter((actor) => actor.school % homes.length === site).length);
    expect(Math.max(...siteCounts) - Math.min(...siteCounts)).toBeLessThanOrEqual(1);
    for (const actor of reef) {
      const home = homes[actor.school % homes.length];
      expect(Math.hypot(actor.x - home.position.x, actor.z - home.position.z))
        .toBeLessThanOrEqual(home.radius * 0.65 + 1e-9);
      expect(actor.y).toBeGreaterThanOrEqual(room.ocean.seabedY + 2);
    }
    expect(bait.some((actor) => Math.hypot(actor.x, actor.z) > room.ocean.radius * 0.9)).toBe(true);
    const small = createRoom({ seed: "tiny-reef-fixture", oceanRadius: 8, seabedY: -2, surfaceY: 2 });
    expect(small.food.every((actor) => actor.kind === "bait")).toBe(true);
  });

  it("keeps reef schools circling their home across long seeded simulations", () => {
    const first = createRoom({ seed: "orbit-reef-schools" });
    const second = createRoom({ seed: "orbit-reef-schools" });
    const homes = reefSitesFor(first.ocean);
    const start = new Map(first.food.filter((actor) => actor.kind === "reef")
      .map((actor) => [actor.id, { x: actor.x, z: actor.z }]));
    for (let tick = 0; tick < 360; tick += 1) {
      step(first);
      step(second);
    }
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const reef = first.food.filter((actor) => actor.kind === "reef");
    expect(reef.length).toBeGreaterThan(50);
    expect(reef.some((actor) => {
      const before = start.get(actor.id);
      return before && Math.hypot(actor.x - before.x, actor.z - before.z) > 2;
    })).toBe(true);
    for (const actor of reef) {
      const home = homes[actor.school % homes.length];
      expect(Math.hypot(actor.x - home.position.x, actor.z - home.position.z))
        .toBeLessThan(home.radius * 1.25);
    }
  });

  it("keeps nearby-shark flee steering ahead of reef orbit steering", () => {
    const room = createRoom({ seed: "reef-flee-priority" });
    const actor = room.food.find((prey) => prey.kind === "reef");
    expect(actor).toBeDefined();
    const shark = join(room, "reef-chaser");
    place(shark, actor!.x + 5, actor!.y, actor!.z);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const flee = yawPitchToward(shark.position, actor!);
    const expectedYaw = rotateYawToward(actor!.yaw, flee.yaw, PREY_SPECS.reef.turnRate);
    step(room);
    expect(actor!.yaw).toBeCloseTo(expectedYaw, 10);
  });
});

describe("ST-265 tuna schools and solitary reef rays", () => {
  it("seeds reproducible five-fish tuna schools and one ray at each coral site within the 480-prey quota", () => {
    const room = createRoom({ seed: "tuna-ray-quota" });
    const replica = createRoom({ seed: "tuna-ray-quota" });
    expect(room).toEqual(replica);
    const tuna = room.food.filter((actor) => actor.kind === "tuna");
    const rays = room.food.filter((actor) => actor.kind === "ray");
    const homes = reefSitesFor(room.ocean);
    expect(room.food).toHaveLength(PREY_BUDGET.ambient);
    expect(tuna).toHaveLength(PREY_BUDGET.tunaSchools * PREY_BUDGET.tunaPerSchool);
    expect(rays).toHaveLength(homes.length * PREY_BUDGET.raysPerReef);
    for (let group = 0; group < PREY_BUDGET.tunaSchools; group += 1) {
      const school = tuna.filter((actor) => actor.school === PREY_BUDGET.schools + group);
      expect(school).toHaveLength(5);
      for (const actor of school) {
        expect(Math.abs(actor.y - (room.ocean.surfaceY + room.ocean.seabedY) / 2)).toBeLessThan(5);
        expect(Math.hypot(actor.x, actor.z)).toBeGreaterThan(room.ocean.radius * 0.4);
      }
      expect(Math.max(...school.map((actor) => actor.x)) - Math.min(...school.map((actor) => actor.x))).toBeLessThan(7);
      expect(Math.max(...school.map((actor) => actor.z)) - Math.min(...school.map((actor) => actor.z))).toBeLessThan(7);
    }
    for (let index = 0; index < homes.length; index += 1) {
      const ray = rays.find((actor) => actor.school === PREY_BUDGET.schools + PREY_BUDGET.tunaSchools + index);
      expect(ray).toBeDefined();
      expect(ray!.y - room.ocean.seabedY).toBeGreaterThan(2);
      expect(ray!.y - room.ocean.seabedY).toBeLessThan(4);
      expect(Math.hypot(ray!.x - homes[index].position.x, ray!.z - homes[index].position.z))
        .toBeLessThan(homes[index].radius);
    }
    for (const actor of [...tuna, ...rays]) {
      const code = encodePrey(actor)[1];
      expect(PREY_SPECIES[code]).toBe(actor.kind);
      expect(decodePrey(encodePrey(actor))).toMatchObject({ kind: actor.kind, value: actor.value, r: actor.r });
    }
  });

  it("restores depleted premium quotas with bounded ambient top-ups and deterministic movement", () => {
    const first = createRoom({ seed: "tuna-ray-restock" });
    const lostTuna = first.food.find((actor) => actor.kind === "tuna")!;
    const lostRay = first.food.find((actor) => actor.kind === "ray")!;
    first.food = first.food.filter((actor) => actor.id !== lostTuna.id && actor.id !== lostRay.id);
    const second = structuredClone(first);
    for (let tick = 0; tick < 240; tick += 1) {
      step(first);
      step(second);
    }
    expect(first).toEqual(second);
    expect(first.food).toHaveLength(PREY_BUDGET.ambient);
    expect(first.food.filter((actor) => actor.kind === "tuna")).toHaveLength(10);
    expect(first.food.filter((actor) => actor.kind === "ray")).toHaveLength(8);
    expect(first.food.some((actor) => actor.kind === "tuna" && actor.id !== lostTuna.id)).toBe(true);
    expect(first.food.every((actor) => insideOcean(actor, first.ocean, PREY_BUDGET.boundaryMargin - 0.01))).toBe(true);
  });

  it.each(["tuna", "ray"] as const)("gives %s server-owned flee steering and species-specific speed", (kind) => {
    const room = createRoom({ seed: `premium-flee-${kind}` });
    const actor = room.food.find((candidate) => candidate.kind === kind)!;
    const original = { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw };
    const shark = join(room, `${kind}-chaser`);
    place(shark, actor.x + 3, actor.y, actor.z);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    const flee = yawPitchToward(shark.position, actor);
    const expectedYaw = rotateYawToward(actor.yaw, flee.yaw, PREY_SPECS[kind].turnRate);
    step(room);
    expect(actor.yaw).toBeCloseTo(expectedYaw, 10);
    const speed = Math.hypot(actor.x - original.x, actor.y - original.y, actor.z - original.z);
    expect(speed).toBeGreaterThan(PREY_SPECS[kind].speed * 0.9);
    expect(speed).toBeLessThanOrEqual(PREY_SPECS[kind].speed * PREY_SPECS[kind].fleeMultiplier + 1e-7);
    expect(PREY_SPECS.tuna.speed * PREY_SPECS.tuna.fleeMultiplier)
      .toBeGreaterThan(PREY_SPECS.ray.speed * PREY_SPECS.ray.fleeMultiplier * 5);
  });
});


describe("ST-266 deterministic squid darts and golden fish", () => {
  it("keeps twelve mid-water squid in the ambient budget and decodes reserved species 13", () => {
    const room = createRoom({ seed: "squid-ambient" });
    const squid = room.food.filter((f) => f.kind === "squid");
    expect(room.food).toHaveLength(PREY_BUDGET.ambient);
    expect(squid).toHaveLength(PREY_BUDGET.squid);
    for (const actor of squid) {
      expect(actor.value).toBe(4);
      expect(actor.school).toBe(-1);
      expect(Math.abs(actor.y - (room.ocean.seabedY + room.ocean.surfaceY) / 2)).toBeLessThanOrEqual(3);
      expect(Math.hypot(actor.x, actor.z)).toBeGreaterThan(room.ocean.radius * 0.4);
      expect(encodePrey(actor)[1]).toBe(13);
      expect(decodePrey(encodePrey(actor))).toMatchObject({ kind: "squid", value: 4, r: PREY_SPECS.squid.r });
      expect(preyVisualFor(actor.kind, actor.value, actor.r).mode).toBe("fish");
    }
  });

  it("darts for four deterministic ticks per cycle while chased, then coasts", () => {
    const room = createRoom({ seed: "squid-dart" });
    const actor = room.food.find((f) => f.kind === "squid")!;
    const shark = join(room, "squid-chaser");
    const cycle = Array.from({ length: 16 }, (_, t) => squidDarting(actor.id, t));
    expect(cycle.filter(Boolean)).toHaveLength(4);
    expect(cycle).toEqual(Array.from({ length: 16 }, (_, t) => squidDarting(actor.id, t + 16)));
    let bursts = 0;
    for (let i = 0; i < 16; i += 1) {
      place(shark, actor.x + 7, actor.y, actor.z);
      const previous = { x: actor.x, y: actor.y, z: actor.z };
      const burst = squidDarting(actor.id, room.tick + 1);
      step(room);
      const travel = Math.hypot(actor.x - previous.x, actor.y - previous.y, actor.z - previous.z);
      expect(travel).toBeCloseTo(PREY_SPECS.squid.speed * (burst ? PREY_SPECS.squid.fleeMultiplier : 1), 6);
      if (burst) bursts += 1;
    }
    expect(bursts).toBe(4);
  });

  it("has at most one golden fish on 30-second windows, retiring it at 60 seconds", () => {
    const room = createRoom({ seed: "golden-clock" });
    const replica = createRoom({ seed: "golden-clock" });
    const golden = () => room.food.filter((f) => f.kind === "golden");
    expect(GOLDEN_RULES.intervalTicks).toBe(600);
    expect(GOLDEN_RULES.lifetimeTicks).toBe(1200);
    for (let tick = 1; tick <= GOLDEN_RULES.intervalTicks * 3; tick += 1) {
      step(room);
      step(replica);
      expect(golden().length).toBeLessThanOrEqual(1);
      if (tick === 599) expect(golden()).toHaveLength(0);
      if (tick === 600) {
        expect(golden()).toHaveLength(1);
        expect(golden()[0].id).toBe("golden-600");
        expect(golden()[0].value).toBe(12);
        expect(encodePrey(golden()[0])[1]).toBe(15);
        expect(decodePrey(encodePrey(golden()[0]))).toMatchObject({ kind: "golden", value: 12, r: PREY_SPECS.golden.r });
        expect(preyVisualFor("golden", 12, PREY_SPECS.golden.r).mode).toBe("fish");
      }
      if (tick === 1200) expect(golden()[0].id).toBe("golden-600");
    }
    expect(golden()).toHaveLength(1);
    expect(golden()[0].id).toBe("golden-1800");
    // Frenzy chum and capped per-tick top-ups can briefly leave ambient below target.
    const ambient = room.food.filter((actor) => actor.kind !== "chum" && actor.kind !== "carcass");
    expect(ambient.length).toBeGreaterThanOrEqual(PREY_BUDGET.ambient - PREY_BUDGET.spawnPerTick);
    expect(ambient.length).toBeLessThanOrEqual(PREY_BUDGET.ambient);
    expect(room.food.length).toBeLessThanOrEqual(PREY_BUDGET.max);
    expect(room).toEqual(replica);
  });

  it("respects the next window after the golden fish is eaten", () => {
    const room = createRoom({ seed: "golden-caught" });
    for (let tick = 0; tick < GOLDEN_RULES.intervalTicks; tick += 1) step(room);
    room.food = room.food.filter((f) => f.kind !== "golden");
    for (let tick = 1; tick < GOLDEN_RULES.intervalTicks; tick += 1) {
      step(room);
      expect(room.food.some((f) => f.kind === "golden")).toBe(false);
    }
    step(room);
    expect(room.food.filter((f) => f.kind === "golden")).toHaveLength(1);
    expect(room.food.find((f) => f.kind === "golden")!.id).toBe("golden-1200");
  });
});

describe("ST-255 swept mouth consumption", () => {
  function setup(isBot = false) {
    const state = createRoom({ seed: "swept-mouth", oceanRadius: 100, seabedY: -20, surfaceY: 20 });
    const shark = join(state, "eater", isBot);
    place(shark, 0, 0, 0);
    shark.yaw = shark.targetYaw = 0;
    shark.pitch = shark.targetPitch = 0;
    state.food = Array.from({ length: PREY_BUDGET.ambient }, (_, i) =>
      prey({ id: `far-${i}`, kind: "carcass", x: 70, y: 0, z: 0 }));
    return { state, shark };
  }

  it.each([10, 100, 400])("eats snout contact but leaves tail prey at length %s", (length) => {
    const { state, shark } = setup();
    shark.length = length;
    const { start, end } = bodySegment(shark);
    state.food.unshift(
      prey({ id: "snout", kind: "carcass", ...start }),
      prey({ id: "tail", kind: "carcass", ...end }),
    );
    step(state);
    expect(state.food.some((f) => f.id === "snout")).toBe(false);
    expect(state.food.some((f) => f.id === "tail")).toBe(true);
  });

  it("catches a line of bait throughout a dash capsule, including its previous endpoint", () => {
    const { state, shark } = setup();
    shark.lungeTicks = 5;
    const mouth = mouthPoint(shark);
    const reach = 1.2 + 0.55 * sharkScaleForLength(shark.length) + PREY_SPECS.bait.r;
    state.food.unshift(...[-reach + 0.05, 0, 0.7, 1.4].map((offset, i) =>
      prey({ id: `meal-${i}`, kind: "bait", x: mouth.x + offset, y: 0, z: 0, school: -1 })));
    step(state);
    expect(state.food.filter((f) => f.id.startsWith("meal-"))).toHaveLength(0);
    expect(shark.score).toBe(4);
  });

  it("uses a three-dimensional capsule and includes prey radius", () => {
    const { state, shark } = setup();
    shark.yaw = shark.targetYaw = Math.PI / 2;
    shark.pitch = shark.targetPitch = 0.5;
    const mouth = mouthPoint(shark);
    const reach = 1.2 + 0.55 * sharkScaleForLength(shark.length) + PREY_SPECS.carcass.r;
    state.food.unshift(
      prey({ id: "inside", kind: "carcass", yaw: Math.PI / 2, x: mouth.x + reach - 0.01, y: mouth.y, z: mouth.z }),
      prey({ id: "outside", kind: "carcass", yaw: Math.PI / 2, x: mouth.x + reach + 0.01, y: mouth.y, z: mouth.z }),
    );
    step(state);
    expect(state.food.some((f) => f.id === "inside")).toBe(false);
    expect(state.food.some((f) => f.id === "outside")).toBe(true);
  });

  it.each([false, true])("bounds chomps for bot=%s", (isBot) => {
    const { state, shark } = setup(isBot);
    const mouth = mouthPoint(shark);
    state.food.unshift(...Array.from({ length: 6 }, (_, i) =>
      prey({ id: `meal-${i}`, kind: "carcass", ...mouth, value: 1 })));
    step(state);
    expect(shark.score).toBe(isBot ? 2 : 4);
    expect(state.food.filter((f) => f.id.startsWith("meal-"))).toHaveLength(isBot ? 4 : 2);
  });
});


describe("ST-264 protocol-12 species looks", () => {
  const species = ["sardine", "anchovy", "silverside", "clownfish", "blue-tang", "yellow-tang", "angelfish", "parrotfish"] as const;

  it("uses the decoded wire species for eight distinguishable palettes, bands and silhouettes", () => {
    const profiles = species.map((name, code) => {
      const kind = code < 3 ? "bait" : "reef";
      const visual = preyVisualFor(kind, kind === "bait" ? 1 : 2, kind === "bait" ? 0.42 : 0.58, name);
      expect(visual.mode).toBe("fish");
      expect(visual.stripeCount).toBeGreaterThan(0);
      expect(visual.bodyColor).toMatch(/^#[0-9a-f]{6}$/);
      return visual;
    });
    expect(Object.keys(SCHOOL_LOOKS)).toEqual(species);
    expect(new Set(profiles.map((look) => look.bodyColor)).size).toBe(8);
    expect(new Set(profiles.map((look) => [look.bodyLength, look.bodyHeight, look.bodyWidth].join(","))).size).toBe(8);
    expect(preyVisualFor("bait", 1, 0.42).bodyColor).toBe(profiles[0].bodyColor);
    expect(preyVisualFor("reef", 2, 0.58).bodyColor).toBe(profiles[3].bodyColor);
    const room = createRoom({ seed: "school-style-mapping" });
    const decoded = decodeState(toNetState(room));
    for (const actor of decoded.food.filter((candidate) => candidate.kind === "bait" || candidate.kind === "reef")) {
      expect(species).toContain(actor.species);
      expect(preyVisualFor(actor.kind, actor.value, actor.r, actor.species).bodyColor)
        .toBe(SCHOOL_LOOKS[actor.species as keyof typeof SCHOOL_LOOKS].bodyColor);
    }
  });

  it("adds only bounded, reproducible instance-scale and cosmetic motion", () => {
    for (const id of ["school-1", "school-2", "fish-3", "987abc"]) {
      const size = preySizeVariation(id);
      expect(size).toBeGreaterThanOrEqual(0.85);
      expect(size).toBeLessThanOrEqual(1.15);
      expect(preySizeVariation(id)).toBe(size);
      for (const seconds of [0, 1, 25, 100]) {
        const moving = resolvePreyAnimation({ seconds, id, speed: 5, reducedMotion: false });
        expect(Math.abs(moving.wobbleY)).toBeLessThanOrEqual(0.3);
        expect(resolvePreyAnimation({ seconds, id, speed: 5, reducedMotion: true }))
          .toEqual({ bodyYaw: 0, tailYaw: 0, wobbleY: 0 });
      }
    }
    const renderer = read("../src/game/game/PreyLayer.tsx");
    expect(renderer).toContain("actor.species");
    expect(renderer).toContain("preySizeVariation(actor.id)");
    expect(renderer).toContain("pose.y + animation.wobbleY");
    expect(renderer).toContain("stripeOneMesh");
    expect(renderer).toContain("stripeTwoMesh");
    expect(renderer).toContain('emissiveIntensity={0.09}');
    expect(renderer).not.toContain("setState(");
  });
});

describe("ST-267 premium species presentation", () => {
  it("maps all four reserved protocol-12 species to legible premium silhouettes", () => {
    const rows = [
      ["tuna", 5, 1.05, 12],
      ["squid", 4, 0.65, 13],
      ["ray", 8, 1.3, 14],
      ["golden", 12, 0.72, 15],
    ] as const;
    for (const [kind, points, radius, code] of rows) {
      const visual = preyVisualFor(kind, points, radius, PREY_SPECIES[code]);
      expect(visual.mode).toBe("fish");
      expect(visual.shape).toBe(kind);
      expect(visual.bodyColor).toMatch(/^#[0-9a-f]{6}$/);
      const decoded = decodePrey(["abc", code, 0, 0, 0, 0, 0]);
      expect(preyVisualFor(decoded.kind, decoded.value, decoded.r, decoded.species).shape).toBe(kind);
    }
    const tuna = preyVisualFor("tuna", 5, 1.05);
    const squid = preyVisualFor("squid", 4, 0.65);
    const ray = preyVisualFor("ray", 8, 1.3);
    const gold = preyVisualFor("golden", 12, 0.72);
    expect(tuna.bodyLength / tuna.bodyHeight).toBeGreaterThan(6);
    expect(squid.bodyWidth).toBeGreaterThan(0.3);
    expect(ray.bodyWidth / ray.bodyHeight).toBeGreaterThan(8);
    expect(gold.bodyColor).toBe("#ffd342");
    expect(new Set([tuna.bodyColor, squid.bodyColor, ray.bodyColor, gold.bodyColor]).size).toBe(4);
  });

  it("animates ray wings cosmetically and shows golden proximity only to a living nearby viewer", async () => {
    const { rayWingFlap, goldenFishNearby } = await import("../src/game/game/preyPresentation.js");
    const rayPhase = rayWingFlap(12, "ray-1", false);
    expect(Math.abs(rayPhase)).toBeLessThanOrEqual(0.25);
    expect(rayWingFlap(12, "ray-1", true)).toBe(0);
    expect(rayWingFlap(12, "ray-1", false)).toBe(rayPhase);
    const fish = [{ kind: "golden", x: 18, y: 0, z: 0 }, { kind: "tuna", x: 0, y: 0, z: 0 }] as const;
    expect(goldenFishNearby(fish, { x: 0, y: 0, z: 0 })).toBe(true);
    expect(goldenFishNearby(fish, { x: -0.01, y: 0, z: 0 })).toBe(false);
    expect(goldenFishNearby(fish, null)).toBe(false);
    expect(goldenFishNearby([{ kind: "tuna", x: 0, y: 0, z: 0 }], { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("keeps all models in bounded instanced batches with no gameplay/transport work", () => {
    const renderer = read("../src/game/game/PreyLayer.tsx");
    expect((renderer.match(/<instancedMesh\b/g) ?? []).length).toBeLessThanOrEqual(13);
    for (const part of ["squidMantleMesh", "squidTentacleMesh", "rayBodyMesh", "rayWingMesh",
      "rayTailMesh", "goldHaloMesh", "goldSparkleMesh"]) {
      expect(renderer).toContain(`ref={${part}}`);
      expect(renderer).toContain("commitInstances(");
    }
    expect(renderer).toContain("PREY_BUDGET.squid * 4");
    expect(renderer).toContain("rayWingFlap(clock.elapsedTime, actor.id, reducedMotion)");
    expect(renderer).toContain("const spin = reducedMotion ? 0 :");
    expect(renderer).not.toContain("new THREE.Mesh(");
    expect(renderer).not.toContain("setState(");
  });
});
