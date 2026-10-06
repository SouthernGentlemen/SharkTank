// SharkTank routes behind the vendored wg-edge host, identity, and response shell.
// The vendored runtime is .mjs; its checked-in declaration is imported explicitly.
// @ts-expect-error TypeScript does not pair .mjs with the baseline's index.d.ts.
import { createEdge as createEdgeRuntime } from "../../platform/wg-edge/index.mjs";
import type { createEdge as CreateEdge } from "../../platform/wg-edge/index.d.ts";

export { Room } from "./room-do.js";
import type { Env } from "./env.js";
import { version, commit } from "./release.generated.js";
import { assetCsp, json, movedTo } from "./responses.js";
import { isGameShellPath, isStaticAssetPath, parseRoomPath } from "./routes.js";

const ROOM_ID = "room-1", ROOM_NAME = "SharkTank";

const createEdge = createEdgeRuntime as typeof CreateEdge;
export default createEdge<Env>({
  release: { version, commit },
  async fetch(request, env, _ctx, edge) {
    const { url } = edge;
    const path = url.pathname;

    if (path === "/" || path === "/play") return movedTo(url, "/play/");

    const roomId = parseRoomPath(path);
    if (roomId) {
      if (roomId !== ROOM_ID) return json({ ok: false, error: "unknown room" }, 404);
      if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const origin = request.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ ok: false, error: "origin rejected" }, 403);
      const id = env.ROOM.idFromName(roomId);
      const fwd = new URL(request.url);
      fwd.searchParams.set("roomId", roomId);
      fwd.searchParams.set("roomName", ROOM_NAME);
      return env.ROOM.get(id).fetch(new Request(fwd.toString(), { method: request.method, headers: request.headers }));
    }


    const gameShell = isGameShellPath(path);
    if (!gameShell && !isStaticAssetPath(path)) return null;
    const assetTarget = gameShell
      ? new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers })
      : request;
    const asset = await env.ASSETS.fetch(assetTarget);
    if (asset.status === 404) return null;
    const secured = new Response(asset.body, asset);
    secured.headers.set("content-security-policy", assetCsp);
    return secured;
  },
});
