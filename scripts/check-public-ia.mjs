#!/usr/bin/env node

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const canonical = ["/", "/evidence/", "/play/"];
const slashRedirects = {
  "/play": "/play/",
  "/evidence": "/evidence/",
};
const retiredHumanPaths = [
  "/trust", "/trust/",
  "/status", "/status/",
  "/incidents", "/incidents/",
  "/logs", "/logs/",
  "/spend", "/spend/",
  "/inquiry", "/inquiry/",
];
const retiredGamePaths = [
  "/arena", "/uno", "/x4", "/21", "/game", "/checkers", "/battleship", "/3d",
  "/shark-run", "/sharkrun", "/arena/legacy",
];
const retiredOperatorAliases = [
  "/audit.json",
  "/audit.jsonl",
  "/audit/status.json",
  "/audit/game/room-1",
  "/audit/game/room-1.json",
  "/audit/game/room-1.jsonl",
  "/audit/replay/room-1",
  "/audit/replay/room-1.json",
  "/admin/security-report",
  "/admin/security-resolve",
  "/admin/test-alert",
];
const isRetiredTarget = (path) =>
  retiredHumanPaths.includes(path) ||
  retiredGamePaths.includes(path) ||
  path === "/api/lobby" ||
  path === "/api/leaderboard" ||
  path === "/api/security-report" ||
  path === "/docs" || path === "/docs/" ||
  path === "/openapi.json" || path === "/docs/openapi.json" ||
  path === "/incidents.json" || path === "/logs.json" ||
  path === "/inquiry.json" ||
  path === "/audit.json" ||
  path === "/audit.jsonl" ||
  path === "/audit/status.json" ||
  path.startsWith("/audit/game/") ||
  path.startsWith("/audit/replay/");

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
      socket = new WebSocket(`${wsBase}/room/room-1/ws`);
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      timer = setTimeout(() => finish(new Error("timed out waiting for welcome")), 5_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ v: 11, t: "hello", name: "Acceptance Shark", skin: "cyan", debugLanguage: "ts" })), { once: true });
      socket.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message?.t === "welcome") finish(null, message);
      });
      socket.addEventListener("error", () => finish(new Error("WebSocket error")), { once: true });
      socket.addEventListener("close", (event) => { if (!settled) finish(new Error(`closed before welcome (code ${event.code})`)); }, { once: true });
    });
    if (welcome?.v !== 11) fail(`WebSocket welcome expected realtime schema 11, got ${welcome?.v}`);
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
      socket.send(JSON.stringify({ v: 11, t: "ping", ts }));
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

  const evidence = pages.get("/evidence/") || "";
  const evidenceOrder = ["availability", "spend", "incidents", "receipts", "continuity", "logs"];
  const evidencePositions = evidenceOrder.map((id) => evidence.indexOf(`id="${id}"`));
  if (evidencePositions.some((position) => position < 0) || evidencePositions.some((position, index) => index > 0 && position <= evidencePositions[index - 1])) {
    fail(`/evidence/ section order is not ${evidenceOrder.join(" → ")}`);
  }
  const jump = evidence.match(/<nav class="evidence-jump"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";
  const jumpTargets = [...jump.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(jumpTargets) !== JSON.stringify(evidenceOrder)) fail(`/evidence/ jump links are out of order: ${JSON.stringify(jumpTargets)}`);
  for (const retired of ["Server availability", 'id="status-portal-availability"', 'id="degradation"', 'id="machine-data"', 'class="capture-table"']) {
    if (evidence.includes(retired)) fail(`/evidence/ still renders retired content: ${retired}`);
  }
  if (!evidence.includes('id="status-autoupdate"') || !evidence.includes("Pause auto-update")) fail("/evidence/ lost the accessible live-refresh control");
  const serviceRows = (evidence.match(/data-log-row="1"/g) || []).length;
  if (serviceRows > 100) fail(`/evidence/ renders ${serviceRows} service rows; expected at most 100`);
  if (!evidence.includes('href="/logs/game/room-1.txt"')) fail("/evidence/ lost the 24-hour TXT download for room-1");
  for (const room of ["room-2", "room-3", "room-4"]) {
    if (evidence.includes(`href="/logs/game/${room}.txt"`)) fail(`/evidence/ still exposes retired tank log ${room}`);
  }
  const health = await request("/api/health");
  if (health.status !== 200) fail(`/api/health expected 200, got ${health.status}`);
  if (!(health.headers.get("content-type") || "").startsWith("application/json")) fail("/api/health must remain JSON");
  if (health.headers.get("cache-control") !== "no-store") fail("/api/health must remain no-store");
  if (health.headers.get("x-content-type-options") !== "nosniff") fail("/api/health is missing shared security headers");
  const healthBody = await health.json().catch(() => null);
  if (!healthBody?.ok || healthBody.module !== "module-react3fiber") fail("/api/health response shape changed");

  const tank = await request("/api/tank");
  if (tank.status !== 200) fail(`/api/tank expected 200, got ${tank.status}`);
  const tankBody = await tank.json().catch(() => null);
  if (!tankBody?.ok || !Array.isArray(tankBody?.rooms)) fail("/api/tank response shape changed");
  const onlyRoom = tankBody?.rooms?.[0];
  if (tankBody?.rooms?.length !== 1 || onlyRoom?.id !== "room-1" || onlyRoom?.name !== "SharkTank" || onlyRoom?.capacity !== 8 || onlyRoom?.bots !== 24) {
    fail(`/api/tank expected only room-1 as SharkTank with 8 human seats and 24 bots, got ${JSON.stringify(tankBody?.rooms)}`);
  }

  for (const retiredClientPath of ["/api/profile", "/api/audit"]) {
    const retiredClient = await request(retiredClientPath);
    if (retiredClient.status !== 404) fail(`${retiredClientPath} expected retired 404, got ${retiredClient.status}`);
  }

  const publicStatus = await request("/status.json");
  if (publicStatus.status !== 200) fail(`/status.json expected 200, got ${publicStatus.status}`);
  const publicStatusBody = await publicStatus.json().catch(() => null);
  if (!publicStatusBody?.ok) fail("/status.json response shape changed");
  if (publicStatusBody && Object.prototype.hasOwnProperty.call(publicStatusBody, "instance")) fail("/status.json still publishes instance");
  if (publicStatusBody && Object.prototype.hasOwnProperty.call(publicStatusBody, "global")) fail("/status.json still publishes global");
  if (publicStatusBody && Object.prototype.hasOwnProperty.call(publicStatusBody, "portalAvailability")) fail("/status.json still publishes retired portalAvailability");

  const roomWithoutUpgrade = await request("/room/room-1/ws");
  if (roomWithoutUpgrade.status !== 426) fail(`non-upgraded room route expected 426, got ${roomWithoutUpgrade.status}`);
  for (const retiredRoom of ["room-2", "room-3", "room-4"]) {
    const retiredSocket = await request(`/room/${retiredRoom}/ws`);
    if (retiredSocket.status !== 404) fail(`retired WebSocket route ${retiredRoom} expected 404, got ${retiredSocket.status}`);
    const retiredLog = await request(`/logs/game/${retiredRoom}.txt`);
    if (retiredLog.status !== 404) fail(`retired game log ${retiredRoom} expected 404, got ${retiredLog.status}`);
  }
  await verifyRoomWebSocket();

  const unknownApi = await request("/api/not-a-real-endpoint");
  if (unknownApi.status !== 404) fail(`unknown API expected 404, got ${unknownApi.status}`);
  if (!(unknownApi.headers.get("content-type") || "").startsWith("application/json")) fail("unknown API must remain JSON rather than human HTML");
  const unknownApiBody = await unknownApi.json().catch(() => null);
  if (unknownApiBody?.error !== "unknown endpoint") fail("unknown API response body changed");

  for (const retiredApi of ["/api/lobby", "/api/leaderboard", "/api/security-report"]) {
    const retired = await request(retiredApi);
    if (retired.status !== 404) fail(`${retiredApi} expected 404, got ${retired.status}`);
    if (!(retired.headers.get("content-type") || "").startsWith("application/json")) fail(`${retiredApi} must use the normal JSON/API 404`);
    const body = await retired.json().catch(() => null);
    if (body?.error !== "unknown endpoint") fail(`${retiredApi} did not use the normal unknown-endpoint body`);
  }

  for (const retiredPath of [
    ...retiredHumanPaths,
    ...retiredGamePaths,
    "/inquiry.json",
    "/docs", "/docs/", "/openapi.json", "/docs/openapi.json", "/incidents.json", "/logs.json",
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
    if (!(retired.headers.get("content-type") || "").startsWith("text/html")) fail(`${retiredPath} must use the normal HTML 404`);
    const retiredBody = await retired.text();
    assertStrictPresentation(retiredPath, retired, retiredBody);
    assertNotGameDocument(retiredPath, retiredBody);
    if (!retiredBody.includes("<h1>Route not found</h1>")) fail(`${retiredPath} lost the standard not-found presentation`);
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
  for (const retiredControl of ["/admin/security-report", "/admin/security-resolve", "/admin/test-alert", "admin-security-report", "test-alert-form"]) {
    if (adminHtml.includes(retiredControl)) fail(`authenticated /admin/ still exposes retired control ${retiredControl}`);
  }

  const adminStatus = await fetch(`${base}/admin/status.json`, { redirect: "manual", headers: { authorization: `Basic ${auth}`, "cache-control": "no-cache" } });
  if (adminStatus.status !== 200) fail(`authenticated /admin/status.json expected 200, got ${adminStatus.status}`);
  const adminStatusBody = await adminStatus.json().catch(() => null);
  if (!adminStatusBody?.instance?.bootId) fail("/admin/status.json lost operator instance status");
  if (!Array.isArray(adminStatusBody?.rooms)) fail("/admin/status.json lost room status");
  if (!adminStatusBody?.billingWindow) fail("/admin/status.json lost billing status");

  for (const retiredPath of retiredOperatorAliases) {
    const retired = await fetch(`${base}${retiredPath}`, {
      redirect: "manual",
      headers: { authorization: `Basic ${auth}`, "cache-control": "no-cache" },
    });
    if (retired.status !== 404) fail(`authenticated ${retiredPath} expected 404, got ${retired.status}`);
    if (retired.headers.has("location")) fail(`authenticated ${retiredPath} must not redirect`);
    if (!(retired.headers.get("content-type") || "").startsWith("text/html")) fail(`authenticated ${retiredPath} must use the normal HTML 404`);
    const body = await retired.text();
    assertStrictPresentation(retiredPath, retired, body);
    assertNotGameDocument(retiredPath, body);
    if (!body.includes("<h1>Route not found</h1>")) fail(`authenticated ${retiredPath} lost the standard not-found presentation`);
  }

  const retiredSwitch = await fetch(`${base}/admin/switch`, {
    redirect: "manual",
    headers: { authorization: `Basic ${auth}`, "cache-control": "no-cache" },
  });
  if (retiredSwitch.status !== 404) fail(`authenticated /admin/switch expected 404, got ${retiredSwitch.status}`);
  const retiredSwitchHtml = await retiredSwitch.text();
  assertStrictPresentation("/admin/switch", retiredSwitch, retiredSwitchHtml);
  assertNotGameDocument("/admin/switch", retiredSwitchHtml);

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
      if (isRetiredTarget(targetPath)) fail(`${sourcePath} links to retired route ${targetPath}`);
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

  for (const [from, to] of Object.entries(slashRedirects)) {
    const response = await request(from);
    if (response.status !== 301) { fail(`${from} expected 301, got ${response.status}`); continue; }
    if (response.headers.get("location") !== to) fail(`${from} expected Location ${to}, got ${response.headers.get("location")}`);
    const final = await request(to);
    if (final.status !== 200) fail(`${from} redirect destination ${to} expected 200, got ${final.status}`);
  }

  const robots = await request("/robots.txt");
  if (robots.status !== 200) fail(`robots.txt expected 200, got ${robots.status}`);
  const robotsBody = await robots.text();
  const disallowed = [...robotsBody.matchAll(/^Disallow: (.+)$/gm)].map((match) => match[1]);
  const expectedDisallowed = ["/admin/", "/logs/game/", "/*.json$", "/*.jsonl$"];
  if (JSON.stringify(disallowed) !== JSON.stringify(expectedDisallowed)) fail(`robots.txt references an unexpected route set: ${JSON.stringify(disallowed)}`);

  const sitemap = await (await request("/sitemap.xml")).text();
  const listed = [...sitemap.matchAll(/<loc>https:\/\/sharktank\.wizardgang\.ai([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (JSON.stringify(listed) !== JSON.stringify(canonical)) fail(`sitemap is not canonical-only: ${JSON.stringify(listed)}`);

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(`\n${failures.length} public IA check(s) failed.`);
    process.exit(1);
  }
  console.log(`Verified ${canonical.length} canonical pages, strict no-unsafe-inline CSP/generated-HTML contracts, explicit /play/ Static Assets routing with hashed/lazy Vite assets, application/index/asset misses that cannot fall back to the game document, admin/404 HTML, health/tank APIs, retired client-telemetry 404s and retired-endpoint 404s, a live Room Durable Object WebSocket welcome plus 426 non-upgrade behavior, primary navigation, unique IDs, internal anchors, assets, ${Object.keys(slashRedirects).length} canonical slash redirects, retired compatibility/API/operator aliases, surviving robots.txt entries, and canonical sitemap.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
