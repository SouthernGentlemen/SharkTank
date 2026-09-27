#!/usr/bin/env node

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const canonical = ["/", "/evidence/", "/play/"];
const redirects = {
  "/trust": "/", "/trust/": "/",
  "/status": "/evidence/#availability", "/status/": "/evidence/#availability",
  "/incidents": "/evidence/#incidents", "/incidents/": "/evidence/#incidents",
  "/logs": "/evidence/#logs", "/logs/": "/evidence/#logs",
  "/spend": "/evidence/#spend", "/spend/": "/evidence/#spend",
  "/inquiry": "/evidence/#spend", "/inquiry/": "/evidence/#spend",
};

const failures = [];
const fail = (message) => failures.push(message);
const request = (path, redirect = "manual") => fetch(`${base}${path}`, { redirect, headers: { "cache-control": "no-cache" } });
const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const hrefs = (html) => [...html.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));

function assertStrictPresentation(path, response, html) {
  const csp = response.headers.get("content-security-policy") || "";
  if (csp.includes("'unsafe-inline'")) fail(`${path} CSP still allows unsafe-inline: ${csp}`);
  if (/\sstyle\s*=/i.test(html)) fail(`${path} emitted a style attribute`);
  if (/<style\b/i.test(html)) fail(`${path} emitted an embedded style block`);
  if (/\son[a-z][a-z0-9_-]*\s*=/i.test(html)) fail(`${path} emitted an inline event-handler attribute`);
  const cspNonce = csp.match(/'nonce-([^']+)'/)?.[1] || "";
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] || "";
    if (/\ssrc\s*=/.test(attrs)) continue;
    const nonce = attrs.match(/\snonce="([^"]+)"/)?.[1] || "";
    if (!nonce || nonce !== cspNonce) fail(`${path} emitted an inline script without the response CSP nonce`);
  }
}

function assertNotGameDocument(path, html) {
  if (html.includes('<div id="root">') || html.includes("Wizard Gang Shark Tank")) {
    fail(`${path} unexpectedly received the /play/ game document`);
  }
}

