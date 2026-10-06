#!/usr/bin/env node

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const failures = [];
const fail = (message) => failures.push(message);
const request = (path) => fetch(base + path, { redirect: "manual", headers: { "cache-control": "no-cache", "x-forwarded-proto": "https" } });

async function checkNotFound(path) {
  const response = await request(path);
  if (response.status !== 404) fail(`${path}: expected 404, got ${response.status}`);
  if (!response.headers.get("content-type")?.startsWith("application/json")) fail(`${path}: expected shell JSON`);
  const body = await response.json();
  if (body.error !== "Not found" || body.status !== 404) fail(`${path}: unexpected shell 404 body`);
}

async function checkRoomSocket() {
  const wsBase = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const socket = new WebSocket(`${wsBase}/room/room-1/ws`, { headers: { "x-forwarded-proto": "https" } });
  try {
    const welcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("room welcome timed out")), 5_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ v: 11, t: "hello", name: "Acceptance Shark", skin: "cyan", debugLanguage: "ts" })), { once: true });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message?.t === "welcome") { clearTimeout(timer); resolve(message); }
        } catch { /* Ignore non-JSON messages while waiting. */ }
      });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("room socket error")); }, { once: true });
    });
    if (welcome.v !== 11 || welcome.roomId !== "room-1" || !welcome.youId || typeof welcome.state?.tick !== "number") {
      fail("room WebSocket welcome lost authoritative state or identity");
    }
  } finally {
    socket.close();
  }
}

try {
  const root = await request("/?from=acceptance");
  if (root.status !== 308 || root.headers.get("location") !== "/play/?from=acceptance") fail("/ must redirect permanently to /play/ and preserve query");
  const shortPlay = await request("/play");
  if (shortPlay.status !== 308 || shortPlay.headers.get("location") !== "/play/") fail("/play must redirect permanently to /play/");

  const play = await request("/play/");
  const html = await play.text();
  if (play.status !== 200 || !play.headers.get("content-type")?.startsWith("text/html")) fail("/play/ must serve the game HTML");
  if (!html.includes('id="root"') || !html.includes("Wizard Gang Shark Tank")) fail("/play/ lost the game shell");
  const csp = play.headers.get("content-security-policy") || "";
  if (!csp.includes("script-src 'self'") || /nonce-|cloudflareinsights|unsafe-inline/i.test(csp)) fail("game CSP must allow only first-party scripts");
  if (/<script\b(?![^>]*\bsrc=)/i.test(html)) fail("game shell must not emit inline script");

  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
  if (!assetPaths.some((path) => path.endsWith(".js")) || !assetPaths.some((path) => path.endsWith(".css"))) fail("game shell must reference built JS and CSS assets");
  for (const path of assetPaths) {
    const asset = await request(path);
    if (asset.status !== 200) fail(`${path}: built asset returned ${asset.status}`);
    if (asset.headers.get("content-security-policy") !== csp) fail(`${path}: asset CSP differs from game shell`);
  }

  const version = await request("/version.json");
  const identity = await version.json();
  if (version.status !== 200 || identity.app !== "sharktank" || !identity.version || !/^[0-9a-f]{40}$/.test(identity.commit)) fail("/version.json lost baseline release identity");
  const noUpgrade = await request("/room/room-1/ws");
  if (noUpgrade.status !== 426) fail("room WebSocket path must require upgrade");
  await checkRoomSocket();

  for (const path of [
    "/unknown", "/index.html", "/assets/missing.js", "/styles/page-old.css",
    "/sitemap.xml", "/evidence", "/evidence/", "/status.json", "/spend.json",
    "/trust", "/trust/", "/status", "/status/", "/incidents", "/incidents/",
    "/logs", "/logs/", "/spend", "/spend/", "/inquiry", "/inquiry/",
    "/arena", "/uno", "/x4", "/21", "/game", "/checkers", "/battleship", "/3d", "/shark-run", "/sharkrun",
    "/audit.json", "/audit.jsonl", "/audit/status.json", "/audit/game/room-1", "/audit/replay/room-1",
    "/logs/game/room-1.txt", "/docs", "/docs/", "/openapi.json", "/docs/openapi.json",
    "/incidents.json", "/logs.json", "/inquiry.json",
    "/api/health", "/api/lobby", "/api/leaderboard", "/api/security-report", "/api/tank", "/api/profile", "/api/audit",
    "/room/room-2/ws", "/room/room-3/ws", "/room/room-4/ws",
  ]) {
    if (path.startsWith("/api/") || path.startsWith("/room/")) {
      const response = await request(path);
      if (response.status !== 404) fail(`${path}: expected 404, got ${response.status}`);
    } else await checkNotFound(path);
  }
  const robots = await request("/robots.txt");
  if (robots.status !== 200 || !(await robots.text()).includes("Disallow: /admin/")) fail("shell robots policy missing");
  const admin = await request("/admin/maintenance");
  if (admin.status !== 503 || (await admin.json()).status !== 503) fail("unconfigured shell admin gate must refuse access");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  for (const failure of failures) console.error("FAIL " + failure);
  process.exit(1);
}
console.log("Game surface passed: redirect, shell, assets, version, room WebSocket, strict CSP and retired-path 404s.");
