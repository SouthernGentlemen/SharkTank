/** Applied to every response this Worker emits. HSTS keeps clients off plaintext after one visit. */
/**
 * CSP for the static asset path — the React game shell, which `html()` never touches.
 * That path had no CSP at all, so the SPA was the one surface with no injection control.
 *
 * The app ships ES modules and Vite-processed styles under /assets, so both script-src and
 * style-src can stay on 'self'. Game components avoid DOM style attributes; dynamic canvas
 * drawing is unaffected by CSP style policy. blob:/data: on img-src remain for canvas readback
 * and inlined sprites. connect-src covers the same-origin tank WebSocket; wss: is explicit for
 * browsers that do not treat a self HTTPS source as matching the WebSocket scheme.
 */
/**
 * `script-src` carries BOTH `'self'` and a per-response nonce. `'self'` covers the app's own
 * modules under /assets. The nonce is not for anything this Worker writes — the SPA shell has
 * no inline script — it exists so Cloudflare's edge HTML rewriter has a nonce to copy onto the
 * analytics tags it injects downstream of this Worker. Without one it injects an unnonced
 * inline bootstrap and an external beacon, and a strict policy blocks both.
 *
 * This is why no external host is named here: the nonce authorises the edge's own injection
 * without widening the policy for anyone else.
 */
const assetCsp = (nonce: string) =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss: https://cloudflareinsights.com; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  // Was set on the static asset path only, so the eight server-rendered pages — the ones
  // that exist to demonstrate the controls — shipped without it. It belongs in the one
  // table every response passes through, not on a single branch.
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...SECURITY_HEADERS },
  });
}

/**
 * Every inline `<script>` this file emits is written as `<script nonce="__WG_CSP_NONCE__">`.
 * `html()` is the single place that swaps the slot for a real per-response nonce, so an
 * emitter cannot drift out of sync with the header. Only the fully quoted attribute form is
 * substituted, and `esc()` turns `"` into `&quot;`, so no escaped value reaching the page
 * can forge a slot and read the nonce back out of the document.
 */
const NONCE_SLOT = "__WG_CSP_NONCE__";

/** 128 bits of CSPRNG entropy, base64. Fresh for every HTML response — never cached, never reused. */
function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * `script-src` carries a nonce and NO `'unsafe-inline'`: under CSP3 the nonce alone makes an
 * unmarked inline script inert, which is the point — injected markup cannot guess the nonce.
 * `style-src` is limited to `'self'`: Worker documents link the fingerprinted first-party
 * stylesheet and do not emit style attributes or embedded style blocks. The response nonce
 * remains for explicitly authorised inline scripts and Cloudflare's downstream integration.
 */
function html(body: string, status = 200): Response {
  const nonce = mintNonce();
  const body2 = body.split(`nonce="${NONCE_SLOT}"`).join(`nonce="${nonce}"`);
  const csp = `default-src 'self'; style-src 'self'; script-src 'self' 'nonce-${nonce}'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
  return new Response(body2, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp, ...SECURITY_HEADERS, "referrer-policy": "no-referrer" },
  });
}

/**
 * A permanent move that keeps the security headers.
 *
 * Every route this restructure moved is cited from the conformance register, from the
 * policy set, and from whatever anyone else has already linked. A moved route that stops
 * answering turns a live evidence link into a dead one, which is a finding in its own
 * right — so the old names keep working rather than being deleted.
 */
function movedTo(url: URL, target: string): Response {
  const destination = new URL(target, url);
  if (url.search && !destination.search) destination.search = url.search;
  return new Response(null, { status: 301, headers: { location: `${destination.pathname}${destination.search}${destination.hash}`, "cache-control": "no-store", ...SECURITY_HEADERS } });
}

export { assetCsp, SECURITY_HEADERS, json, mintNonce, html, movedTo };
