import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderDowntimeDocument,
  renderNotFoundDocument,
  renderOverviewDocument,
} from "../src/worker/presentation-react.js";
import { html as htmlResponse } from "../src/worker/responses.js";

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
    expect(html).toContain('href="/evidence/"');
    expect(html).toContain('href="/play/"');
    expect(html).toContain('href="https://demo.wizardgang.ai/assurance"');
    expect(html).not.toMatch(/ISO\/IEC|Annex A|governance/i);
    expect(html).toContain('rel="canonical" href="https://sharktank.wizardgang.ai/"');
    expect(html).toContain('src="/assets/human-docs.js"');
    expect(html).toContain('nonce="__WG_CSP_NONCE__"');
    expect(source).not.toMatch(/hydrateRoot|createRoot|BrowserRouter|createBrowserRouter/);
  });

  it("serves maintenance with external styles and a strict generated response", async () => {
    const response = htmlResponse(
      renderDowntimeDocument({ enabled: true, changedAt: 1, reason: "Scheduled maintenance" }),
      503,
    );
    const csp = response.headers.get("content-security-policy") ?? "";
    const body = await response.text();

    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(body).toMatch(/<link rel="stylesheet" href="\/styles\/page-[^"]+\.css"/);
    expect(body).not.toMatch(/<style\b/i);
    expect(body).not.toMatch(/\sstyle=/i);
    expect(body).not.toMatch(/\son[a-z][a-z0-9_-]*\s*=/i);
  });

  it("keeps raw HTML confined to one audited generated-artifact boundary", () => {
    expect(source.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
    expect(source).toContain('type AuditedRawArtifactKind = "evidence" | "admin"');
    expect(source).not.toContain('data-raw-artifact="openapi"');
    expect(source).not.toContain("renderOpenApiDocument");
  });

  it("renders ordinary not-found and maintenance responses as complete React documents", () => {
    const notFound = renderNotFoundDocument();
    expect(notFound).toContain("<h1>Route not found</h1>");
    expect(notFound).toContain("The requested Shark Tank route does not exist.");
    expect(notFound).toContain('href="/play/"');

    const downtime = renderDowntimeDocument({ enabled: true, changedAt: 1, reason: "Scheduled maintenance" });
    expect(downtime).toMatch(/^<!doctype html><html lang="en">/);
    expect(downtime).toContain("<h1>The game is offline right now</h1>");
    expect(downtime).toContain("<strong>Scheduled maintenance</strong>");
    expect(downtime).toContain('href="/evidence/#availability"');
  });
});
