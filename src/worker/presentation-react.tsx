import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PAGE_CSS_PATH } from "./presentation.js";

const CSP_NONCE_SLOT = "__WG_CSP_NONCE__";
const HUMAN_DOCS_MODULE = "/assets/human-docs.js";
const WIZARDGANG_FAVICON = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%2308080b%22%2F%3E%3Crect%20x%3D%225%22%20y%3D%2215%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23d9ff43%22%2F%3E%3Crect%20x%3D%2215%22%20y%3D%225%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23a489ff%22%2F%3E%3C%2Fsvg%3E";

const PRIMARY_NAV = [
  ["/", "Overview"],
  ["/play/", "Play"],
] as const;

const ESTATE_FOOTER = [
  ["Public", [["/", "Overview"], ["/play/", "Play"]]],
  ["Release", [["/version.json", "Version JSON"]]],
  ["Technical", [["https://github.com/Wizard-Gang/SharkTank", "GitHub source"]]],
] as const;

interface DocumentMetadata {
  title: string;
  description?: string;
  canonicalPath?: string;
}

interface OverviewPresentationInput {
  tank: { availabilityPercent: number; windowLabel: string };
  integrity: { chainStatus?: string; entryCount: number; algorithm: string };
  spendUsd: number;
  hardLimitUsd: number;
  release: string;
  environment: string;
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="WizardGang SharkTank home">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-copy"><strong>WIZARDGANG</strong><small>SharkTank</small></span>
    </a>
  );
}

function PrimaryNavigation() {
  return (
    <nav aria-label="Primary">
      {PRIMARY_NAV.map(([href, label]) => <a href={href} key={href}>{label}</a>)}
    </nav>
  );
}

function EstateFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <nav aria-label="All pages on this service">
          {ESTATE_FOOTER.map(([heading, links]) => (
            <div className="footer-col" key={heading}>
              <span className="footer-head">{heading}</span>
              <ul>
                {links.map(([href, label]) => <li key={href}><a href={href}>{label}</a></li>)}
              </ul>
            </div>
          ))}
        </nav>
        <p className="footer-note">
          SharkTank is the game. Operator tools remain protected; public release identity stays at /version.json.
        </p>
      </div>
    </footer>
  );
}

function DocumentHead({ title, description = "", canonicalPath = "" }: DocumentMetadata) {
  const canonical = canonicalPath ? "https://sharktank.wizardgang.ai" + canonicalPath : "";
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="theme-color" content="#0b0a14" />
      <title>{title}</title>
      {description ? <meta name="description" content={description} /> : null}
      {canonical ? <>
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://sharktank.wizardgang.ai/sharktank-art.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
      </> : null}
      <link rel="icon" href={WIZARDGANG_FAVICON} />
      <link rel="stylesheet" href={PAGE_CSS_PATH} />
    </head>
  );
}

function DocumentChrome({ metadata, main }: { metadata: DocumentMetadata; main: ReactNode }) {
  return (
    <html lang="en">
      <DocumentHead {...metadata} />
      <body>
        <a className="skip-link" href="#main">Skip to main content</a>
        <header className="site-header"><Brand /><PrimaryNavigation /></header>
        {main}
        <EstateFooter />
        <script type="module" nonce={CSP_NONCE_SLOT} src={HUMAN_DOCS_MODULE} />
      </body>
    </html>
  );
}

function renderDocument(metadata: DocumentMetadata, main: ReactNode): string {
  return "<!doctype html>" + renderToStaticMarkup(<DocumentChrome metadata={metadata} main={main} />);
}

function ProofTile({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <div className={"trust-tile " + tone}>
      <span className="trust-tile__label">{label}</span>
      <span className="trust-tile__value">{value}</span>
      <span className="trust-tile__detail">{detail}</span>
    </div>
  );
}


function OverviewMain({ input }: { input: OverviewPresentationInput }) {
  const chainOk = input.integrity.chainStatus === "verified";
  return (
    <main id="main" tabIndex={-1}>
      <section className="home-hero">
        <div className="home-hero__copy">
          <div className="eyebrow">Realtime multiplayer Shark Tank</div>
          <h1>Play SharkTank.</h1>
          <p>SharkTank is a realtime multiplayer game backed by authoritative Cloudflare Durable Objects. Swim a shark, grow, and race the leaderboard while the same service exposes a concise live operations snapshot.</p>
          <div className="action-links">
            <a className="button" href="/play/">Play →</a>
            <a className="button secondary" href="https://github.com/Wizard-Gang/SharkTank">GitHub →</a>
            <a className="button secondary" href="https://demo.wizardgang.ai/assurance">Portfolio assurance →</a>
          </div>
        </div>
        <figure className="workload-art">
          <img src="/sharktank-art.jpg" width="1280" height="720" alt="SharkTank main menu showing the realtime multiplayer game" />
          <figcaption>Realtime game · live service</figcaption>
        </figure>
      </section>
      <section aria-labelledby="live-snapshot">
        <div className="section-head"><div><div className="eyebrow">Live snapshot</div><h2 id="live-snapshot">Current service state.</h2></div></div>
        <div className="trust-grid">
          <ProofTile label="Tank availability" value={input.tank.availabilityPercent + "%"} detail={input.tank.windowLabel + " from recorded incidents"} tone="tone-green" />
          <ProofTile label="Metered resource cost" value={"$" + input.spendUsd.toFixed(4)} detail={"of the $" + input.hardLimitUsd.toFixed(2) + " displayed threshold"} tone="tone-cyan" />
          <ProofTile label="Current release" value={input.release} detail={input.environment + " environment"} tone="tone-cyan" />
          <ProofTile label="Receipt chain" value={chainOk ? "Verified" : "Unverified"} detail={input.integrity.entryCount + " receipts · " + input.integrity.algorithm} tone={chainOk ? "tone-green" : "tone-red"} />
        </div>
      </section>
    </main>
  );
}

export function renderOverviewDocument(input: OverviewPresentationInput): string {
  return renderDocument(
    {
      title: "SharkTank — Realtime multiplayer game",
      description: "Play the realtime multiplayer SharkTank game and inspect the current live-service snapshot and release identity.",
      canonicalPath: "/",
    },
    <OverviewMain input={input} />,
  );
}


export function renderNotFoundDocument(): string {
  return renderDocument(
    {
      title: "Shark Tank — Route not found",
      description: "The requested Shark Tank route does not exist.",
    },
    <main id="main" tabIndex={-1}>
      <section>
        <p className="eyebrow">404</p>
        <h1>Route not found</h1>
        <p>This Shark Tank route does not exist.</p>
        <p><a className="button" href="/play/">Play Shark Tank</a></p>
      </section>
    </main>,
  );
}
