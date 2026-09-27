// Local host Worker: serves the built R3F client (via ASSETS), a small JSON API
// (lobby / profile / global leaderboard) backed by the Lobby DO, and
// upgrades /room/:id/ws WebSockets into the Room Durable Object.
//
// Imports ONLY the server-safe entry points of module-react3fiber (never the client),
// so no browser libs leak into the Worker/DO bundle.

import { API } from "module-react3fiber/protocol";
import { OPENAPI, openApiToHtml } from "./openapi.js";

export { Room } from "./room-do.js";
export { Lobby } from "./lobby-do.js";
import type { Env, MaintenanceState } from "./env.js";
import { assetCsp, SECURITY_HEADERS, html, json, mintNonce, movedTo, ndjson, opsDenied, tlsRequired } from "./responses.js";
import { CANONICAL_HUMAN_ROUTES, isGameShellPath, isOpsPath, isStaticAssetPath, parseRoomPath } from "./routes.js";
import { numberValue, publicBillingWindow, publicStatusProjection, recordValue } from "./presentation-data.js";
import {
  AUDIT_ROOMS,
  AUDIT_ROOM_NAMES,
  CAPTURE_WINDOW_MS,
  INCIDENTS,
  LOG_FETCH_CAPTURES,
  LOG_FETCH_SERVICE,
  PAGE_CSS_PATH,
  gameLogText,
  incidentSummary,
  normalizeGameLogEvent,
  normalizeServiceLogEvent,
  pageCssResponse,
  tankCopy,
  type ControlHistoryEntry,
  type ControlHistoryIntegrity,
  type GameLogWireEvent,
  type IncidentRecord,
  type PublicEvidenceStatus,
  type PublicLogEvent,
} from "./presentation.js";
import {
  renderAdminDocument,
  renderDowntimeDocument,
  renderEvidenceDocument,
  renderNotFoundDocument,
  renderOpenApiDocument,
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


/**
 * Read a request body with a hard byte ceiling, enforced on the bytes that actually arrive.
 *
 * `Content-Length` is absent on a chunked request, so a cap read from that header alone is
 * simply not applied to a body sent with `Transfer-Encoding: chunked` — the check passes on
 * `Number(null) === 0`. The header is still consulted first, because refusing an oversized
 * body before reading it is cheaper, but it is an optimisation rather than the control: the
 * stream is counted as it is consumed and cancelled the moment it passes the cap.
 *
 * Returns null when the body is too large. The caller turns that into a 413.
 */
const BODY_CAP_BYTES = 16_384;
async function readCappedBody(request: Request, cap = BODY_CAP_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) return null;
  const stream = request.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}


function lobbyStub(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}

const ALLOWED_ROOMS = new Set(["room-1", "room-2", "room-3", "room-4"]);
const PUBLIC_AUDIT_TYPES = new Set(["play", "customize"]);
function cookie(request: Request, name: string): string | null {
  const found = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(name + "="));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}
function profileId(request: Request): { id: string; fresh: boolean } {
  const existing = cookie(request, "wg_player");
  return existing && /^[a-f0-9-]{36}$/.test(existing) ? { id: existing, fresh: false } : { id: crypto.randomUUID(), fresh: true };
}
/**
 * Rate-limit identity for unauthenticated public writes. It must not be anything the
 * client chooses: `wg_player` is the caller's own cookie, so omitting it mints a fresh
 * identity — and a fresh bucket — on every request. CF-Connecting-IP is stamped by the
 * edge and cannot be set by the client. When it is absent (`wrangler dev`) every caller
 * falls into one shared bucket, which limits harder rather than softer.
 */
function connectionRateKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "edge";
}

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
 * The public writes that cost money: each one is a write into the single global Lobby
 * Durable Object, which is what the metered spend is mostly made of.
 */
const METERED_PUBLIC_WRITES = new Set<string>([API.profile, "/api/audit"]);
/**
 * Paths that keep answering while the gate is closed.
 *
 * The gate closes for two reasons: an operator opens it deliberately, or measured spend
 * reaches the hard limit and `enforceSpendLimit` closes it. In the second case the whole
 * point is to stop spending, so the routes that generate the billable writes have to close
 * with it — exempting all of `/api/*` meant the ceiling stopped the game while leaving the
 * two unauthenticated write paths taking Durable Object writes at full rate.
 *
 * Reads stay up: the evidence pages, the JSON behind them and `GET /api/*` are how anyone
 * finds out *why* the service stopped, and a transparency estate that goes dark at exactly
 * the moment it has something to explain is worth nothing. `/api/security-report` stays up
 * for the same reason — the white-hat intake must never be closed by a spend event.
 */
