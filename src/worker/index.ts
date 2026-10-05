// Local host Worker: redirects to the built R3F client (via ASSETS), serves
// release and health JSON, and upgrades /room/:id/ws into the Room Durable Object.
//
// Imports ONLY the server-safe entry points of module-react3fiber (never the client),
// so no browser libs leak into the Worker/DO bundle.

import { API } from "module-react3fiber/protocol";

export { Room } from "./room-do.js";
export { Lobby } from "./lobby-do.js";
import type { Env } from "./env.js";
import { assetCsp, SECURITY_HEADERS, json, movedTo } from "./responses.js";
import { isGameShellPath, isStaticAssetPath, parseRoomPath } from "./routes.js";

const ROOM_ID = "room-1", ROOM_NAME = "SharkTank";
const ALLOWED_ROOMS = new Set([ROOM_ID]);

function isLoopback(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isSecureRequest(request: Request, url: URL): boolean {
  const visitor = request.headers.get("cf-visitor");
  if (visitor) {
    try { return (JSON.parse(visitor) as { scheme?: string }).scheme === "https"; } catch { return false; }
  }
  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return url.protocol === "https:";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Public GET/HEAD requests still move to HTTPS before route dispatch.
      if (!isSecureRequest(request, url) && !isLoopback(url)) {
        if (request.method === "GET" || request.method === "HEAD") {
          const secure = `https://${url.host.replace(/:80$/, "")}${url.pathname}${url.search}`;
          return new Response(null, { status: 308, headers: { location: secure, "cache-control": "no-store", ...SECURITY_HEADERS } });
        }
      }
      if (path === "/") return movedTo(url, "/play/");
      if (path === "/play") return movedTo(url, "/play/");
      if (path === "/favicon.ico") return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });


      // ── WebSocket → Room DO ────────────────────────────────────────────────
      const roomId = parseRoomPath(path);
      if (roomId) {
        if (!ALLOWED_ROOMS.has(roomId)) return json({ ok: false, error: "unknown room" }, 404);
        if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
        const origin = request.headers.get("origin");
        if (origin && new URL(origin).host !== url.host) return json({ ok: false, error: "origin rejected" }, 403);
        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);
        const name = ROOM_NAME;
        const fwd = new URL(request.url);
        fwd.searchParams.set("roomId", roomId);
        fwd.searchParams.set("roomName", name);
        return stub.fetch(new Request(fwd.toString(), { method: request.method, headers: request.headers }));
      }

      // ── HTTP API ───────────────────────────────────────────────────────────
      if (path === API.health) {
        return json({ ok: true, module: "module-react3fiber", release: env.SHARKTANK_RELEASE ?? "unknown", revision: env.SHARKTANK_RELEASE_REVISION ?? "unknown", time: new Date().toISOString() });
      }

      if (path === "/version.json") {
        return json({ product: "SharkTank", release: env.SHARKTANK_RELEASE ?? "unknown", revision: env.SHARKTANK_RELEASE_REVISION ?? "unknown", environment: env.ENVIRONMENT ?? "unknown" });
      }

      if (path.startsWith("/api/")) return json({ ok: false, error: "unknown endpoint" }, 404);

    } catch (e) {
      // The message can carry internal paths, binding names and storage keys, and this
      // handler answers unauthenticated requests. It goes to the Worker log, where an
      // operator can read it, and never into the response body.
      console.error("unhandled request failure", path, e);
      return json({ ok: false, error: "internal error" }, 500);
    }

    // Static Assets is fail-closed: application misses stay Worker 404s and asset misses stay
    // asset 404s. Only the explicit game-shell contract may read Vite's built document.
    const gameShell = isGameShellPath(path);
    const staticAsset = isStaticAssetPath(path);
    if (!gameShell && !staticAsset) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS } });
    }

    // /play/ intentionally maps to the one
    // Vite-built document. Static assets keep their requested path and can therefore miss.
    const assetTarget = gameShell
      ? new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers })
      : request;
    const asset = await env.ASSETS.fetch(assetTarget);
    if (asset.status === 404) {
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS } });
    }
    const secured = new Response(asset.body, asset); for (const [key, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(key, value); secured.headers.set("content-security-policy", assetCsp); return secured;
  },

};
