export const CANONICAL_HUMAN_ROUTES = ["/", "/evidence/", "/play/"] as const;

/** One-hop compatibility map for the surviving pre-MVP public routes. */
export const HUMAN_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  "/trust": "/", "/trust/": "/",
  "/status": "/evidence/#availability", "/status/": "/evidence/#availability",
  "/incidents": "/evidence/#incidents", "/incidents/": "/evidence/#incidents",
  "/logs": "/evidence/#logs", "/logs/": "/evidence/#logs",
  "/spend": "/evidence/#spend", "/spend/": "/evidence/#spend",
  "/inquiry": "/evidence/#spend", "/inquiry/": "/evidence/#spend",
});

/** `/room/:id/ws` → the matching Room DO. Returns the room id, or null if not a room path. */
export function parseRoomPath(path: string): string | null {
  const m = path.match(/^\/room\/([^/]+)\/ws$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Every route that is credentialed or performs an operator mutation. One list, used by
 * every gate so a new operator route cannot be added without also being gated.
 *
 * The `/audit*` data routes remain credentialed aliases of their `/admin/` names until
 * the later MVP endpoint-cull task; they are not public assurance routes.
 */
export function isOpsPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") ||
    path === "/audit.json" || path === "/audit.jsonl" ||
    path === "/audit/status.json" || path.startsWith("/audit/game/") || path.startsWith("/audit/replay/");
}
export function isGameShellPath(path: string): boolean { return path === "/play/"; }
export function isStaticAssetPath(path: string): boolean { return path.startsWith("/assets/") || path === "/sharktank-art.jpg"; }