function maintenanceBypass(path: string, method: string): boolean {
  if (METERED_PUBLIC_WRITES.has(path) && method !== "GET" && method !== "HEAD") return false;
  // The stylesheet and enhancement script used by the surviving Worker-rendered pages.
  if (path.startsWith("/styles/") || path === "/assets/human-docs.js") return true;
  return path === "/" || path === "/robots.txt" || path === "/sitemap.xml" ||
    path === API.health || path === API.tank || path === API.profile || path === API.leaderboard ||
    path === "/api/audit" || path === "/api/security-report" ||
    path === "/docs" || path.startsWith("/docs/") || path === "/openapi.json" ||
    path === "/status.json" || path === "/incidents.json" || path === "/spend.json" ||
    path === "/evidence" || path === "/evidence/" ||
    path === "/logs.json" || path.startsWith("/logs/game/") ||
    path === "/admin" || path.startsWith("/admin/");
}


/**
 * Record a white-hat security report. Whether it also takes the game down is decided by the
 * route that called this — never by the request — so the unauthenticated public intake can
 * only ever append a report, an audit event, and a control receipt. Only the ops-gated
 * /admin/security-report passes `lockdown`, which enables maintenance and closes tank sockets.
 */
async function securityReport(request: Request, url: URL, env: Env, lockdown: boolean): Promise<Response> {
  const report = {
    id: `white-hat-${crypto.randomUUID()}`,
    reportedAt: new Date().toISOString(),
    environment: env.ENVIRONMENT ?? "unknown",
    deploymentVersion: env.CF_VERSION_METADATA?.id ?? "local",
    route: url.pathname,
    colo: request.cf?.colo ?? null,
    country: request.cf?.country ?? null,
    userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 160),
    lockdown,
  };
  const reportResponse = await lobbyStub(env).fetch("https://lobby/security-report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
  if (reportResponse.status === 429) return json({ ok: false, error: "a security report was accepted moments ago; please wait before sending another" }, 429);
  if (!reportResponse.ok) return json({ ok: false, error: lockdown ? "report and lockdown could not be persisted" : "report could not be persisted" }, 502);
  const receipt = (await reportResponse.json()) as Record<string, unknown> & { maintenance?: MaintenanceState };
  if (!lockdown) return json(receipt);
  if (receipt.maintenance) maintenanceCache = { state: receipt.maintenance, expiresAt: Date.now() + 1_000 };
  const roomResults = await Promise.allSettled(AUDIT_ROOMS.map((roomId) => roomFetch(env, roomId, "/maintenance?enabled=1", { method: "POST" })));
  const disconnectedRooms = roomResults.filter((result) => result.status === "fulfilled" && result.value.ok).length;
  return json({ ...receipt, disconnectedRooms, roomCount: AUDIT_ROOMS.length });
}


/** Fetch a path on the Room DO instance for `roomId` (game log / replay). */
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
async function incidentData(env: Env): Promise<{ incidents: IncidentRecord[]; history: ControlHistoryEntry[]; historyIntegrity: ControlHistoryIntegrity }> { const res = await lobbyStub(env).fetch("https://lobby/incidents"); const data = (await res.json()) as { incidents?: IncidentRecord[]; history?: ControlHistoryEntry[]; historyIntegrity?: ControlHistoryIntegrity }; return { incidents: [...INCIDENTS, ...(data.incidents ?? [])].map((incident) => ({ ...incident, title: tankCopy(incident.title), summary: tankCopy(incident.summary) })), history: data.history ?? [], historyIntegrity: data.historyIntegrity ?? { mode: "append-only tamper-evident hash chain", algorithm: "SHA-256", entryCount: 0, headHash: null } }; }
/**
 * Availability bar, measured from the first hour of the project to now.
 *
 * Reorganised into two explicitly labelled lanes with a real time axis. Previously the
 * two stacked strips were unlabelled and `preserveAspectRatio="none"` stretched the
 * markers into wedges, so the chart showed colour without saying what was being
 * measured or when. Every marker is now a link to its control receipt — or, when a
 * control never produced one, to the incident's own card — so nothing on the chart is
 * a dead end.
 */

