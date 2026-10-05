// Local host Worker: serves the built R3F client (via ASSETS), the health API,
// and upgrades /room/:id/ws WebSockets into the Room Durable Object.
//
// Imports ONLY the server-safe entry points of module-react3fiber (never the client),
// so no browser libs leak into the Worker/DO bundle.

import { API } from "module-react3fiber/protocol";

export { Room } from "./room-do.js";
export { Lobby } from "./lobby-do.js";
import type { Env, MaintenanceState } from "./env.js";
import { assetCsp, SECURITY_HEADERS, html, json, mintNonce, movedTo, ndjson, opsDenied, tlsRequired } from "./responses.js";
import { CANONICAL_HUMAN_ROUTES, isGameShellPath, isOpsPath, isStaticAssetPath, parseRoomPath } from "./routes.js";
import { numberValue, publicBillingWindow, recordValue } from "./presentation-data.js";
import {
  AUDIT_ROOMS,
  INCIDENTS,
  PAGE_CSS_PATH,
  incidentSummary,
  pageCssResponse,
  tankCopy,
  type ControlHistoryEntry,
  type IncidentRecord,
  type PublicEvidenceStatus,
} from "./presentation.js";
import {
  renderAdminDocument,
  renderDowntimeDocument,
  renderNotFoundDocument,
  renderOverviewDocument,
} from "./presentation-react.js";


/**
 * The billing window as the public may see it.
 *
 * The DO's own record carries the running deployment version id and the production R2
 * bucket name. Neither is a secret in the credential sense, but both are unauthenticated
 * infrastructure disclosure — the version id dates the running build and the bucket name
 * names a real storage target. `/admin/status.json` still gets the unredacted record; it
 * is behind ops auth and the dashboard reads both.
 *
 * Keyed on field name and applied at every depth, because the same shapes repeat under
 * `services` and `allTime.services`.
 */


function lobbyStub(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}

