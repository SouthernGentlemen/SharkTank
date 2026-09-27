export const CANONICAL_HUMAN_ROUTES = ["/", "/controls/", "/evidence/", "/play/"] as const;

/** One-hop compatibility map for the former public information architecture. */
export const HUMAN_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  "/trust": "/", "/trust/": "/",
  "/iso-27001": "/controls/#iso-27001", "/iso-27001/": "/controls/#iso-27001",
  "/iso-42001": "/controls/#iso-42001", "/iso-42001/": "/controls/#iso-42001",
  "/audit": "/controls/#registers", "/audit/": "/controls/#registers",
  "/policies": "/controls/#policies", "/policies/": "/controls/#policies",
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
 * Every route that is credentialed or performs a control mutation. One list, used by every
 * gate — so a new control route cannot be added without also being gated.
 *
 * `/audit/` is deliberately absent: it is now the public conformance register, and a
 * register nobody can read proves nothing to anybody. The operator dashboard it used to
 * hold moved to `/admin/`, and the `/audit*` data routes stay credentialed as aliases of
 * their `/admin/` names so existing operator tooling keeps working.
 */
export function isOpsPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") ||
    path === "/audit.json" || path === "/audit.jsonl" ||
    path === "/audit/status.json" || path.startsWith("/audit/game/") || path.startsWith("/audit/replay/");
}

export function isGameShellPath(path: string): boolean {
  return path === "/play/" || path === "/ts" || path === "/ts/" || path === "/php" || path === "/php/";
}

export function isStaticAssetPath(path: string): boolean {
  return path.startsWith("/assets/") || path === "/sharktank-art.jpg";
}