/** The whole public log record: 90 days of service evidence, 24 hours of captures. */
async function publicLogData(env: Env) {
  const [serviceResponse, ...roomResponses] = await Promise.all([
    lobbyStub(env).fetch(`https://lobby/audit?limit=${LOG_FETCH_SERVICE}`),
    ...AUDIT_ROOMS.map((room) => roomFetch(env, room, `/log?limit=${LOG_FETCH_CAPTURES}`)),
  ]);
  const serviceData = (await serviceResponse.json()) as { events?: PublicLogEvent[] };
  const roomData = await Promise.all(roomResponses.map((response) => response.json() as Promise<{ events?: GameLogWireEvent[] }>));
  const serviceEvents = serviceData.events ?? [];
  // The room prunes past 24 hours, but a snapshot restored from storage can still hand
  // back an older row; filter here so the page's stated window is always the true one.
  const cutoff = Date.now() - CAPTURE_WINDOW_MS;
  const tanks = AUDIT_ROOMS.map((room, index) => ({
    room,
    records: (roomData[index].events ?? []).filter((event) => event.ts >= cutoff).map(normalizeGameLogEvent),
  }));
  return {
    serviceEvents,
    service: serviceEvents.map(normalizeServiceLogEvent),
    tanks,
    caps: {
      serviceTruncated: serviceEvents.length >= LOG_FETCH_SERVICE,
      captureTruncated: tanks.some((tank) => tank.records.length >= LOG_FETCH_CAPTURES),
    },
  };
}


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
      if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /docs/\nDisallow: /logs/game/\nDisallow: /*.json$\nDisallow: /*.jsonl$\nSitemap: https://sharktank.wizardgang.ai/sitemap.xml\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });
      if (path === "/sitemap.xml") {
        const routes = CANONICAL_HUMAN_ROUTES;
        const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>https://sharktank.wizardgang.ai${route}</loc></url>`).join("")}</urlset>`;
        return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", ...SECURITY_HEADERS } });
      }


      // ── WebSocket → Room DO ────────────────────────────────────────────────
      const roomId = parseRoomPath(path);
      if (roomId) {
        if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
        if (!ALLOWED_ROOMS.has(roomId)) return json({ ok: false, error: "unknown room" }, 404);
        const origin = request.headers.get("origin");
        if (origin && new URL(origin).host !== url.host) return json({ ok: false, error: "origin rejected" }, 403);
        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);
        const name = url.searchParams.get("roomName") ?? roomId;
        const fwd = new URL(request.url);
        fwd.searchParams.set("roomId", roomId);
        fwd.searchParams.set("roomName", name);
        return stub.fetch(new Request(fwd.toString(), request));
      }

      // ── HTTP API ───────────────────────────────────────────────────────────
      if (path === API.health) {
        return json({ ok: true, module: "module-react3fiber", release: env.SHARKTANK_RELEASE ?? "unknown", time: new Date().toISOString() });
      }

      if (path === "/version.json") {
        return json({ product: "SharkTank", release: env.SHARKTANK_RELEASE ?? "unknown", environment: env.ENVIRONMENT ?? "unknown" });
      }

      if (path === API.tank) {
        const stub = env.LOBBY.get(env.LOBBY.idFromName("global"));
        return stub.fetch("https://lobby/list");
      }

      if (path === API.leaderboard) {
        const stub = env.LOBBY.get(env.LOBBY.idFromName("global"));
        return stub.fetch("https://lobby/leaderboard");
      }

      // Profile read/write. The write is unauthenticated by design — one GET mints a
      // `wg_player` cookie and that cookie is the whole identity — so the cookie cannot be
      // the throttle key: dropping it buys a fresh identity and a fresh allowance on every
      // request. `x-rate-key` is built here from the edge connection, exactly as /api/audit
      // does, and the DO buckets the write on it. Both the body cap and the key are set from
      // scratch so a client-supplied copy of either never reaches the Durable Object.
      if (path === API.profile) {
        if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        const owner = profileId(request);
        let body: string | undefined;
        if (request.method === "POST") {
          const read = await readCappedBody(request);
          if (read === null) return json({ ok: false, error: "payload too large" }, 413);
          body = read;
        }
        const headers = new Headers(request.headers);
        headers.set("x-profile-id", owner.id);
        headers.set("content-type", "application/json");
        headers.set("x-rate-key", connectionRateKey(request));
        headers.delete("content-length");
        const res = await lobbyStub(env).fetch("https://lobby/profile", { method: request.method, headers, body });
        if (!owner.fresh) return res;
        const out = new Response(res.body, res); out.headers.append("set-cookie", `wg_player=${owner.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`); return out;
      }

      // Client-emitted user actions → the Lobby DO's 90-day user log.
      if (path === "/api/audit" && request.method === "POST") {
        const owner = profileId(request);
        const raw = await readCappedBody(request);
        if (raw === null) return json({ ok: false, error: "payload too large" }, 413);
        let body: { type?: string; room?: string; detail?: string };
        try { body = JSON.parse(raw) as { type?: string; room?: string; detail?: string }; } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
        if (!body.type || !PUBLIC_AUDIT_TYPES.has(body.type)) return json({ ok: false, error: "unsupported public event type" }, 400);
        const room = typeof body.room === "string" && ALLOWED_ROOMS.has(body.room) ? body.room : undefined;
        if (body.type === "play" && !room) return json({ ok: false, error: "valid room required" }, 400);
        const detail = body.type === "play"
          ? `Selected ${room}`
          : /^skin [a-z0-9-]{1,32}$/i.test(body.detail ?? "")
            ? body.detail
            : "Profile customization opened";
        // One Durable Object call, not two. x-rate-key is built here from the edge
        // connection and marks this event as publicly written: the Lobby DO buckets on it
        // instead of on the caller's cookie, and holds these rows to their own retention
        // floor. The display name is resolved inside the DO, behind that rate limit, so a
        // rejected flood costs no profile read. Both headers are built from scratch, so
        // client-supplied copies never reach the DO.
        const auditRes = await lobbyStub(env).fetch("https://lobby/event", {
          method: "POST",
          headers: { "content-type": "application/json", "x-actor-id": owner.id, "x-rate-key": connectionRateKey(request), "x-profile-id": owner.id },
          body: JSON.stringify({ ts: Date.now(), type: body.type, room, detail }),
        });
        const response = auditRes.status === 429 ? json({ ok: false, error: "rate limited" }, 429) : json({ ok: auditRes.ok }, auditRes.ok ? 200 : 400);
        if (owner.fresh) response.headers.append("set-cookie", `wg_player=${owner.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`);
        return response;
      }

      // Public white-hat intake. Records the report and raises it to operations; it must
      // never change service state, because nothing here is authenticated — the origin and
      // x-wg-security-report headers are CSRF defence, not authorization, and both are
      // trivially set by a non-browser client. Taking the game offline is an operator
      // decision made at /admin/security-report below, behind ops auth.
      if (path === "/api/security-report" && request.method === "POST") {
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-security-report") !== "white-hat") return json({ ok: false, error: "same-origin report required" }, 403);
        return securityReport(request, url, env, false);
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
      if (path === "/admin/security-resolve") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "security-resolve") return json({ ok: false, error: "same-origin operation required" }, 403);
        let body: { ownerConfirmed?: boolean; dryRun?: boolean; note?: string };
        try { body = await request.json() as { ownerConfirmed?: boolean; dryRun?: boolean; note?: string }; } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
        if (!body.ownerConfirmed || !body.dryRun) return json({ ok: false, error: "owner confirmation and dry-run flag required" }, 400);
        const res = await lobbyStub(env).fetch("https://lobby/security-report/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (path === "/admin/billing-reset") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "billing-reset") return json({ ok: false, error: "same-origin operation required" }, 403);
        const res = await lobbyStub(env).fetch("https://lobby/billing/reset", { method: "POST" });
        if (!res.ok) return json({ ok: false, error: "unable to reset billing counter" }, 502);
        return new Response(res.body, { status: res.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (path === "/admin/security-report") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "security-report") return json({ ok: false, error: "same-origin operation required" }, 403);
        return securityReport(request, url, env, true);
      }
      if (path === "/admin/test-alert") {
        if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
        if (request.headers.get("origin") !== url.origin || request.headers.get("x-wg-ops-action") !== "test-alert") return json({ ok: false, error: "same-origin operation required" }, 403);
        let body: { code?: string };
        try { body = await request.json() as { code?: string }; } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
        const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
        if (!/^[A-Z][0-9]{3}$/.test(code)) return json({ ok: false, error: "code must be exactly one ASCII letter followed by three digits" }, 400);
        const event = await lobbyStub(env).fetch("https://lobby/test-alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        if (!event.ok) return json({ ok: false, error: "unable to record test alert" }, 502);
        return new Response(event.body, { status: event.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
      }
      if (path === "/docs/openapi.json" || path === "/openapi.json") {
        return json(OPENAPI);
      }
      if (path === "/docs" || path === "/docs/") {
        const response = html(renderOpenApiDocument(openApiToHtml(OPENAPI)));
        response.headers.set("x-robots-tag", "noindex");
        return response;
      }



      if (path === "/evidence") return movedTo(url, "/evidence/");
      if (path === "/evidence/") {
        const [statusRes, incidentRecord, logs] = await Promise.all([
          lobbyStub(env).fetch("https://lobby/status"),
          incidentData(env),
          publicLogData(env),
        ]);
        const data = (await statusRes.json()) as PublicEvidenceStatus;
        return html(renderEvidenceDocument(data, incidentRecord, logs));
      }

      if (path === "/incidents.json") { const data = await incidentData(env); return json({ ok: true, summary: incidentSummary(data.incidents), ...data }); }

      if (path === "/spend.json") {
        const res = await lobbyStub(env).fetch("https://lobby/status");
        const data = (await res.json()) as { billingWindow?: Record<string, unknown> };
        return json({ ok: true, billingWindow: publicBillingWindow(data.billingWindow ?? {}) });
      }
      const publicGameLog = path.match(/^\/logs\/game\/([^/]+)\.txt$/);
      if (publicGameLog) {
        const roomId = decodeURIComponent(publicGameLog[1]);
        if (!AUDIT_ROOMS.includes(roomId)) return json({ ok: false, error: "unknown room" }, 404);
        const res = await roomFetch(env, roomId, `/log?limit=${LOG_FETCH_CAPTURES}`);
        const data = (await res.json()) as { events?: GameLogWireEvent[] };
        const cutoff = Date.now() - CAPTURE_WINDOW_MS;
        return gameLogText(roomId, (data.events ?? []).filter((event) => event.ts >= cutoff));
      }
      if (path === "/logs.json") {
        const { service, tanks, caps } = await publicLogData(env);
        const gameTanks = AUDIT_ROOMS.map((room, index) => ({ tankId: room, tank: AUDIT_ROOM_NAMES[room] ?? room, download: `/logs/game/${room}.txt`, records: tanks[index].records }));
        return json({ ok: true, retention: { serviceDays: 90, captureHours: 24, serviceRecords: service.length, capturesPerTankLimit: LOG_FETCH_CAPTURES, truncated: caps }, serviceFormat: ["timestamp", "reasonCode", "action", "subject", "details"], captureFormat: ["timestamp", "reasonCode", "tick", "action", "name", "details"], events: service, gameTanks });
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
      if (path === "/status.json") {
        const res = await lobbyStub(env).fetch("https://lobby/status");
        const data = (await res.json()) as Record<string, unknown> & { maintenanceIncidents?: IncidentRecord[]; billingWindow?: unknown; usage?: Record<string, unknown> };
        const incidents = [...INCIDENTS, ...(data.maintenanceIncidents ?? [])];
        const { publicData, publicUsage } = publicStatusProjection(data);
        const tankAvailability = incidentSummary(incidents), portalAvailability = incidentSummary([]);
        return json({ ...publicData, usage: publicUsage, availability: tankAvailability, tankAvailability, portalAvailability, incidents });
      }
      // Full state export. Behind operations authentication because it is every profile
      // and every receipt in one body; the public evidence for backups is the shape and
      // timing panel on /status/, not the contents.
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

      // Per-game deterministic log (3-day retention): seed + action stream.
      const gameLog = path.match(/^\/admin\/game\/([^/]+?)(\.jsonl|\.json)?$/);
      if (gameLog) {
        const roomId = decodeURIComponent(gameLog[1]);
        const res = await roomFetch(env, roomId, "/log");
        const data = (await res.json()) as { events: unknown[] };
        if (gameLog[2] === ".jsonl") return ndjson(data.events);
        return json(data);
      }

      // Deterministic replay of a game's state at ?tick=T (rollback / fast-forward).
      const replayMatch = path.match(/^\/admin\/replay\/([^/]+?)(\.json)?$/);
      if (replayMatch) {
        const roomId = decodeURIComponent(replayMatch[1]);
        return roomFetch(env, roomId, "/replay?tick=" + encodeURIComponent(url.searchParams.get("tick") ?? ""));
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