const ROOM_ID = "room-1", ROOM_NAME = "SharkTank";
const ALLOWED_ROOMS = new Set([ROOM_ID]);
/** Loopback only — traffic that never leaves the machine, so `wrangler dev` still works. */
function isLoopback(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * TLS check. Behind Cloudflare the Worker URL is already https, but `cf-visitor` carries the
 * scheme the *client* actually used, so a plaintext client hop is still detectable.
 */
function isSecureRequest(request: Request, url: URL): boolean {
  const visitor = request.headers.get("cf-visitor");
  if (visitor) {
    try { return (JSON.parse(visitor) as { scheme?: string }).scheme === "https"; } catch { return false; }
  }
  const forwarded = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return url.protocol === "https:";
}

/**
 * Constant-time compare over SHA-256 digests. Comparing the raw strings leaked the secret's
 * length through an early return; digests are always 32 bytes, so nothing is observable.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Ops authentication. Fails closed in every direction:
 *  - no minted OPS_TOKEN  → deny (this previously fell open outside `ENVIRONMENT=production`)
 *  - not over TLS         → deny, because Basic auth is reversible base64
 *  - anything else        → deny
 * The only accepted credential is the token minted into the environment as a Worker secret.
 */
async function opsAuthorized(request: Request, env: Env, url: URL): Promise<boolean> {
  const token = env.OPS_TOKEN;
  if (!token) return false;
  if (!isSecureRequest(request, url) && !isLoopback(url)) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return constantTimeEqual(auth.slice(7), token);
  if (auth.startsWith("Basic ")) {
    let decoded: string;
    try { decoded = atob(auth.slice(6)); } catch { return false; }
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const [userOk, passOk] = await Promise.all([
      constantTimeEqual(decoded.slice(0, separator), env.OPS_USERNAME ?? "ops"),
      constantTimeEqual(decoded.slice(separator + 1), token),
    ]);
    return userOk && passOk;
  }
  return false;
}
let maintenanceCache: { state: MaintenanceState; expiresAt: number } | null = null;
// `weight` biases the draw; everything defaults to 1.
async function maintenanceState(env: Env, fresh = false): Promise<MaintenanceState> {
  if (!fresh && maintenanceCache && maintenanceCache.expiresAt > Date.now()) return maintenanceCache.state;
  const res = await lobbyStub(env).fetch("https://lobby/maintenance");
  const data = (await res.json()) as { maintenance?: MaintenanceState };
  const state = data.maintenance ?? { enabled: false, changedAt: 0, reason: "" };
  maintenanceCache = { state, expiresAt: Date.now() + 1_000 };
  return state;
}
/**
 * Paths that keep answering while the gate is closed.
 *
 * The gate closes for two reasons: an operator opens it deliberately, or measured spend
 * reaches the hard limit and `enforceSpendLimit` closes it. In the second case the whole
 * point is to stop spending, so the routes that generate the billable writes have to close
 * with it — exempting all of `/api/*` meant the ceiling stopped the game while leaving the
 * two unauthenticated write paths taking Durable Object writes at full rate.
 *
 * Reads stay up for the surviving overview, health check and protected administration.
 */
function maintenanceBypass(path: string, _method: string): boolean {
  // The stylesheet and enhancement script used by the surviving Worker-rendered pages.
  if (path.startsWith("/styles/") || path === "/assets/human-docs.js") return true;
  return path === "/" || path === "/robots.txt" || path === "/sitemap.xml" ||
    path === API.health ||
    path === "/admin" || path.startsWith("/admin/");
}


/** Fetch a control path on the Room DO instance for `roomId`. */
function roomFetch(env: Env, roomId: string, pathAndQuery: string, init?: RequestInit): Promise<Response> {
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const u = new URL("https://room" + pathAndQuery);
  u.searchParams.set("roomId", roomId);
  return stub.fetch(u.toString(), init);
}

/**
 * Availability is reported over the life of the project, not a rolling 24 hours. A
 * 24-hour window silently forgets every incident older than a day, which made the
 * evidence pages read as "nothing has ever happened" the moment a day passed. Anchored
 * to the first hour of the build so the window only ever grows.
 */
/* ── State backup ────────────────────────────────────────────────────
   The tank Durable Object holds the receipt chain, the 90-day action log, player
   profiles and spend history, and until now none of it was copied anywhere. A copy
   is written to the bound object storage on a schedule, older copies are pruned to a
   retention window, and the outcome — success or failure — is receipted into the same
   chain the copy protects. Restoring is a separate, deliberate act; see runRestoreDrill,
   which proves the path works without touching live state. */
const BACKUP_PATH = "backups/state/";
const backupPrefix = (env: Env) => `${env.R2_PREFIX ?? ""}${BACKUP_PATH}`;
/** How many dated copies are kept. Daily copies, so this is roughly a month of history. */
const BACKUP_RETAIN = 30;

interface StateExportShape {
  format: string; version: number; takenAt: number; digest?: string;
  counts?: { kv: number; profiles: number; audit: number; controlHistory: number };
}

/** Fetch a full export from the tank object. */
async function fetchStateExport(env: Env): Promise<StateExportShape | null> {
  const res = await lobbyStub(env).fetch("https://lobby/backup");
  if (!res.ok) return null;
  const body = (await res.json()) as { ok?: boolean; export?: StateExportShape };
  return body.export ?? null;
}

/**
 * Take one copy and record the outcome. Returns a report rather than throwing, because a
 * failed backup must still leave a receipt saying so — a backup path that fails silently
 * is worse than none, since recovery evidence would otherwise look healthy.
 */
async function runBackup(env: Env): Promise<Record<string, unknown>> {
  if (!env.R2_ASSETS) {
    await lobbyStub(env).fetch(new Request("https://lobby/backup/record", { method: "POST", body: JSON.stringify({ ok: false, lastBackupError: "no object storage bound" }), headers: { "content-type": "application/json" } }));
    return { ok: false, error: "no object storage bound" };
  }
  try {
    const prefix = backupPrefix(env);
    const latestKey = `${prefix}latest.json`;
    const data = await fetchStateExport(env);
    if (!data) throw new Error("export refused");
    const body = JSON.stringify(data);
    const stamp = new Date(data.takenAt).toISOString().replace(/[:.]/g, "-");
    const key = `${prefix}${stamp}.json`;
    const headers = { httpMetadata: { contentType: "application/json" }, customMetadata: { digest: String(data.digest ?? ""), takenAt: String(data.takenAt) } };
    await env.R2_ASSETS.put(key, body, headers);
    await env.R2_ASSETS.put(latestKey, body, headers);

    // Prune to the retention window. Keys are ISO-stamped, so lexical order is time order.
    const listed = await env.R2_ASSETS.list({ prefix, limit: 1000 });
    const dated = listed.objects.map((object) => object.key).filter((k) => k !== latestKey).sort();
    const doomed = dated.slice(0, Math.max(0, dated.length - BACKUP_RETAIN));
    for (const old of doomed) await env.R2_ASSETS.delete(old);

    const record = { ok: true, lastBackupAt: data.takenAt, lastBackupKey: key, lastBackupBytes: body.length, lastBackupDigest: data.digest ?? "", lastBackupCounts: data.counts ?? null, retainedCopies: Math.max(0, dated.length - doomed.length) };
    await lobbyStub(env).fetch(new Request("https://lobby/backup/record", { method: "POST", body: JSON.stringify(record), headers: { "content-type": "application/json" } }));
    return { ...record, pruned: doomed.length };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown failure";
    await lobbyStub(env).fetch(new Request("https://lobby/backup/record", { method: "POST", body: JSON.stringify({ ok: false, lastBackupError: detail }), headers: { "content-type": "application/json" } }));
    return { ok: false, error: detail };
  }
}

/**
 * Restore drill. Reads the most recent copy back out of object storage, restores that copy
 * into a scratch Durable Object addressed by a name nothing else uses, exports the scratch
 * instance and compares digests. A matching digest means the stored copy reconstitutes the
 * state it was taken from exactly, not merely something like it.
 *
 * The stored copy is deliberately the thing under test. An earlier version of this drill
 * exported the live object and restored that, which proved the object could round-trip its
 * own state and proved nothing whatever about object storage -- while /status/ went on
 * saying the most recent copy was what had been restored. If no bucket is bound, or there
 * is no copy in it, the drill fails and says which: it must never quietly fall back to the
 * live export, because that silent fallback is precisely how the published claim became
 * untrue in the first place.
 *
 * Live state is never written to, so this is safe to run against production.
 */
/** The drill detail is rendered on the public status panel, so it has to read as English. */
const countOf = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

async function runRestoreDrill(env: Env): Promise<Record<string, unknown>> {
  const started = Date.now();
  // One fixed scratch name, not one per run: a per-run name would leave a new object
  // holding a full copy of every profile behind after every drill.
  const scratch = env.LOBBY.get(env.LOBBY.idFromName("state-restore-drill"));
  try {
    const latestKey = `${backupPrefix(env)}latest.json`;
    // No bucket, or nothing in it, is a failed drill and not a reason to test something else.
    if (!env.R2_ASSETS) throw new Error("no object storage bound, so there is no stored copy to restore");
    const stored = await env.R2_ASSETS.get(latestKey);
    if (!stored) throw new Error(`no copy at ${latestKey} to restore; take one before drilling`);
    let source: StateExportShape | null = null;
    try { source = (await stored.json()) as StateExportShape; }
    catch { throw new Error(`the copy at ${latestKey} is not readable JSON`); }
    if (!source || typeof source !== "object") throw new Error("the stored copy is not an export");
    // Without a digest on the copy there is nothing to compare the restore against, and a
    // drill that cannot compare must not report a pass.
    if (!source.digest) throw new Error("the stored copy carries no digest to compare against");

    const restore = await scratch.fetch(new Request("https://lobby/restore", { method: "POST", body: JSON.stringify({ export: source }), headers: { "content-type": "application/json" } }));
    const restored = (await restore.json()) as { ok?: boolean; error?: string };
    if (!restore.ok || !restored.ok) throw new Error(restored.error ?? "restore refused");
    const copyRes = await scratch.fetch("https://lobby/backup");
    const copyBody = (await copyRes.json()) as { export?: StateExportShape };
    const copy = copyBody.export;
    if (!copy) throw new Error("scratch instance would not export");
    // The digest covers state only, deliberately excluding takenAt and generation, so two
    // exports of the same data hash the same however far apart they were taken.
    const match = source.digest === copy.digest;

    // Second assertion, reported rather than asserted. Whether the stored copy still matches
    // the live object says how old the copy is, not whether the restore path works: every
    // request moves spend and the action log on, so the two digests differ most of the time
    // by design. Failing the drill on that would make it fail daily for the expected reason
    // and teach the reader to ignore it.
    const live = await fetchStateExport(env);
    const drift = !live?.digest
      ? "live state could not be exported to compare"
      : live.digest === source.digest ? "live state unchanged since the copy" : "live state has moved on since the copy";

    const takenLabel = Number.isFinite(source.takenAt) && source.takenAt > 0
      ? new Date(source.takenAt).toISOString().slice(0, 16).replace("T", " ") + "Z"
      : "unknown time";
    const detail = match
      ? `copy of ${takenLabel} read back from ${latestKey}; digest ${String(source.digest).slice(0, 16)}…; ${countOf(source.counts?.kv ?? 0, "key")}, ${countOf(source.counts?.controlHistory ?? 0, "receipt")}, ${countOf(source.counts?.audit ?? 0, "log row")}; ${drift}`
      : `stored copy ${String(source.digest).slice(0, 16)}… vs restored ${String(copy.digest).slice(0, 16)}…`;
    await lobbyStub(env).fetch(new Request("https://lobby/backup/drill-result", { method: "POST", body: JSON.stringify({ ok: match, detail }), headers: { "content-type": "application/json" } }));
    return { ok: match, detail, restoredFrom: latestKey, storedTakenAt: source.takenAt ?? null, storedBytes: stored.size, storedDigest: source.digest, liveDigest: live?.digest ?? null, liveMatchesStored: Boolean(live?.digest) && live?.digest === source.digest, sourceCounts: source.counts ?? null, restoredCounts: copy.counts ?? null, elapsedMs: Date.now() - started };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown failure";
    await lobbyStub(env).fetch(new Request("https://lobby/backup/drill-result", { method: "POST", body: JSON.stringify({ ok: false, detail }), headers: { "content-type": "application/json" } }));
    return { ok: false, detail, elapsedMs: Date.now() - started };
  } finally {
    // Whether the drill passed or failed, the scratch copy of every profile goes away.
    try { await scratch.fetch(new Request("https://lobby/wipe", { method: "POST" })); }
    catch (e) { console.error("restore drill scratch wipe failed", e); }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // TLS gate, ahead of everything. Ops paths are never redirected: a redirect means the
      // Basic credential already crossed the wire in clear text, so it can only be refused.
      if (!isSecureRequest(request, url) && !isLoopback(url)) {
        if (isOpsPath(path) || request.headers.get("authorization")) return tlsRequired();
        if (request.method === "GET" || request.method === "HEAD") {
          // Build the target explicitly: workerd's URL does not honour the `protocol` setter.
          const secure = `https://${url.host.replace(/:80$/, "")}${url.pathname}${url.search}`;
          return new Response(null, { status: 308, headers: { location: secure, "cache-control": "no-store", ...SECURITY_HEADERS } });
        }
        return tlsRequired();
      }
      if (!maintenanceBypass(path, request.method)) {
        const state = await maintenanceState(env);
        if (state.enabled) {
          // An API caller gets the machine-readable refusal, not the downtime page.
          if (path.startsWith("/api/")) return json({ ok: false, error: "service gated", reason: state.reason || "Safety control active" }, 503);
          const response = html(renderDowntimeDocument(state), 503);
          response.headers.set("retry-after", "60");
          response.headers.set("cache-control", "no-store");
          return response;
        }
      }
      // The page stylesheet, ahead of every other route and of static asset dispatch. Only
      // the current fingerprint is served: any other /styles/ path is an explicit miss, so a
      // text/css request can never be answered with the game document.
      if (path === PAGE_CSS_PATH) return pageCssResponse();
      if (path.startsWith("/styles/")) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS } });

      if (path === "/play") return movedTo(url, "/play/");
      if (path === "/favicon.ico") return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });
      if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /*.json$\nDisallow: /*.jsonl$\nSitemap: https://sharktank.wizardgang.ai/sitemap.xml\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });
      if (path === "/sitemap.xml") {
        const routes = CANONICAL_HUMAN_ROUTES;
        const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>https://sharktank.wizardgang.ai${route}</loc></url>`).join("")}</urlset>`;
        return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });
      }


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

      // ── Ops pages: docs / status / audit ─────────────────────────────────────
      if (isOpsPath(path) && !(await opsAuthorized(request, env, url))) return opsDenied(env);
      if (path === "/admin/maintenance") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "maintenance") return json({ ok: false, error: "same-origin operation required" }, 403);
        let body: { enabled?: boolean; reason?: string };
        try { body = await request.json() as { enabled?: boolean; reason?: string }; } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
        if (typeof body.enabled !== "boolean") return json({ ok: false, error: "enabled must be boolean" }, 400);
        const setLobby = () => lobbyStub(env).fetch("https://lobby/maintenance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: body.enabled, reason: body.reason ?? "" }) });
        const setRooms = () => Promise.all(AUDIT_ROOMS.map((roomId) => roomFetch(env, roomId, `/maintenance?enabled=${body.enabled ? "1" : "0"}`, { method: "POST" })));
        const lobbyResponse = body.enabled ? await setLobby() : null;
        await setRooms();
        const finalResponse = lobbyResponse ?? await setLobby();
        if (!finalResponse.ok) return json({ ok: false, error: "unable to persist maintenance state" }, 502);
        const data = (await finalResponse.json()) as { maintenance: MaintenanceState; history?: ControlHistoryEntry | null; message?: string; openSecurityReports?: number };
        maintenanceCache = { state: data.maintenance, expiresAt: Date.now() + 1_000 };
        return json({ ok: true, maintenance: data.maintenance, history: data.history ?? null, message: data.message ?? "Maintenance state updated.", openSecurityReports: data.openSecurityReports ?? 0 });
      }
      if (path === "/admin/billing-reset") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "billing-reset") return json({ ok: false, error: "same-origin operation required" }, 403);
        const res = await lobbyStub(env).fetch("https://lobby/billing/reset", { method: "POST" });
        if (!res.ok) return json({ ok: false, error: "unable to reset billing counter" }, 502);
        return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      // ── MVP overview ─────────────────────────────────────────────────────────
      // One Lobby status read supplies incident-derived availability, billing,
      // receipt-chain integrity and the current release identity.
      if (path === "/") {
        const statusRes = await lobbyStub(env).fetch("https://lobby/status");
        const data = (await statusRes.json()) as PublicEvidenceStatus;
        const incidents = [...INCIDENTS, ...(data.maintenanceIncidents ?? [])].map((incident) => ({
          ...incident,
          title: tankCopy(incident.title),
          summary: tankCopy(incident.summary),
        }));
        const billing = publicBillingWindow(data.billingWindow ?? {});
        const integrity = data.historyIntegrity ?? {
          mode: "append-only tamper-evident hash chain",
          algorithm: "SHA-256",
          entryCount: 0,
          headHash: null,
        };
        return html(renderOverviewDocument({
          tank: incidentSummary(incidents),
          integrity,
          spendUsd: numberValue(recordValue(billing.allTime).estimatedVariableUsd),
          hardLimitUsd: numberValue(billing.hardLimitUsd) || 5,
          release: env.SHARKTANK_RELEASE ?? "development",
          environment: env.ENVIRONMENT ?? "unknown",
        }));
      }

      if (path === "/admin/status.json") {
        const res = await lobbyStub(env).fetch("https://lobby/status");
        const data = (await res.json()) as Record<string, unknown> & { maintenanceIncidents?: IncidentRecord[] };
        const incidents = [...INCIDENTS, ...(data.maintenanceIncidents ?? [])];
        return json({ ...data, availability: incidentSummary(incidents), incidents });
      }
      // Full state export. Behind operations authentication because it is every profile
      // and every receipt in one body; public backup/status feeds are retired.
      if (path === "/admin/backup.json") {
        const data = await fetchStateExport(env);
        return data ? json({ ok: true, export: data }) : json({ ok: false, error: "export refused" }, 502);
      }
      // Take a copy now, outside the schedule.
      if (path === "/admin/backup/run" && request.method === "POST") {
        const result = await runBackup(env);
        return json(result, result.ok ? 200 : 500);
      }
      // Restore drill: restore live state into a scratch object and compare digests.
      // Never writes to live state, so it is safe to run while the game is up.
      if (path === "/admin/backup/drill" && request.method === "POST") {
        const result = await runRestoreDrill(env);
        return json(result, result.ok ? 200 : 500);
      }

      // User action log (90-day retention) as JSON / JSONL.
      if (path === "/admin/log.json") {
        return lobbyStub(env).fetch("https://lobby/audit" + url.search);
      }
      if (path === "/admin/log.jsonl") {
        const res = await lobbyStub(env).fetch("https://lobby/audit" + url.search);
        const data = (await res.json()) as { events: unknown[] };
        return ndjson(data.events);
      }

      // Authenticated control room (HTML). Everything above this line under /admin/ is its
      // data; its actions remain visible in the operational receipt history.
      if (path === "/admin" || path === "/admin/") {
        return html(renderAdminDocument());
      }
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
      return html(renderNotFoundDocument(), 404);
    }

    // /play/ intentionally maps to the one
    // Vite-built document. Static assets keep their requested path and can therefore miss.
    const assetTarget = gameShell
      ? new Request(new URL("/index.html", request.url), { method: request.method, headers: request.headers })
      : request;
    const asset = await env.ASSETS.fetch(assetTarget);
    const secured = new Response(asset.body, asset); for (const [key, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(key, value); secured.headers.set("content-security-policy", assetCsp(mintNonce())); return secured;
  },

  // Cron. One daily copy of tank state to object storage; see runBackup. The handler
  // never throws: a backup failure is recorded as a receipt and left visible on /status/,
  // because a scheduled job that fails quietly is how a backup gap goes unnoticed.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runBackup(env).then((result) => { if (!result.ok) console.error("scheduled backup failed", result.error); }));
  },
};
