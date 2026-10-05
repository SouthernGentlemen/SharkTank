import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderNotFoundDocument,
  renderOverviewDocument,
} from "../src/worker/presentation-react.js";

const source = readFileSync(new URL("../src/worker/presentation-react.tsx", import.meta.url), "utf8");

describe("React Worker presentation", () => {
  it("renders complete static documents without a hydration boundary", () => {
    const html = renderOverviewDocument({
      tank: { availabilityPercent: 99.5, windowLabel: "1 day" },
      integrity: { chainStatus: "verified", entryCount: 2, algorithm: "SHA-256" },
      spendUsd: 0.0123,
      hardLimitUsd: 5,
      release: "v1.3.7",
      environment: "production",
    });

    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toContain('<a class="skip-link" href="#main">Skip to main content</a>');
    expect(html).toContain('<main id="main" tabindex="-1">');
    expect(html).toContain("<h1>Play SharkTank.</h1>");
    expect(html).toContain('<nav aria-label="Primary">');
    expect(html).toContain("Current release");
    expect(html).toContain("v1.3.7");
    expect(html).not.toContain('href="/evidence/"');
    expect(html).toContain('href="/play/"');
    expect(html).toContain('href="https://demo.wizardgang.ai/assurance"');
    expect(html).not.toMatch(/ISO\/IEC|Annex A|governance/i);
    expect(html).toContain('rel="canonical" href="https://sharktank.wizardgang.ai/"');
    expect(html).toContain('src="/assets/human-docs.js"');
    expect(html).toContain('nonce="__WG_CSP_NONCE__"');
    expect(source).not.toMatch(/hydrateRoot|createRoot|BrowserRouter|createBrowserRouter/);
  });

  it("has no raw operator document insertion boundary", () => {
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("renderAdminDocument");
    expect(source).not.toContain("renderDowntimeDocument");
  });

  it("renders not-found responses as complete React documents", () => {
    const notFound = renderNotFoundDocument();
    expect(notFound).toContain("<h1>Route not found</h1>");
    expect(notFound).toContain("The requested Shark Tank route does not exist.");
    expect(notFound).toContain('href="/play/"');

  });
});
