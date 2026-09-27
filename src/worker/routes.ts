export const CANONICAL_HUMAN_ROUTES = ["/", "/evidence/", "/play/"] as const;

/** `/room/:id/ws` → the matching Room DO. Returns the room id, or null if not a room path. */
export function parseRoomPath(path: string): string | null {
  const m = path.match(/^\/room\/([^/]+)\/ws$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Every route that is credentialed or performs an operator mutation. One list, used by
 * every gate so a new operator route cannot be added without also being gated.
 */
export function isOpsPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}
export function isGameShellPath(path: string): boolean { return path === "/play/"; }
export function isStaticAssetPath(path: string): boolean { return path.startsWith("/assets/") || path === "/sharktank-art.jpg"; }
