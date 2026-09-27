import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const worker = read("../src/worker/index.ts");
const presentation = read("../src/worker/presentation.ts");
const reactPresentation = read("../src/worker/presentation-react.tsx");
const gameShell = read("../src/client/game-document.tsx");
const gameMenu = read("../vendor/ModuleReact3Fiber/src/client/ui/MainMenu.tsx");

describe("concise public copy", () => {
  it("uses the current WizardGang mark on the evidence site and game menu", () => {
    expect(reactPresentation).toContain('className="brand-mark" aria-hidden="true"');
    expect(reactPresentation).toContain("<strong>WIZARDGANG</strong><small>SharkTank</small>");
    expect(presentation).toContain("background:#d9ff43;box-shadow:.5rem -.5rem 0 #a489ff");
    expect(gameMenu).toContain('className="wizardgang-menu-mark"');
    expect(gameMenu).toContain("<span>WIZARDGANG</span>");
    expect(gameShell).toContain('rel="icon"');
    expect(gameShell).toContain("%23d9ff43");
    expect(gameShell).toContain("%23a489ff");
  });

  it("retires SharkTank-specific assurance and register copy from the runtime surface", () => {
    const runtime = worker + presentation + reactPresentation + gameShell;
    for (const text of [
      "ISO/IEC 27001",
      "ISO/IEC 42001",
      "Annex A",
      "certification readiness",
      'href="/controls/"',
      'href="/policies.json"',
      'href="/audit/manifest.json"',
    ]) expect(runtime).not.toContain(text);
    expect(runtime).not.toMatch(/governance/i);
    expect(reactPresentation).toContain("https://demo.wizardgang.ai/assurance");
    expect(gameMenu).not.toContain("Engineering case study");
  });

  it("keeps implementation history out of the runtime product surface", () => {
    const runtime = worker + presentation + reactPresentation;
    for (const text of [
      "ROADMAP_" + "MANIFEST",
      "Roadmap" + "Entry",
      "POST_DELIVERY_" + "ENTRIES",
      "PUBLIC_ROADMAP_" + "SUMMARIES",
      "/roadmap" + ".json",
      "Feature-to-" + "deployment map",
    ]) expect(runtime).not.toContain(text);
    expect(reactPresentation).toContain('label="Current release"');
    expect(worker).toContain('env.SHARKTANK_RELEASE ?? "development"');
  });
});
