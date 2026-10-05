/** Security policy for the Vite-built game document and its first-party assets. */
export const assetCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...SECURITY_HEADERS },
  });
}

/** Permanent game entry redirect, preserving any query string. */
export function movedTo(url: URL, target: string): Response {
  const destination = new URL(target, url);
  if (url.search && !destination.search) destination.search = url.search;
  return new Response(null, { status: 308, headers: { location: `${destination.pathname}${destination.search}${destination.hash}`, "cache-control": "no-store", ...SECURITY_HEADERS } });
}
