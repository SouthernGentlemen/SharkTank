import { OCEAN } from "./ocean.js";
import { FRENZY_RULES } from "./room.js";
import type { OceanVolume, Vec3 } from "./types.js";

/** Stable, server-safe anchors. Coral is scenery; these sites do not change simulation or wire state. */
export interface ReefSite {
  id: string;
  position: Readonly<Vec3>;
  radius: number;
}

const REEF_ANCHORS = [
  { id: "reef-northeast", angle: 0.1, distance: 0.55, size: 0.11 },
  { id: "reef-east", angle: 0.88, distance: 0.69, size: 0.115 },
  { id: "reef-southeast", angle: 1.74, distance: 0.61, size: 0.105 },
  { id: "reef-south", angle: 2.5, distance: 0.72, size: 0.12 },
  { id: "reef-southwest", angle: 3.3, distance: 0.59, size: 0.11 },
  { id: "reef-west", angle: 4.08, distance: 0.72, size: 0.105 },
  { id: "reef-northwest", angle: 4.83, distance: 0.62, size: 0.115 },
  { id: "reef-north", angle: 5.58, distance: 0.74, size: 0.1 },
] as const;

/** Layout scales with the authoritative ocean. Sites clear the central Frenzy column and wall. */
export function reefSitesFor(ocean: OceanVolume = OCEAN): ReefSite[] {
  const sites = REEF_ANCHORS.map((anchor) => ({
    id: anchor.id,
    position: {
      x: Math.cos(anchor.angle) * anchor.distance * ocean.radius,
      y: ocean.seabedY + 0.12,
      z: Math.sin(anchor.angle) * anchor.distance * ocean.radius,
    },
    radius: anchor.size * ocean.radius,
  }));
  // Guard changes to authored anchors against putting scenery in the Frenzy volume.
  for (const site of sites) {
    const distance = Math.hypot(site.position.x, site.position.z);
    if (distance - site.radius <= ocean.radius * FRENZY_RULES.volumeRadiusShare
        || distance + site.radius >= ocean.radius - 2) {
      throw new Error(`Reef site outside safe ocean ring: ${site.id}`);
    }
  }
  return sites;
}

export const REEF_SITES: readonly ReefSite[] = Object.freeze(
  reefSitesFor().map((site) => Object.freeze({
    ...site,
    position: Object.freeze(site.position),
  })),
);
