import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRENZY_RULES, OCEAN, REEF_SITES, reefSitesFor } from "../src/engine/index.js";
import { CORAL_KINDS, makeCoralPlacements, resolveOceanEnvironmentQuality } from "../src/game/game/oceanArena.js";

const world = readFileSync(new URL("../src/game/game/WorldEnvironment.tsx", import.meta.url), "utf8");

describe("ST-261 deterministic reef layout and instance budgets", () => {
  it("keeps all fixed sites within the wall and outside the central Frenzy column", () => {
    expect(REEF_SITES).toEqual(reefSitesFor(OCEAN));
    expect(REEF_SITES).toHaveLength(8);
    expect(new Set(REEF_SITES.map((site) => site.id)).size).toBe(REEF_SITES.length);
    for (const site of REEF_SITES) {
      const distance = Math.hypot(site.position.x, site.position.z);
      expect(distance - site.radius).toBeGreaterThan(OCEAN.radius * FRENZY_RULES.volumeRadiusShare);
      expect(distance + site.radius).toBeLessThan(OCEAN.radius - 2);
      expect(site.position.y).toBeCloseTo(OCEAN.seabedY + 0.12);
    }
    const scaled = reefSitesFor({ radius: 90, seabedY: -12, surfaceY: 12 });
    expect(scaled.map((site) => site.id)).toEqual(REEF_SITES.map((site) => site.id));
    expect(scaled[0].radius / REEF_SITES[0].radius).toBeCloseTo(90 / OCEAN.radius);
  });

  it("scales five deterministic instanced coral kinds without exceeding capacity", () => {
    let previous = 0;
    for (const quality of ["low", "medium", "high"] as const) {
      const perKind = resolveOceanEnvironmentQuality(quality).coralPerKindPerSite;
      const first = makeCoralPlacements(REEF_SITES, perKind);
      expect(first).toEqual(makeCoralPlacements(REEF_SITES, perKind));
      expect(first.length).toBe(REEF_SITES.length * CORAL_KINDS.length * perKind);
      expect(first.length).toBeGreaterThan(previous);
      expect(first.length).toBeLessThanOrEqual(160);
      previous = first.length;
      for (const kind of CORAL_KINDS) {
        expect(first.filter((piece) => piece.kind === kind)).toHaveLength(REEF_SITES.length * perKind);
      }
      for (const piece of first) {
        const site = REEF_SITES.find((candidate) => candidate.id === piece.siteId);
        expect(site).toBeDefined();
        expect(Math.hypot(piece.position.x - site!.position.x, piece.position.z - site!.position.z))
          .toBeLessThan(site!.radius);
        expect(piece.position.y).toBeGreaterThan(OCEAN.seabedY);
        expect(piece.scale).toBeGreaterThan(0);
      }
    }
    expect(makeCoralPlacements(REEF_SITES, 99)).toHaveLength(160);
    expect(makeCoralPlacements(REEF_SITES, -1)).toHaveLength(0);
  });

  it("uses exactly five instanced coral draw calls, preserving scenery-only authority", () => {
    for (const ref of ["reefBaseRef", "reefSpireRef", "reefRockRef", "reefFanRef", "reefTubeRef"]) {
      expect(world).toContain(`<instancedMesh ref={${ref}}`);
    }
    expect(world).toContain("makeCoralPlacements(");
    expect(world).toContain("reefSitesFor(");
    expect(world).toContain("maxCoralPerKind");
    expect(world).toContain("<WreckLandmark");
    expect(world).not.toContain("setOrientation(");
    expect(world).not.toContain("setBoost(");
  });
});
