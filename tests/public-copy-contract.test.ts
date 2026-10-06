import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const worker = read("../src/worker/index.ts");
const gameShell = read("../src/client/game-document.tsx");
const gameMenu = read("../src/game/ui/MainMenu.tsx");

describe("game public copy", () => {
  it("keeps the WizardGang mark and game name on the menu and shell", () => {
    expect(gameMenu).toContain('className="wizardgang-menu-mark"');
    expect(gameMenu).toContain("<span>WIZARDGANG</span>");
    expect(gameShell).toContain("Wizard Gang Shark Tank");
    expect(gameShell).toContain('rel="icon"');
  });

  it("keeps retired assurance and implementation history off the runtime surface", () => {
    const runtime = worker + gameShell + gameMenu;
    for (const text of ["ISO/IEC 27001", "ISO/IEC 42001", "certification readiness", "/roadmap.json", 'href="/controls/"']) {
      expect(runtime).not.toContain(text);
    }
    expect(gameMenu).not.toContain("Engineering case study");
  });
});
