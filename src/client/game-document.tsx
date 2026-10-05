import { renderToStaticMarkup } from "react-dom/server";

const GAME_FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20fill%3D%22%2308080b%22%2F%3E%3Crect%20x%3D%225%22%20y%3D%2215%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23d9ff43%22%2F%3E%3Crect%20x%3D%2215%22%20y%3D%225%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22%23a489ff%22%2F%3E%3C%2Fsvg%3E";

function GameDocument() {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#0b0a14" />
        <meta name="mobile-web-app-capable" content="yes" />
        <title>Play SharkTank — WizardGang</title>
        <meta
          name="description"
          content="Play the realtime multiplayer SharkTank game backed by authoritative Cloudflare Durable Objects."
        />
        <link rel="canonical" href="https://sharktank.wizardgang.ai/play/" />
        <meta property="og:title" content="Play SharkTank — WizardGang" />
        <meta
          property="og:description"
          content="The realtime multiplayer SharkTank game backed by authoritative server state."
        />
        <meta property="og:url" content="https://sharktank.wizardgang.ai/play/" />
        <meta property="og:type" content="website" />
        <meta
          property="og:image"
          content="https://sharktank.wizardgang.ai/sharktank-art.jpg"
        />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href={GAME_FAVICON} />
      </head>
      <body>
        <div id="root">
          <main id="boot">
            <h1>Wizard Gang Shark Tank</h1>
            <p>
              Realtime multiplayer Shark Tank. Swim a shark in SharkTank, eat to grow,
              and race the leaderboard. The game is loading.
            </p>
          </main>
        </div>
        <script type="module" src="/src/client/main.tsx" />
      </body>
    </html>
  );
}

export function renderGameDocument(): string {
  return "<!doctype html>" + renderToStaticMarkup(<GameDocument />);
}
