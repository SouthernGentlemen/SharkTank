import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDS } from "../vendor/ModuleReact3Fiber/src/client/settings/SettingsContext.js";
import { ROOM_SCHEMA_VERSION } from "../vendor/ModuleReact3Fiber/src/engine/index.js";
import { REALTIME_PROTOCOL_VERSION } from "../vendor/ModuleReact3Fiber/src/protocol/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("full-3D current-state documentation", () => {
  const readme = read("../README.md");
  const architecture = read("../docs/ARCHITECTURE.md");
  const accessibility = read("../docs/ACCESSIBILITY.md");
  const moduleReadme = read("../vendor/ModuleReact3Fiber/README.md");
  const moduleGuide = read("../vendor/ModuleReact3Fiber/CLAUDE.md");
  const plan = read("../implementation_plan.md");
  const viewport = read("../vendor/ModuleReact3Fiber/src/client/game/GameViewport.tsx");

  it("documents the renderer, authority, controls and gameplay that are actually built", () => {
    const docs = [readme, architecture, accessibility, moduleReadme, moduleGuide].join("\n");
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
      "protocol 11",
      "DOM",
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

  it("keeps retired renderer and planar instructions out of current guidance", () => {
    const currentGuidance = [readme, architecture, accessibility, moduleReadme, moduleGuide, plan, viewport].join("\n");
    const retiredPhrases = [
      "present production game mounts " + "GameCanvas",
      "Authority is still " + "planar",
      "moving from a " + "planar",
      "snake." + "io-style room simulation",
      "Cloudflare port checklist (when we get there)",
      "On-screen " + "thumbstick + ability pads",
    ];
    for (const phrase of retiredPhrases) expect(currentGuidance).not.toContain(phrase);
    expect(existsSync(new URL("../vendor/ModuleReact3Fiber/src/client/game/" + "GameCanvas.tsx", import.meta.url))).toBe(false);
  });

  it("keeps identity and the current-only queue stable while documentation advances", () => {
    const pkg = JSON.parse(read("../package.json")) as { version: string };
    expect(pkg.version).toBe("3.0.0");
    expect(ROOM_SCHEMA_VERSION).toBe(11);
    expect(REALTIME_PROTOCOL_VERSION).toBe(11);
    expect(plan).not.toContain("### ST-130");
    expect(plan).not.toContain("### ST-131");
    expect(plan).not.toContain("### ST-132");
    expect(plan).toContain("The queue is empty. Select no implementation task.");
  });
});
