import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderDowntimeDocument,
  renderEvidenceDocument,
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

  it("renders the bounded evidence surface under worst-case synthetic log input", () => {
    const history = Array.from({ length: 60 }, (_, index) => ({
      sequence: index + 1,
      ts: Date.UTC(2026, 8, 1) + index,
      code: index === 58 ? "S500" : index === 59 ? "A600" : "O300",
      actor: "test",
      title: index === 58 ? "Historical security report" : index === 59 ? "Historical test alert" : `Control ${index + 1}`,
      summary: `Summary ${index + 1}`,
      reference: index === 58 ? "security-incident" : index === 59 ? "A600" : `control-${index + 1}`,
      detail: null,
      previousHash: "0".repeat(64),
      hash: (index + 1).toString(16).padStart(64, "0"),
    }));
    const captureRecords = Array.from({ length: 2_000 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 8, 1) + index).toISOString(),
      reasonCode: "G110",
      tick: index,
      action: "setHeading",
      name: "",
      details: `capture-only-${index}`,
    }));
    const html = renderEvidenceDocument(
      {
        maintenance: { enabled: false, changedAt: 0, reason: "" },
        rooms: [{ name: "Pacific", players: 2, bots: 6, capacity: 8, topScore: 7, topName: "Player" }],
        maintenanceIncidents: [
          { id: "security-incident", title: "Stored security report", cause: "Independent security report", status: "resolved" as const, startedAt: "2026-09-01T00:00:00.000Z", resolvedAt: "2026-09-01T00:05:00.000Z", summary: "Historical security report still renders." },
          { id: "test-alert-A600-historical", title: "Stored test alert", cause: "Test alert", status: "resolved" as const, startedAt: "2026-09-02T00:00:00.000Z", resolvedAt: "2026-09-02T00:00:00.000Z", summary: "Historical test alert still renders." },
        ],
        history,
        historyIntegrity: {
          mode: "append-only tamper-evident hash chain",
          algorithm: "SHA-256",
          entryCount: 60,
          headHash: history.at(-1)?.hash ?? null,
          verified: true,
          chainStatus: "verified" as const,
          anchorState: "verified" as const,
          checkedEntries: 50,
          coverage: "recent" as const,
        },
        billingWindow: { hardLimitUsd: 5 },
      },
      {
        serviceEvents: Array.from({ length: 5_000 }, (_, index) => ({
          ts: Date.UTC(2026, 8, 1) + index,
          type: "play",
          room: "room-1",
          subject: `player-${index}`,
          detail: `service-${index}`,
        })),
        tanks: ["room-1", "room-2", "room-3", "room-4"].map((room) => ({ room, records: captureRecords })),
        caps: { serviceTruncated: true, captureTruncated: true },
      },
    );

    const orderedIds = ["availability", "spend", "incidents", "receipts", "continuity", "logs"];
    const positions = orderedIds.map((id) => html.indexOf(`id="${id}"`));
    expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBe(true);
    const jump = html.match(/<nav class="evidence-jump"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
    expect([...jump.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])).toEqual(orderedIds);
    expect((html.match(/data-log-row="1"/g) ?? [])).toHaveLength(100);
    expect((html.match(/data-history-row="1"/g) ?? [])).toHaveLength(50);
    expect(html).not.toContain("capture-only-");
    expect(html).not.toContain('class="capture-table"');
    expect(html).not.toContain("Server availability");
    expect(html).not.toContain("status-portal-availability");
    expect(html).not.toContain('id="degradation"');
    expect(html).not.toContain('id="machine-data"');
    expect(html).toContain("Independent security report");
    expect(html).toContain("Test alert");
    expect(html).toContain('href="#receipt-59"');
    expect(html).toContain('href="#receipt-60"');
    for (const room of ["room-1", "room-2", "room-3", "room-4"]) expect(html).toContain(`href="/logs/game/${room}.txt"`);
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
