import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDS } from "../src/game/settings/SettingsContext.js";
import { ROOM_SCHEMA_VERSION } from "../src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../src/protocol/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("full-3D current-state documentation", () => {
  const readme = read("../README.md");
  const architecture = read("../docs/ARCHITECTURE.md");
  const accessibility = read("../docs/ACCESSIBILITY.md");
  const productAcceptance = read("../docs/PRODUCT-ACCEPTANCE.md");
  const security = read("../SECURITY.md");
  const viewport = read("../src/game/game/GameViewport.tsx");

  it("documents the renderer, authority, controls and gameplay that are actually built", () => {
    const docs = [readme, architecture, accessibility, productAcceptance, security].join("\n");
    for (const text of [
      "React Three Fiber",
      "full X/Y/Z",
      "yaw + pitch",
      "Room Durable Object",
      "local prediction",
      "remote interpolation",
      "dual-stick",
      "directional bite",
      "Feeding Frenzy",
      "Apex",
      "schema 11",
      "protocol 12",
      "DOM",
      "Portrait touch play",
      "Rotation releases held sticks",
      "non-lethal returning current",
      "0.5 units inside",
    ]) expect(docs).toContain(text);

    expect(DEFAULT_KEYBINDS).toMatchObject({
      pitchUp: "KeyW",
      pitchDown: "KeyS",
      yawLeft: "KeyA",
      yawRight: "KeyD",
      lookUp: "ArrowUp",
      lookDown: "ArrowDown",
      lookLeft: "ArrowLeft",
      lookRight: "ArrowRight",
      boost: "Space",
      bite: "KeyF",
    });
    expect(readme).toContain("W/S pitch");
    expect(readme).toContain("A/D yaw");
    expect(readme).toContain("Arrow keys look");
    expect(readme).toContain("Space bursts");
    expect(readme).toContain("F bites");
  });

  it("keeps current product docs focused on the game", () => {
    const productDocs = [readme, architecture, accessibility, productAcceptance, security].join("\n").toLowerCase();
    for (const retired of ["evidence", "receipts", "billing", "backups", "incidents", "iso 27001", "iso 42001", "provenance"]) {
      expect(productDocs).not.toContain(retired);
    }
    expect(existsSync(new URL("../docs/history", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../scripts/check-provenance.mjs", import.meta.url))).toBe(false);

    const pkg = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:provenance"]).toBeUndefined();
    expect(pkg.scripts.check).not.toContain("check:provenance");
  });

  it("keeps retired renderer and planar instructions out of current guidance", () => {
    const currentGuidance = [readme, architecture, accessibility, viewport].join("\n");
    const retiredPhrases = [
      "present production game mounts " + "GameCanvas",
      "Authority is still " + "planar",
      "moving from a " + "planar",
      "snake." + "io-style room simulation",
      "Cloudflare port checklist (when we get there)",
      "On-screen " + "thumbstick + ability pads",
    ];
    for (const phrase of retiredPhrases) expect(currentGuidance).not.toContain(phrase);
    expect(existsSync(new URL("../src/game/game/" + "GameCanvas.tsx", import.meta.url))).toBe(false);
  });

  it("keeps release and protocol identity stable while documentation advances", () => {
    const pkg = JSON.parse(read("../package.json")) as { version: string; releaseRevision: number };
    expect(pkg.version).toBe("2.2.0");
    expect(pkg.releaseRevision).toBe(0);
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(12);
  });
});
