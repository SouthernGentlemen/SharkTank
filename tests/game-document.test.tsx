import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderGameDocument } from "../src/client/game-document.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../src/client/game-document.tsx");
const indexSource = read("../index.html");
const viteSource = read("../vite.config.ts");
const wranglerSource = read("../wrangler.jsonc");
const workerSource = read("../src/worker/index.ts");
const mainSource = read("../src/client/main.tsx");
const humanDocsSource = read("../src/client/human-docs.ts");
const workerPresentationSource = read("../src/worker/presentation-react.tsx");
const appSource = read("../vendor/ModuleReact3Fiber/src/client/App.tsx");
const mountedPresentationSource = [
  "../vendor/ModuleReact3Fiber/src/client/App.tsx",
  "../vendor/ModuleReact3Fiber/src/client/game/GameCanvas.tsx",
  "../vendor/ModuleReact3Fiber/src/client/settings/SettingsContext.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Captions.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Customize.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/GameScreen.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/HelpOverlay.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Leaderboard.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Lobby.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/MainMenu.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Minimap.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/PauseMenu.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/Settings.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/SnakeLabels.tsx",
  "../vendor/ModuleReact3Fiber/src/client/ui/TouchControls.tsx",
].map(read).join("\n");

describe("React game document", () => {
  it("renders the complete /play/ shell and metadata from TSX", () => {
    const html = renderGameDocument();

    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain("<title>Play SharkTank — WizardGang</title>");
    expect(html).toContain(
      'rel="canonical" href="https://sharktank.wizardgang.ai/play/"',
    );
    expect(html).toContain('property="og:url" content="https://sharktank.wizardgang.ai/play/"');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('id="root"');
    expect(html).toContain('id="boot"');
    expect(html).toContain("<h1>Wizard Gang Shark Tank</h1>");
    expect(html).toContain("The game is loading.");
    expect(html).toContain('href="/evidence/"');
    expect(html).toContain('<script type="module" src="/src/client/main.tsx"></script>');
    expect(source).toContain("renderToStaticMarkup(<GameDocument />)");
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z][a-z0-9_-]*\s*=/i);
  });

  it("keeps the mounted game UI free of DOM inline-style surfaces", () => {
    expect(mountedPresentationSource).not.toMatch(/\bstyle\s*=/);
    expect(mountedPresentationSource).not.toContain(".style.setProperty(");
    expect(mountedPresentationSource).not.toMatch(/setAttribute\(\s*["']style["']/);
  });

  it("keeps index.html as only the Vite entry sentinel", () => {
    expect(indexSource).toContain("wg-game-document-source");
    expect(indexSource).not.toContain('id="root"');
    expect(indexSource).not.toContain("Wizard Gang Shark Tank");
    expect(indexSource).not.toContain("/src/client/main.tsx");
    expect(viteSource).toContain('name: "sharktank-react-game-document"');
    expect(viteSource).toContain('order: "pre"');
    expect(viteSource).toContain("handler: () => renderGameDocument()");
  });

  it("keeps Vite in charge of the browser entry and lazy content-hashed chunks", () => {
    expect(viteSource).toMatch(/assets\/\[name\]-\[hash\]\.js/);
    expect(mainSource).toContain("createRoot(el).render(");
    expect(mainSource).toContain('import "./styles.css"');
    expect(appSource).toContain('lazy(() => import("./ui/GameScreen.js")');
  });

  it("makes the game document explicit instead of using a repository-wide SPA fallback", () => {
    expect(wranglerSource).toContain('"html_handling": "none"');
    expect(wranglerSource).toContain('"not_found_handling": "none"');
    expect(wranglerSource).not.toContain('"single-page-application"');
    expect(workerSource).toContain('new Request(new URL("/index.html", request.url)');
    expect(workerSource).toContain("if (!gameShell && !staticAsset)");
  });

  it("keeps the game client separate from non-game static documents", () => {
    expect(mainSource).not.toMatch(/BrowserRouter|createBrowserRouter/);
    expect(source).not.toMatch(/BrowserRouter|createBrowserRouter|hydrateRoot/);
    expect(workerPresentationSource + humanDocsSource).not.toMatch(
      /hydrateRoot|createRoot|BrowserRouter|createBrowserRouter/,
    );
  });
});
