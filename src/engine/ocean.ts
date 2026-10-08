import type { OceanVolume } from "./types.js";

/** Shared production volume; explicit room options still support deterministic fixtures. */
export const OCEAN = Object.freeze({
  radius: 120,
  seabedY: -18,
  surfaceY: 18,
} as const satisfies OceanVolume);
