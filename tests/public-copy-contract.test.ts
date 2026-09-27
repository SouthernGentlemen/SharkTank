import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const worker = read("../src/worker/index.ts");
const presentation = read("../src/worker/presentation.ts");
const reactPresentation = read("../src/worker/presentation-react.tsx");
const conformance = read("../src/worker/conformance.ts");
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

  it("removes the retired explanatory blocks and game case-study link", () => {
    for (const text of [
      "Engineering case study",
      "Server availability is derived from the project-start window",
      "Scheduled tank downtime is tracked separately",
      "Records older than 24 hours are purged at the source",
      "The public evidence estate and the game’s menus",
    ]) expect(worker + presentation + reactPresentation + gameShell + gameMenu).not.toContain(text);

    for (const text of [
      "The implementation starts with the governed system",
      "The AI-system definition comes before the control mapping",
      "This is a readiness register, not a certificate",
      "Readiness counts only the controls this organisation has to close",
      "ISO/IEC 27001 asks for change control in four separate places",
    ]) expect(worker + presentation + conformance).not.toContain(text);
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