async function verifyRoomWebSocket() {
  const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  let socket;
  try {
    const welcome = await new Promise((resolve, reject) => {
      socket = new WebSocket(`${wsBase}/room/room-1/ws?roomName=Tank%201`);
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      timer = setTimeout(() => finish(new Error("timed out waiting for welcome")), 5_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "hello", name: "Acceptance Shark", skin: "cyan", debugLanguage: "ts" })), { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message?.t === "welcome") finish(null, message);
      });
      socket.addEventListener("error", () => finish(new Error("WebSocket error")), { once: true });
      socket.addEventListener("close", (event) => { if (!settled) finish(new Error(`closed before welcome (code ${event.code})`)); }, { once: true });
    });
    if (welcome?.roomId !== "room-1") fail(`WebSocket welcome expected room-1, got ${welcome?.roomId}`);
    if (typeof welcome?.youId !== "string" || !welcome.youId) fail("WebSocket welcome lost player identity");
    if (!welcome?.state || typeof welcome.state.tick !== "number") fail("WebSocket welcome lost authoritative room state");

    const staleFrameSurvived = await new Promise((resolve) => {
      let settled = false;
      const ts = Date.now();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, 2_000);
      const onMessage = (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message?.t !== "pong" || message.ts !== ts) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        resolve(true);
      };
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ t: "debug", language: "ts" }));
      socket.send(JSON.stringify({ t: "ping", ts }));
    });
    if (!staleFrameSurvived) fail("legacy debug frame disconnected the room socket");
  } catch (error) {
    fail(`Room WebSocket acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { socket?.close(); } catch { /* already closed */ }
  }
}

async function main() {
  const pages = new Map();
  for (const path of canonical) {
    const response = await request(path);
    if (response.status !== 200) { fail(`${path} expected 200, got ${response.status}`); continue; }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("text/html")) fail(`${path} expected HTML content type, got ${contentType || "none"}`);
    for (const [header, expected] of [
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "DENY"],
      ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
      ["strict-transport-security", "max-age=31536000; includeSubDomains"],
    ]) {
      if (response.headers.get(header) !== expected) fail(`${path} expected ${header}: ${expected}, got ${response.headers.get(header)}`);
    }
    const csp = response.headers.get("content-security-policy") || "";
    if (!csp.includes("default-src 'self'")) fail(`${path} is missing the expected CSP default-src`);
    const html = await response.text();
    assertStrictPresentation(path, response, html);
    for (const retiredClaim of ["ISO/IEC 27001", "ISO/IEC 42001", "Annex A", "certification readiness"]) {
      if (html.includes(retiredClaim)) fail(`${path} still publishes retired assurance copy: ${retiredClaim}`);
    }
    if (/governance/i.test(html)) fail(`${path} still publishes retired governance wording`);
    pages.set(path, html);
    const canonicalHref = `https://sharktank.wizardgang.ai${path}`;
    if (!html.includes(`<link rel="canonical" href="${canonicalHref}"`)) fail(`${path} is missing canonical link ${canonicalHref}`);
    if (path !== "/play/" && response.headers.get("cache-control") !== "no-store") fail(`${path} expected cache-control no-store`);
    if (path !== "/play/" && !html.includes('<nav aria-label="Primary">')) fail(`${path} is missing the primary navigation`);
    if (path !== "/play/" && (html.match(/<h1(?:\s|>)/g) || []).length !== 1) fail(`${path} must contain exactly one h1`);
    if (path !== "/play/") {
      const pageIds = ids(html);
      const duplicates = [...new Set(pageIds.filter((id, index) => pageIds.indexOf(id) !== index))];
      if (duplicates.length) fail(`${path} repeats id(s): ${duplicates.join(", ")}`);
    }

    if (path === "/play/") {
      if (!html.includes('<div id="root">')) fail("/play/ lost the React game mount point");
      if (!html.includes('<main id="boot">')) fail("/play/ lost the pre-mount loading document");
      if (!html.includes("<h1>Wizard Gang Shark Tank</h1>")) fail("/play/ lost the game identity before mount");
      if (!html.includes("The game is loading.")) fail("/play/ lost its loading context");
      if (!html.includes('href="/evidence/"')) fail("/play/ lost its route to live evidence");

      const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>/g)].map((match) => match[1]);
      const gameEntry = scriptPaths.find((assetPath) => /^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(assetPath));
      if (!gameEntry) fail(`/play/ does not reference a content-hashed Vite game entry: ${JSON.stringify(scriptPaths)}`);

      const stylePaths = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g)].map((match) => match[1]);
      if (!stylePaths.some((assetPath) => /^\/assets\/index-[A-Za-z0-9_-]+\.css$/.test(assetPath))) {
        fail(`/play/ does not reference content-hashed Vite CSS: ${JSON.stringify(stylePaths)}`);
      }

      if (gameEntry) {
        const entryResponse = await request(gameEntry);
        if (entryResponse.status !== 200) {
          fail(`game entry ${gameEntry} expected 200, got ${entryResponse.status}`);
        } else {
          const entrySource = await entryResponse.text();
          const lazyChunks = [...new Set(
            [...entrySource.matchAll(/\.\/([A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.js)/g)]
              .map((match) => `/assets/${match[1]}`)
              .filter((assetPath) => assetPath !== gameEntry),
          )];
          if (!lazyChunks.length) fail(`game entry ${gameEntry} no longer references a content-hashed lazy chunk`);
          for (const lazyChunk of lazyChunks) {
            const lazyResponse = await request(lazyChunk);
            if (lazyResponse.status !== 200) fail(`lazy game chunk ${lazyChunk} expected 200, got ${lazyResponse.status}`);
          }
        }
      }
    }
  }

  const health = await request("/api/health");
  if (health.status !== 200) fail(`/api/health expected 200, got ${health.status}`);
  if (!(health.headers.get("content-type") || "").startsWith("application/json")) fail("/api/health must remain JSON");
  if (health.headers.get("cache-control") !== "no-store") fail("/api/health must remain no-store");
  if (health.headers.get("x-content-type-options") !== "nosniff") fail("/api/health is missing shared security headers");
  const healthBody = await health.json().catch(() => null);
  if (!healthBody?.ok || healthBody.module !== "module-react3fiber") fail("/api/health response shape changed");

  for (const [path, arrayField] of [["/api/tank", "rooms"], ["/api/leaderboard", "entries"]]) {
    const response = await request(path);
    if (response.status !== 200) { fail(`${path} expected 200, got ${response.status}`); continue; }
    const body = await response.json().catch(() => null);
    if (!body?.ok || !Array.isArray(body?.[arrayField])) fail(`${path} response shape changed`);
  }

  const profile = await request("/api/profile");
  if (profile.status !== 200) fail(`/api/profile expected 200, got ${profile.status}`);
  const profileBody = await profile.json().catch(() => null);
  if (!profileBody?.ok || !profileBody?.profile) fail("/api/profile response shape changed");

  const roomWithoutUpgrade = await request("/room/room-1/ws");
  if (roomWithoutUpgrade.status !== 426) fail(`non-upgraded room route expected 426, got ${roomWithoutUpgrade.status}`);
  await verifyRoomWebSocket();

  const unknownApi = await request("/api/not-a-real-endpoint");
  if (unknownApi.status !== 404) fail(`unknown API expected 404, got ${unknownApi.status}`);
  if (!(unknownApi.headers.get("content-type") || "").startsWith("application/json")) fail("unknown API must remain JSON rather than human HTML");
  const unknownApiBody = await unknownApi.json().catch(() => null);
  if (unknownApiBody?.error !== "unknown endpoint") fail("unknown API response body changed");

  for (const retiredPath of [
    "/controls", "/controls/",
    "/iso-27001", "/iso-27001/",
    "/iso-42001", "/iso-42001/",
    "/audit", "/audit/",
    "/policies", "/policies/",
    "/policies/context", "/policies/context/",
    "/policies/ai-policy", "/policies/ai-policy/",
    "/policies.json", "/audit/manifest.json",
  ]) {
    const retired = await request(retiredPath);
    if (retired.status !== 404) fail(`${retiredPath} expected retired assurance surface to return 404, got ${retired.status}`);
    if (retired.headers.has("location")) fail(`${retiredPath} must not redirect after retirement`);
    const retiredBody = await retired.text();
    assertStrictPresentation(retiredPath, retired, retiredBody);
    assertNotGameDocument(retiredPath, retiredBody);
  }

  for (const retiredPath of ["/roadmap", "/roadmap/", "/roadmap.json"]) {
    const retired = await request(retiredPath);
    if (retired.status !== 404) fail(`${retiredPath} expected retired implementation-history surface to return 404, got ${retired.status}`);
    const retiredBody = await retired.text();
    assertStrictPresentation(retiredPath, retired, retiredBody);
    assertNotGameDocument(retiredPath, retiredBody);
  }

  const retiredRuntimeRoot = "/" + ["p", "h", "p"].join("");
  for (const retiredPath of [
    retiredRuntimeRoot,
    retiredRuntimeRoot + "/",
    "/ts",
    "/ts/",
    retiredRuntimeRoot + "-api/health",
    retiredRuntimeRoot + "-room",
  ]) {
    const retired = await request(retiredPath);
    if (retired.status !== 404) fail(`${retiredPath} expected retired runtime surface to return 404, got ${retired.status}`);
    const retiredBody = await retired.text();
    assertStrictPresentation(retiredPath, retired, retiredBody);
    assertNotGameDocument(retiredPath, retiredBody);
  }

  const unknownPage = await request("/not-a-real-route");
  if (unknownPage.status !== 404) fail(`unknown human route expected 404, got ${unknownPage.status}`);
  if (!(unknownPage.headers.get("content-type") || "").startsWith("text/html")) fail("unknown human route must remain HTML");
  if (unknownPage.headers.get("cache-control") !== "no-store") fail("unknown human route must remain no-store");
  const unknownHtml = await unknownPage.text();
  assertStrictPresentation("/not-a-real-route", unknownPage, unknownHtml);
  assertNotGameDocument("/not-a-real-route", unknownHtml);
  if (!unknownHtml.includes("<h1>Route not found</h1>")) fail("unknown human route lost its not-found presentation");

  const nestedClientRoute = await request("/play/not-a-client-route");
  if (nestedClientRoute.status !== 404) fail(`nested /play/ path expected 404, got ${nestedClientRoute.status}`);
  const nestedClientHtml = await nestedClientRoute.text();
  assertStrictPresentation("/play/not-a-client-route", nestedClientRoute, nestedClientHtml);
  assertNotGameDocument("/play/not-a-client-route", nestedClientHtml);

  const rawIndex = await request("/index.html");
  if (rawIndex.status !== 404) fail(`raw /index.html expected Worker 404, got ${rawIndex.status}`);
  const rawIndexHtml = await rawIndex.text();
  assertStrictPresentation("/index.html", rawIndex, rawIndexHtml);
  assertNotGameDocument("/index.html", rawIndexHtml);

  const missingAsset = await request("/assets/not-a-real-asset.js");
  if (missingAsset.status !== 404) fail(`unknown static asset expected 404, got ${missingAsset.status}`);
  if ((missingAsset.headers.get("content-type") || "").startsWith("text/html")) fail("unknown static asset must not receive an HTML document");
  if (missingAsset.headers.get("x-content-type-options") !== "nosniff") fail("unknown static asset is missing shared security headers");
  const missingAssetCsp = missingAsset.headers.get("content-security-policy") || "";
  if (missingAssetCsp.includes("'unsafe-inline'")) fail("unknown static asset CSP still allows unsafe-inline");
  assertNotGameDocument("/assets/not-a-real-asset.js", await missingAsset.text());

  const adminDenied = await request("/admin/");
  if (adminDenied.status !== 401) fail(`unauthenticated /admin/ expected 401, got ${adminDenied.status}`);
  if (!(adminDenied.headers.get("www-authenticate") || "").startsWith("Basic realm=")) fail("unauthenticated /admin/ lost its authentication challenge");
  const auth = Buffer.from("ops:local-acceptance-only").toString("base64");
  const admin = await fetch(`${base}/admin/`, { redirect: "manual", headers: { authorization: `Basic ${auth}`, "cache-control": "no-cache" } });
  if (admin.status !== 200) fail(`authenticated /admin/ expected 200, got ${admin.status}`);
  if (!(admin.headers.get("content-type") || "").startsWith("text/html")) fail("authenticated /admin/ must remain HTML");
  if (admin.headers.get("cache-control") !== "no-store") fail("authenticated /admin/ must remain no-store");
  const adminHtml = await admin.text();
  assertStrictPresentation("/admin/", admin, adminHtml);
  if (!adminHtml.includes("<h1>Admin</h1>")) fail("authenticated /admin/ lost its control-room content");
  if (adminHtml.includes('href="/controls/')) fail("authenticated /admin/ still links to the retired register");

  const retiredSwitch = await fetch(`${base}/admin/switch`, {
    redirect: "manual",
    headers: { authorization: `Basic ${auth}`, "cache-control": "no-cache" },
  });
  if (retiredSwitch.status !== 404) fail(`authenticated /admin/switch expected 404, got ${retiredSwitch.status}`);
  const retiredSwitchHtml = await retiredSwitch.text();
  assertStrictPresentation("/admin/switch", retiredSwitch, retiredSwitchHtml);
  assertNotGameDocument("/admin/switch", retiredSwitchHtml);

  const docs = await request("/docs/");
  if (docs.status !== 200) fail(`/docs/ expected 200, got ${docs.status}`);
  if (!(docs.headers.get("content-type") || "").startsWith("text/html")) fail("/docs/ must remain HTML");
  const docsHtml = await docs.text();
  assertStrictPresentation("/docs/", docs, docsHtml);
  if (!docsHtml.includes("OpenAPI")) fail("/docs/ lost its OpenAPI presentation");

    const home = pages.get("/") || "";
  const headerNav = home.match(/<header[\s\S]*?<nav aria-label="Primary">([\s\S]*?)<\/nav>/)?.[1] || "";
  const primaryLinks = [...headerNav.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((match) => [match[1], match[2]]);
  if (JSON.stringify(primaryLinks) !== JSON.stringify([["/", "Overview"], ["/evidence/", "Evidence"], ["/play/", "Play"]])) fail(`primary navigation is not the three-route contract: ${JSON.stringify(primaryLinks)}`);

  const checkedInternalLinks = new Map();
  for (const [sourcePath, html] of pages) {
    if (sourcePath === "/play/") continue;
    const sourceUrl = new URL(sourcePath, base);
    for (const href of new Set(hrefs(html))) {
      if (/^(?:https?:|mailto:|tel:)/.test(href)) continue;
      const target = new URL(href, sourceUrl);
      if (target.origin !== new URL(base).origin) continue;
      const targetPath = target.pathname;
      const targetPage = pages.get(targetPath);
      if (target.hash && targetPage) {
        const id = decodeURIComponent(target.hash.slice(1));
        if (!ids(targetPage).includes(id)) fail(`${sourcePath} links to missing ${targetPath}#${id}`);
      }
      if (redirects[targetPath]) fail(`${sourcePath} links through legacy route ${targetPath}`);
      if (!checkedInternalLinks.has(targetPath)) {
        const direct = await request(targetPath);
        checkedInternalLinks.set(targetPath, direct.status);
      }
      const status = checkedInternalLinks.get(targetPath);
      if (status >= 300 && status < 400) fail(`${sourcePath} links through redirecting internal route ${targetPath} (${status})`);
      if (status >= 400) fail(`${sourcePath} links to missing internal route ${targetPath} (${status})`);
    }
  }

  const assetPaths = new Set();
  for (const html of pages.values()) {
    for (const match of html.matchAll(/\ssrc="(\/[^"?#]+\.(?:jpg|png|svg|css|js)(?:\?[^"#]*)?)"/g)) assetPaths.add(match[1]);
    for (const match of html.matchAll(/<link\s[^>]*href="(\/[^"?#]+\.css(?:\?[^"#]*)?)"/g)) assetPaths.add(match[1]);
  }
  for (const path of assetPaths) {
    const response = await request(path);
    if (response.status !== 200) fail(`asset ${path} expected 200, got ${response.status}`);
    const assetCsp = response.headers.get("content-security-policy") || "";
    if (assetCsp.includes("'unsafe-inline'")) fail(`asset ${path} CSP still allows unsafe-inline`);
  }

  for (const [from, to] of Object.entries(redirects)) {
    const response = await request(from);
    if (response.status !== 301) { fail(`${from} expected 301, got ${response.status}`); continue; }
    if (response.headers.get("location") !== to) fail(`${from} expected Location ${to}, got ${response.headers.get("location")}`);
    const destination = new URL(to, base);
    const final = await request(destination.pathname);
    if (final.status >= 300 && final.status < 400) fail(`${from} redirects into another redirect at ${destination.pathname}`);
    const finalHtml = await final.text();
    if (destination.hash && !ids(finalHtml).includes(destination.hash.slice(1))) fail(`${from} targets missing fragment ${to}`);
  }

  const queryRedirect = await request("/status/?source=legacy");
  if (queryRedirect.headers.get("location") !== "/evidence/?source=legacy#availability") fail("legacy redirects do not preserve query strings before fragments");

  const sitemap = await (await request("/sitemap.xml")).text();
  const listed = [...sitemap.matchAll(/<loc>https:\/\/sharktank\.wizardgang\.ai([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (JSON.stringify(listed) !== JSON.stringify(canonical)) fail(`sitemap is not canonical-only: ${JSON.stringify(listed)}`);

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(`\n${failures.length} public IA check(s) failed.`);
    process.exit(1);
  }
  console.log(`Verified ${canonical.length} canonical pages, strict no-unsafe-inline CSP/generated-HTML contracts, explicit /play/ Static Assets routing with hashed/lazy Vite assets, application/index/asset misses that cannot fall back to the game document, OpenAPI/admin/404 HTML, health/tank/profile/leaderboard APIs, a live Room Durable Object WebSocket welcome plus 426 non-upgrade behavior, primary navigation, unique IDs, internal anchors, assets, ${Object.keys(redirects).length} one-hop redirects, query preservation, and canonical sitemap.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
