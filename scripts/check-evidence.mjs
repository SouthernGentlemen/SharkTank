#!/usr/bin/env node
/**
 * Read-only MVP evidence checker.
 *
 * Verifies the canonical public pages, the three public snapshot JSON endpoints,
 * unauthenticated Admin denial, and explicit retirement of the former assurance routes.
 * It never authenticates and never opens a room WebSocket.
 *
 * Usage: node scripts/check-evidence.mjs [baseUrl]   (default http://127.0.0.1:8787)
 */

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const failures = [];
const fail = (message) => failures.push(message);
const request = (path) => fetch(`${base}${path}`, {
  redirect: "manual",
  headers: { "cache-control": "no-cache" },
});

const publicPages = [
  ["/", '<nav aria-label="Primary">'],
  ["/evidence/", '<nav aria-label="Primary">'],
  ["/play/", '<div id="root">'],
];
const publicJson = ["/status.json", "/spend.json", "/version.json"];
const retiredHtml = [
  "/trust", "/trust/",
  "/status", "/status/",
  "/incidents", "/incidents/",
  "/logs", "/logs/",
  "/spend", "/spend/",
  "/inquiry", "/inquiry/",
  "/arena", "/arena/legacy", "/uno", "/x4", "/21", "/game", "/checkers", "/battleship", "/3d", "/shark-run", "/sharkrun",
  "/inquiry.json",
  "/audit.json", "/audit.jsonl", "/audit/status.json",
  "/audit/game/room-1", "/audit/game/room-1.jsonl",
  "/audit/replay/room-1", "/audit/replay/room-1.json",
  "/controls", "/controls/",
  "/iso-27001", "/iso-27001/",
  "/iso-42001", "/iso-42001/",
  "/audit", "/audit/",
  "/policies", "/policies/",
  "/policies/context", "/policies/context/",
  "/policies/ai-policy", "/policies/ai-policy/",
  "/policies.json",
  "/audit/manifest.json",
];

async function main() {
  for (const [path, marker] of publicPages) {
    const response = await request(path);
    if (response.status !== 200) {
      fail(`${path} expected 200, got ${response.status}`);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("text/html")) fail(`${path} expected HTML, got ${type || "none"}`);
    const body = await response.text();
    if (!body.includes(marker)) fail(`${path} lost its expected public document marker`);
  }

  for (const path of publicJson) {
    const response = await request(path);
    if (response.status !== 200) {
      fail(`${path} expected 200, got ${response.status}`);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      fail(`${path} expected application/json, got ${type || "none"}`);
      continue;
    }
    try {
      JSON.parse(await response.text());
    } catch {
      fail(`${path} did not return valid JSON`);
    }
  }

  const admin = await request("/admin/");
  if (admin.status !== 401) fail(`unauthenticated /admin/ expected 401, got ${admin.status}`);
  if (!(admin.headers.get("www-authenticate") || "").startsWith("Basic realm=")) {
    fail("unauthenticated /admin/ lost its Basic authentication challenge");
  }

  const retiredLobby = await request("/api/lobby");
  if (retiredLobby.status !== 404) fail(`/api/lobby expected 404, got ${retiredLobby.status}`);
  if (!(retiredLobby.headers.get("content-type") || "").startsWith("application/json")) fail("/api/lobby must use the normal JSON/API 404");
  const retiredLobbyBody = await retiredLobby.json().catch(() => null);
  if (retiredLobbyBody?.error !== "unknown endpoint") fail("/api/lobby did not use the normal unknown-endpoint body");

  for (const path of retiredHtml) {
    const response = await request(path);
    if (response.status !== 404) fail(`${path} expected 404, got ${response.status}`);
    if (response.headers.has("location")) fail(`${path} must not redirect after retirement`);
    if (!(response.headers.get("content-type") || "").startsWith("text/html")) fail(`${path} must use the normal HTML 404`);
    const body = await response.text();
    if (!body.includes("<h1>Route not found</h1>")) fail(`${path} lost the standard not-found presentation`);
  }

  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    console.error(`\n${failures.length} MVP evidence check(s) failed.`);
    process.exit(1);
  }

  console.log(`Verified ${publicPages.length} canonical pages, ${publicJson.length} public JSON snapshots, unauthenticated Admin denial, the retired /api/lobby alias, and ${retiredHtml.length} retired HTML compatibility/alias routes.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
