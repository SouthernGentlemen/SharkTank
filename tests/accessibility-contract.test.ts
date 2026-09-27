import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const worker = read("../src/worker/index.ts");
const presentation = read("../src/worker/presentation.ts");
const reactPresentation = read("../src/worker/presentation-react.tsx");
const humanDocs = read("../src/client/human-docs.ts");
const routes = read("../src/worker/routes.ts");
const app = read("../vendor/ModuleReact3Fiber/src/client/App.tsx");
const focusTrap = read("../vendor/ModuleReact3Fiber/src/client/a11y/useFocusTrap.ts");
const input = read("../vendor/ModuleReact3Fiber/src/client/game/useLocalInput.ts");
const theme = read("../vendor/ModuleReact3Fiber/src/client/ui/theme.css");
const settings = read("../vendor/ModuleReact3Fiber/src/client/ui/Settings.tsx");

describe("public accessibility contract", () => {
  it("keeps a keyboard bypass, visible focus, contrast, motion, and hash focus handling on evidence pages", () => {
    expect(reactPresentation).toContain('className="skip-link" href="#main"');
    expect(reactPresentation).toContain('<main id="main" tabIndex={-1}>');
    expect(presentation).toContain(":focus-visible{outline:3px solid var(--focus)");
    expect(presentation).toContain("@media(prefers-reduced-motion:reduce)");
    expect(presentation).toContain("@media(prefers-contrast:more)");
    expect(humanDocs).toContain("target.focus({ preventScroll: true })");
  });



  it("keeps the game operable by keyboard with managed focus and reduced motion", () => {
    expect(app).toContain('className="skip-link" href="#main"');
    expect(app).toContain("regionRef.current?.focus()");
    expect(input).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(input).toContain("preventDefault()");
    expect(focusTrap).toContain('document.addEventListener("keydown", onKeyDown)');
    expect(focusTrap).toContain("last.focus()");
    expect(focusTrap).toContain("first.focus()");
    expect(focusTrap).toContain("previouslyFocused?.focus?.()");
    expect(theme).toContain("@media (prefers-reduced-motion: reduce)");
    expect(theme).toContain(":focus-visible");
    expect(settings).toContain('formatValue={(value) => `${Math.round(value * 100)}%`}');
  });
});

describe("canonical public information architecture", () => {
  it("keeps exactly three primary navigation destinations", () => {
    const nav = reactPresentation.match(/const PRIMARY_NAV = \[[\s\S]*?\n\] as const;/)?.[0] ?? "";
    expect(nav).toContain('["/", "Overview"]');
    expect(nav).toContain('["/evidence/", "Evidence"]');
    expect(nav).toContain('["/play/", "Play"]');
    expect(nav).not.toContain("/controls/");
    expect(nav.match(/^  \[/gm)).toHaveLength(3);
  });

  it("keeps only the canonical slash redirects and retires compatibility aliases", () => {
    expect(routes).not.toContain("HUMAN_REDIRECTS");
    expect(routes).toContain('return path === "/admin" || path.startsWith("/admin/");');

    expect(worker).toContain('if (path === "/play") return movedTo(url, "/play/");');
    expect(worker).toContain('if (path === "/evidence") return movedTo(url, "/evidence/");');
    expect(worker).toContain('if (path === "/favicon.ico") return new Response(null, { status: 404');
    expect(worker).toContain("if (path.startsWith(\"/api/\")) return json({ ok: false, error: \"unknown endpoint\" }, 404);");

    for (const retiredLiteral of [
      'path === "/api/lobby"',
      'path === "/inquiry.json"',
      'path === "/audit.json"',
      'path === "/audit.jsonl"',
      'path === "/audit/status.json"',
      "(?:admin|audit)",
      "(?:arena|uno|x4|21|game|checkers|battleship|3d|shark-?run)",
    ]) expect(worker).not.toContain(retiredLiteral);

    expect(worker).toContain('if (path === "/admin/status.json")');
    expect(worker).toContain('if (path === "/admin/log.json")');
    expect(worker).toContain('if (path === "/admin/log.jsonl")');
    expect(worker).toContain("path.match(/^\\/admin\\/game\\/");
    expect(worker).toContain("path.match(/^\\/admin\\/replay\\/");
  });

});
