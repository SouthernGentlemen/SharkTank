/** `/room/:id/ws` → the matching Room DO. Returns the room id, or null if not a room path. */
export function parseRoomPath(path: string): string | null {
  const m = path.match(/^\/room\/([^/]+)\/ws$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function isGameShellPath(path: string): boolean { return path === "/play/"; }
export function isStaticAssetPath(path: string): boolean { return path.startsWith("/assets/") || path === "/sharktank-art.jpg"; }
