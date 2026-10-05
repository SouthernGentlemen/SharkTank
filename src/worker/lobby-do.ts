import type { TankRoom } from "module-react3fiber/protocol";
import { sanitizeDisplayName } from "module-react3fiber/protocol";

const CATALOG = [{ id: "room-1", name: "SharkTank" }] as const;
const ROOM_IDS = new Set<string>(CATALOG.map(({ id }) => id));
// Human seats per tank. Bots fill the rest of the 32-shark roster (see room-do.ts).
const CAPACITY = 8,
  STALE_MS = 70_000;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000,
  AUDIT_MAX_ROWS = 5_000,
  AUDIT_RATE_PER_MINUTE = 60;
/** Ceiling on retained rate buckets, so keying on the connection cannot grow unbounded. */
const RATE_BUCKET_CAP = 10_000;
/**
 * `maintenanceIncidents` is rewritten whole under a single Durable Object key, and a DO
 * value is capped at 128 KiB. Past that, `storage.put` throws inside the very handler that
 * persists `enabled: false` — an unbounded list would take the recovery path down with it.
 * Both ceilings sit well under the limit, and only resolved incidents are ever dropped.
 */
const MAINTENANCE_INCIDENT_CAP = 250,
  MAINTENANCE_INCIDENT_BYTES = 96 * 1024;
/**
 * The control receipt chain is advertised publicly as tamper-evident, so it has to be
 * checked rather than asserted. Two independent things are checked on read:
 *   1. Every retained entry is re-hashed from its own fields plus the hash of the entry
 *      before it, using the same function the append path uses. That catches an edited row.
 *   2. The head hash is compared against an anchor held under a Durable Object *KV* key,
 *      i.e. outside the SQLite table the chain lives in. A chain only ever checked against
 *      itself still verifies after its tail is cut off; an out-of-table anchor does not.
 * Re-walking the whole chain on every /incidents/ hit would make a public page pay for the
 * whole history, so a pass is bounded to the most recent CONTROL_HISTORY_VERIFY_WINDOW
 * entries and its result is cached until the chain grows or the cache goes stale.
 */
const CONTROL_HISTORY_HASH_VERSION = 1,
  CONTROL_HISTORY_GENESIS = "0".repeat(64),
  CONTROL_HISTORY_VERIFY_WINDOW = 2_000,
  CONTROL_HISTORY_REVERIFY_MS = 10 * 60 * 1000;
interface Report {
  players: number;
  bots: number;
  topScore: number;
  topName: string;
  at: number;
}
export interface AuditEvent {
  ts: number;
  type: string;
  room?: string;
  subject?: string;
  detail?: string;
}
export interface ControlHistoryEntry {
  sequence: number;
  ts: number;
  code: string;
  actor: string;
  title: string;
  summary: string;
  reference: string | null;
  detail: string | null;
  previousHash: string;
  hash: string;
}
/** The hashed body of one receipt. Exactly these fields, in exactly this order. */
interface ControlHistoryHashable {
  ts: number;
  code: string;
  actor: string;
  title: string;
  summary: string;
  reference: string | null;
  detail: string | null;
  previousHash: string;
}
/**
 * Head-of-chain marker persisted under a Durable Object KV key, deliberately *not* in the
 * `control_history` table, so that dropping rows from the table cannot also move the mark.
 */
interface ControlHistoryAnchor {
  sequence: number;
  hash: string;
  entryCount: number;
  updatedAt: number;
}
type ControlHistoryAnchorState =
  /** Anchor agrees with the recomputed head. */
  | "verified"
  /** No anchor existed (chain predates anchoring); the current head was adopted as one. */
  | "adopted"
  /** Anchor trails the chain, which only happens if an append failed part-way. Re-adopted. */
  | "stale"
  /** Anchor names a head the chain no longer has: entries were removed or rewritten. */
  | "mismatch";
type ControlHistoryChainStatus =
  | "empty"
  | "verified"
  | "tampered"
  /** The check itself could not run; says nothing either way about the chain. */
  | "unverified";
interface ControlHistoryIntegrity {
  // The first four are consumed by the Worker and must keep their names and types.
  mode: string;
  algorithm: string;
  entryCount: number;
  headHash: string | null;
  verified: boolean;
  chainStatus: ControlHistoryChainStatus;
  anchorState: ControlHistoryAnchorState | null;
  checkedEntries: number;
  coverage: "full" | "recent" | "none";
  failedAtSequence: number | null;
  headSequence: number | null;
  anchoredSequence: number | null;
  anchoredEntryCount: number | null;
  checkedAt: number;
}
interface ControlHistoryVerification {
  integrity: ControlHistoryIntegrity;
  /** Cache keys: a new head or a changed row count forces another pass. */
  headSequence: number | null;
  entryCount: number;
}
interface ControlHistoryInput {
  ts: number;
  code: string;
  actor: string;
  title: string;
  summary: string;
  reference?: string | null;
  detail?: string | null;
}
interface RateBucket {
  start: number;
  count: number;
}
export interface MaintenanceIncident {
  id: string;
  title: string;
  cause: string;
  status: "active" | "resolved";
  startedAt: number;
  resolvedAt: number | null;
  impactEndedAt?: number | null;
  summary: string;
}
export class Lobby implements DurableObject {
  private readonly reports = new Map<string, Report>();
  private readonly rates = new Map<string, RateBucket>();
  private maintenanceIncidents: MaintenanceIncident[] = [];
  private historyQueue: Promise<void> = Promise.resolve();
  /** Loaded lazily on first use, then kept in step with every append. */
  private historyAnchor: ControlHistoryAnchor | null = null;
  private historyAnchorLoaded = false;
  /** Last verification pass. Cleared implicitly whenever its cache keys stop matching. */
  private historyVerification: ControlHistoryVerification | null = null;
  constructor(
    private readonly ctx: DurableObjectState,
  ) {
    const auditTable = this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, room TEXT, subject TEXT, detail TEXT)",
    );
    auditTable.toArray();
    const auditIndex = this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts)",
    );
    auditIndex.toArray();
    const historyTable = this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS control_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, code TEXT NOT NULL, actor TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, reference TEXT, detail TEXT, previous_hash TEXT NOT NULL, hash TEXT NOT NULL)",
    );
    historyTable.toArray();
    const historyIndex = this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS control_history_ts ON control_history(ts)",
    );
    historyIndex.toArray();
    void this.ctx.blockConcurrencyWhile(async () => {
      this.maintenanceIncidents =
        (await this.ctx.storage.get<MaintenanceIncident[]>(
          "maintenanceIncidents",
        )) ?? [];
      const securityIncidentSemantics =
        await this.ctx.storage.get<string>("securityIncidentSemantics");
      if (securityIncidentSemantics !== "impact-v1") {
        const reopened: Array<{ id: string; impactEndedAt: number }> = [];
        for (const incident of this.maintenanceIncidents) {
          if (
            incident.cause !== "Independent security report" ||
            incident.status !== "resolved"
          )
            continue;
          const impactEndedAt = incident.impactEndedAt ?? incident.resolvedAt;
          if (impactEndedAt == null) continue;
          incident.status = "active";
          incident.impactEndedAt = impactEndedAt;
          incident.resolvedAt = null;
          reopened.push({ id: incident.id, impactEndedAt });
        }
        await this.ctx.storage.put({
          securityIncidentSemantics: "impact-v1",
          ...(reopened.length
            ? { maintenanceIncidents: this.maintenanceIncidents }
            : {}),
        });
        for (const incident of reopened)
          await this.appendControlHistory({
            ts: Date.now(),
            code: "SECURITY-REPORT-REOPENED",
            actor: "system",
            title: "Security report investigation restored",
            summary:
              "Corrected prior restoration semantics: service impact ended, but the security report remains open.",
            reference: incident.id,
            detail: `impactEndedAt=${new Date(incident.impactEndedAt).toISOString()}`,
          });
      }
      const lobbyCopy = await this.ctx.storage.get<string>("lobbyCopy");
      if (lobbyCopy !== "v2") {
        let changed = false;
        for (const incident of this.maintenanceIncidents) {
          const title = incident.title.replace(/\b(?:Arena|Lobby)\b/g, "Tank").replace(/\b(?:arena|lobby)\b/g, "tank");
          const summary = incident.summary.replace(/\b(?:Arena|Lobby)\b/g, "Tank").replace(/\b(?:arena|lobby)\b/g, "tank");
          if (title === incident.title && summary === incident.summary) continue;
          incident.title = title;
          incident.summary = summary;
          changed = true;
        }
        await this.ctx.storage.put({
          lobbyCopy: "v2",
          ...(changed ? { maintenanceIncidents: this.maintenanceIncidents } : {}),
        });
      }
      // Recovery for a list persisted by an earlier version, before the ceilings existed:
      // an oversized value still reads back, it just can no longer be written.
      const beforePrune = this.maintenanceIncidents.length;
      this.pruneIncidents();
      if (this.maintenanceIncidents.length !== beforePrune) {
        await this.ctx.storage.put(
          "maintenanceIncidents",
          this.maintenanceIncidents,
        );
      }
      const reports =
        (await this.ctx.storage.get<Record<string, Report>>("reports")) ?? {};
      for (const [id, report] of Object.entries(reports).filter(([id]) => ROOM_IDS.has(id)))
        this.reports.set(id, report);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname;
    if (path.endsWith("/report") && request.method === "POST") {
      const b = await safeJson<TankRoom & { topName?: string }>(request);
      if (!b || !ROOM_IDS.has(b.id))
        return json({ ok: false, error: "invalid room" }, 400);
      this.reports.set(b.id, {
        players: clampInt(b.players, 0, CAPACITY),
        bots: clampInt(b.bots ?? 24, 0, 32),
        topScore: clampInt(b.topScore, 0, 1e9),
        topName: sanitizeDisplayName(b.topName),
        at: Date.now(),
      });
      this.ctx.waitUntil(
        this.ctx.storage.put({
          reports: Object.fromEntries(this.reports),
        }),
      );
      return json({ ok: true });
    }
    if (path.endsWith("/event") && request.method === "POST") {
      const actor = request.headers.get("x-actor-id") ?? "server";
      if (!this.allow(actor)) return json({ ok: false, error: "rate limited" }, 429);
      const ev = await safeJson<AuditEvent>(request);
      if (!ev || !validEventType(ev.type))
        return json({ ok: false, error: "invalid event" }, 400);
      this.record(ev);
      return json({ ok: true });
    }
    if (path.endsWith("/audit")) {
      // The evidence page requests a bounded recent slice; authenticated callers may ask
      // for a larger retained window. The hard ceiling remains the 90-day retention cap.
      const limit = clampInt(
        Number(url.searchParams.get("limit") ?? 200),
        1,
        AUDIT_MAX_ROWS,
      );
      const cursor = this.ctx.storage.sql.exec<{
        [key: string]: string | number | null;
      }>(
        "SELECT ts,type,room,subject,detail FROM audit ORDER BY id DESC LIMIT ?",
        limit,
      );
      const events = cursor.toArray().reverse();
      return json({ ok: true, events, retentionDays: 90 });
    }
    if (path.endsWith("/incidents"))
      return json({
        ok: true,
        incidents: this.maintenanceIncidents,
        ...(await this.controlHistory(100)),
      });
    if (path.endsWith("/status"))
      return json({ ok: true, maintenanceIncidents: this.maintenanceIncidents, ...(await this.controlHistory(50)), rooms: this.list() });
    return json({ ok: true, rooms: this.list() });
  }

  /**
   * Drop the oldest resolved incidents until the list fits comfortably under the Durable
   * Object value limit. Active incidents are the recovery path and are never dropped, so a
   * list that is entirely active is left alone — the one-open-lockdown-at-a-time guard and
   * the single operator maintenance incident keep that set small by construction.
   */
  private pruneIncidents(): void {
    let bytes = JSON.stringify(this.maintenanceIncidents).length;
    if (
      this.maintenanceIncidents.length <= MAINTENANCE_INCIDENT_CAP &&
      bytes <= MAINTENANCE_INCIDENT_BYTES
    )
      return;
    const drop = new Set<number>(),
      resolvedOldestFirst = this.maintenanceIncidents
        .map((incident, index) => ({ incident, index }))
        .filter(({ incident }) => incident.status === "resolved")
        .sort(
          (a, b) =>
            a.incident.startedAt - b.incident.startedAt || a.index - b.index,
        );
    for (const { incident, index } of resolvedOldestFirst) {
      if (
        this.maintenanceIncidents.length - drop.size <=
          MAINTENANCE_INCIDENT_CAP &&
        bytes <= MAINTENANCE_INCIDENT_BYTES
      )
        break;
      drop.add(index);
      bytes -= JSON.stringify(incident).length + 1;
    }
    if (!drop.size) return;
    this.maintenanceIncidents = this.maintenanceIncidents.filter(
      (_, index) => !drop.has(index),
    );
    this.record({
      ts: Date.now(),
      type: "incidents-archived",
      subject: "system",
      detail: `${drop.size} resolved incident${drop.size === 1 ? "" : "s"} dropped to keep the incident record within the storage limit`,
    });
  }

  private allow(actor: string, limit = AUDIT_RATE_PER_MINUTE): boolean {
    const now = Date.now(),
      bucket = this.rates.get(actor);
    if (bucket && now - bucket.start < 60_000) {
      bucket.count += 1;
      return bucket.count <= limit;
    }
    if (!bucket && this.rates.size >= RATE_BUCKET_CAP) {
      this.sweepRates(now);
      // Still full means every bucket is live. Rather than evict a live one, per-key
      // accounting degrades to allow — the global public floor still bounds the flood.
      if (this.rates.size >= RATE_BUCKET_CAP) return true;
    }
    this.rates.set(actor, { start: now, count: 1 });
    return true;
  }
  /** Drop closed windows. A dropped bucket allows again on its next request regardless. */
  private sweepRates(now: number): void {
    for (const [key, bucket] of this.rates)
      if (now - bucket.start >= 60_000) this.rates.delete(key);
  }
  private record(ev: AuditEvent): void {
    const ts = clampInt(
      ev.ts || Date.now(),
      Date.now() - AUDIT_RETENTION_MS,
      Date.now() + 60_000,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO audit(ts,type,room,subject,detail) VALUES(?,?,?,?,?)",
      ts,
      ev.type.slice(0, 32),
      clean(ev.room, 32),
      ev.subject ? sanitizeDisplayName(ev.subject) : null,
      clean(ev.detail, 160),
    ).toArray();
    this.ctx.storage.sql.exec(
      "DELETE FROM audit WHERE ts < ? OR id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT ?)",
      Date.now() - AUDIT_RETENTION_MS,
      AUDIT_MAX_ROWS,
    ).toArray();
  }
  private list(): TankRoom[] {
    const now = Date.now();
    return CATALOG.map(({ id, name }) => {
      const r = this.reports.get(id),
        fresh = r && now - r.at < STALE_MS;
      return {
        id,
        name,
        players: fresh ? r.players : 0,
        bots: fresh ? r.bots : 24,
        capacity: CAPACITY,
        topScore: fresh ? r.topScore : 0,
        topName: fresh ? r.topName : "—",
      };
    });
  }
  private appendControlHistory(
    input: ControlHistoryInput,
  ): Promise<ControlHistoryEntry> {
    let entry!: ControlHistoryEntry;
    const task = this.historyQueue.then(async () => {
      entry = await this.appendControlHistoryNow(input);
    });
    this.historyQueue = task.catch(() => undefined);
    return task.then(() => entry);
  }
  private async appendControlHistoryNow(
    input: ControlHistoryInput,
  ): Promise<ControlHistoryEntry> {
    const previousCursor = this.ctx.storage.sql.exec<{ hash: string }>(
      "SELECT hash FROM control_history ORDER BY sequence DESC LIMIT 1",
    );
    const previousRows = previousCursor.toArray();
    const previousHash = previousRows[0]?.hash ?? CONTROL_HISTORY_GENESIS,
      normalized: ControlHistoryHashable = {
        ts: clampInt(input.ts, 0, Number.MAX_SAFE_INTEGER),
        code: (clean(input.code, 48) ?? "CONTROL-EVENT").toUpperCase(),
        actor: clean(input.actor, 64) ?? "system",
        title: clean(input.title, 120) ?? "Control event",
        summary: clean(input.summary, 320) ?? "Control event recorded.",
        reference: clean(input.reference, 120),
        detail: clean(input.detail, 1000),
        previousHash,
      },
      hash = await hashControlEntry(normalized);
    const insert = this.ctx.storage.sql.exec(
      "INSERT INTO control_history(ts,code,actor,title,summary,reference,detail,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
      normalized.ts,
      normalized.code,
      normalized.actor,
      normalized.title,
      normalized.summary,
      normalized.reference,
      normalized.detail,
      normalized.previousHash,
      hash,
    );
    insert.toArray();
    const sequenceCursor = this.ctx.storage.sql.exec<{ sequence: number }>(
      "SELECT sequence FROM control_history ORDER BY sequence DESC LIMIT 1",
    );
    const sequence = sequenceCursor.toArray()[0]?.sequence ?? 0;
    // Move the out-of-table head marker in the same breath as the row that created it.
    // A chain whose anchor is only ever written on read would treat a truncation that
    // happens between two reads as the new legitimate head.
    const previousAnchor = await this.loadHistoryAnchor(),
      entryCount =
        previousAnchor && previousAnchor.sequence < sequence
          ? previousAnchor.entryCount + 1
          : this.countControlHistoryRows();
    this.historyAnchor = { sequence, hash, entryCount, updatedAt: Date.now() };
    await this.ctx.storage.put({
      controlHistoryAnchor: this.historyAnchor,
    });
    // The chain grew, so the cached verification no longer describes it.
    this.historyVerification = null;
    return {
      sequence,
      ts: normalized.ts,
      code: normalized.code,
      actor: normalized.actor,
      title: normalized.title,
      summary: normalized.summary,
      reference: normalized.reference,
      detail: normalized.detail,
      previousHash: normalized.previousHash,
      hash,
    };
  }
  /**
   * Reads run through the same queue as appends, so a read can never observe a row whose
   * anchor has not been written yet and mistake the in-flight append for a stale anchor.
   */
  private controlHistory(limit: number): Promise<{
    history: ControlHistoryEntry[];
    historyIntegrity: ControlHistoryIntegrity;
  }> {
    let out!: {
      history: ControlHistoryEntry[];
      historyIntegrity: ControlHistoryIntegrity;
    };
    const task = this.historyQueue.then(async () => {
      out = await this.controlHistoryNow(limit);
    });
    this.historyQueue = task.catch(() => undefined);
    return task.then(() => out);
  }
  private async controlHistoryNow(limit: number): Promise<{
    history: ControlHistoryEntry[];
    historyIntegrity: ControlHistoryIntegrity;
  }> {
    const historyCursor = this.ctx.storage.sql.exec<{
      sequence: number;
      ts: number;
      code: string;
      actor: string;
      title: string;
      summary: string;
      reference: string | null;
      detail: string | null;
      previous_hash: string;
      hash: string;
    }>(
      "SELECT sequence,ts,code,actor,title,summary,reference,detail,previous_hash,hash FROM control_history ORDER BY sequence DESC LIMIT ?",
      limit,
    );
    const rows = historyCursor.toArray().reverse();
    const countCursor = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM control_history",
    );
    const entryCount = countCursor.toArray()[0]?.count ?? rows.length;
    const history = rows.map((row) => ({
      sequence: row.sequence,
      ts: row.ts,
      code: row.code,
      actor: row.actor,
      title: row.title,
      summary: row.summary,
      reference: row.reference,
      detail: row.detail,
      previousHash: row.previous_hash,
      hash: row.hash,
    }));
    return {
      history,
      historyIntegrity: await this.verifyControlHistory(entryCount),
    };
  }
  /**
   * Re-hash the retained chain and compare its head against the out-of-table anchor.
   *
   * Cost control: a pass is bounded to the newest CONTROL_HISTORY_VERIFY_WINDOW entries and
   * its verdict is cached in memory. The cache is thrown away when the head sequence or the
   * row count changes (any append, and any deletion), and it expires after
   * CONTROL_HISTORY_REVERIFY_MS so a long-resident instance still re-walks periodically.
   * Steady state on a public read is therefore one COUNT(*) and zero digests.
   */
  private async verifyControlHistory(
    entryCount: number,
  ): Promise<ControlHistoryIntegrity> {
    const base = {
      mode: "append-only tamper-evident hash chain",
      algorithm: "SHA-256",
      entryCount,
    };
    const headCursor = this.ctx.storage.sql.exec<{
      sequence: number;
      hash: string;
    }>("SELECT sequence,hash FROM control_history ORDER BY sequence DESC LIMIT 1");
    const headRow = headCursor.toArray()[0] ?? null;
    const headSequence = headRow?.sequence ?? null,
      headHash = headRow?.hash ?? null;
    const cached = this.historyVerification;
    if (
      cached &&
      cached.headSequence === headSequence &&
      cached.entryCount === entryCount &&
      Date.now() - cached.integrity.checkedAt < CONTROL_HISTORY_REVERIFY_MS
    )
      return { ...cached.integrity, ...base };
    let integrity: ControlHistoryIntegrity;
    try {
      integrity = await this.walkControlHistory(
        entryCount,
        headSequence,
        headHash,
      );
    } catch {
      // The check failed to run. That is not evidence of tampering, and saying so would be
      // a worse lie than the unverified claim this replaced, so it reports neither.
      return {
        ...base,
        headHash,
        verified: false,
        chainStatus: "unverified",
        anchorState: null,
        checkedEntries: 0,
        coverage: "none",
        failedAtSequence: null,
        headSequence,
        anchoredSequence: this.historyAnchor?.sequence ?? null,
        anchoredEntryCount: this.historyAnchor?.entryCount ?? null,
        checkedAt: Date.now(),
      };
    }
    // "adopted" and "stale" describe the pass that fixed the anchor, not a standing
    // condition: by the time the next read is served the anchor does match, so the cached
    // verdict says "verified" rather than repeating a one-off event for ten minutes.
    this.historyVerification = {
      integrity:
        integrity.anchorState === "adopted" || integrity.anchorState === "stale"
          ? { ...integrity, anchorState: "verified" }
          : integrity,
      headSequence,
      entryCount,
    };
    return integrity;
  }
  private async walkControlHistory(
    entryCount: number,
    headSequence: number | null,
    headHash: string | null,
  ): Promise<ControlHistoryIntegrity> {
    const anchor = await this.loadHistoryAnchor(),
      now = Date.now(),
      base = {
        mode: "append-only tamper-evident hash chain",
        algorithm: "SHA-256",
        entryCount,
        headHash,
        headSequence,
        checkedAt: now,
      };
    if (headSequence === null || headHash === null) {
      // No rows. An anchor pointing at a head that no longer exists is the truncation case
      // this whole mechanism exists to catch, so an empty table is only innocent when
      // nothing was ever anchored.
      const state: ControlHistoryAnchorState | null = anchor
        ? "mismatch"
        : null;
      return {
        ...base,
        verified: !anchor,
        chainStatus: anchor ? "tampered" : "empty",
        anchorState: state,
        checkedEntries: 0,
        coverage: "none",
        failedAtSequence: null,
        anchoredSequence: anchor?.sequence ?? null,
        anchoredEntryCount: anchor?.entryCount ?? null,
      };
    }
    const walkCursor = this.ctx.storage.sql.exec<{
      sequence: number;
      ts: number;
      code: string;
      actor: string;
      title: string;
      summary: string;
      reference: string | null;
      detail: string | null;
      previous_hash: string;
      hash: string;
    }>(
      "SELECT sequence,ts,code,actor,title,summary,reference,detail,previous_hash,hash FROM control_history ORDER BY sequence DESC LIMIT ?",
      CONTROL_HISTORY_VERIFY_WINDOW,
    );
    const walk = walkCursor.toArray().reverse();
    const coverage: "full" | "recent" =
      walk.length >= entryCount ? "full" : "recent";
    // A full walk must start at the genesis hash. A bounded one starts from the oldest
    // retained row's own recorded predecessor, which is stated in `coverage` rather than
    // passed off as if the whole chain had been checked.
    let expected =
      coverage === "full"
        ? CONTROL_HISTORY_GENESIS
        : (walk[0]?.previous_hash ?? CONTROL_HISTORY_GENESIS);
    let failedAtSequence: number | null = null,
      checkedEntries = 0;
    for (const row of walk) {
      if (row.previous_hash !== expected) {
        failedAtSequence = row.sequence;
        break;
      }
      const recomputed = await hashControlEntry({
        ts: row.ts,
        code: row.code,
        actor: row.actor,
        title: row.title,
        summary: row.summary,
        reference: row.reference,
        detail: row.detail,
        previousHash: row.previous_hash,
      });
      checkedEntries += 1;
      if (recomputed !== row.hash) {
        failedAtSequence = row.sequence;
        break;
      }
      expected = row.hash;
    }
    const hashesOk = failedAtSequence === null;
    let anchorState: ControlHistoryAnchorState;
    if (!anchor) {
      // Receipts written before anchoring existed have nothing to compare against. Adopting
      // the present head is the only honest option: it makes every *future* truncation
      // detectable without pretending the ones before it would have been.
      anchorState = "adopted";
      if (hashesOk) await this.writeHistoryAnchor(headSequence!, headHash!, entryCount);
    } else if (
      anchor.sequence === headSequence &&
      anchor.hash === headHash &&
      anchor.entryCount === entryCount
    )
      anchorState = "verified";
    else if (anchor.sequence > headSequence! || anchor.entryCount > entryCount)
      // The anchor names a longer chain than the table holds: rows were cut from the tail
      // or removed from the middle. This is exactly what a self-referential chain misses.
      anchorState = "mismatch";
    else if (anchor.hash !== headHash && anchor.sequence === headSequence)
      anchorState = "mismatch";
    else {
      // The anchor trails a chain that still verifies — an append that recorded its row but
      // not its marker. Catch the marker up rather than crying tamper.
      anchorState = "stale";
      if (hashesOk) await this.writeHistoryAnchor(headSequence!, headHash!, entryCount);
    }
    const verified = hashesOk && anchorState !== "mismatch";
    return {
      ...base,
      verified,
      chainStatus: verified ? "verified" : "tampered",
      anchorState,
      checkedEntries,
      coverage,
      failedAtSequence,
      anchoredSequence: this.historyAnchor?.sequence ?? null,
      anchoredEntryCount: this.historyAnchor?.entryCount ?? null,
    };
  }
  private async loadHistoryAnchor(): Promise<ControlHistoryAnchor | null> {
    if (this.historyAnchorLoaded) return this.historyAnchor;
    this.historyAnchor =
      (await this.ctx.storage.get<ControlHistoryAnchor>(
        "controlHistoryAnchor",
      )) ?? null;
    this.historyAnchorLoaded = true;
    return this.historyAnchor;
  }
  private async writeHistoryAnchor(
    sequence: number,
    hash: string,
    entryCount: number,
  ): Promise<void> {
    this.historyAnchor = { sequence, hash, entryCount, updatedAt: Date.now() };
    this.historyAnchorLoaded = true;
    await this.ctx.storage.put("controlHistoryAnchor", this.historyAnchor);
  }
  private countControlHistoryRows(): number {
    const cursor = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM control_history",
    );
    const count = cursor.toArray()[0]?.count ?? 0;
    return count;
  }

}
/**
 * The one and only receipt hash. Both the append path and the verifier call this, because
 * two implementations that drift by a single field or key order would make verification
 * fail on honest data and be indistinguishable from a real tamper alarm.
 */
async function hashControlEntry(
  entry: ControlHistoryHashable,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        version: CONTROL_HISTORY_HASH_VERSION,
        ts: entry.ts,
        code: entry.code,
        actor: entry.actor,
        title: entry.title,
        summary: entry.summary,
        reference: entry.reference,
        detail: entry.detail,
        previousHash: entry.previousHash,
      }),
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function validEventType(type: unknown): type is string {
  return (
    typeof type === "string" &&
    /^(room-boot|join|leave|death)$/.test(
      type,
    )
  );
}
function clean(value: unknown, max: number): string | null {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max)
    : null;
}
function clampInt(value: number, min: number, max: number): number {
  return Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min),
  );
}
async function safeJson<T>(request: Request): Promise<T | null> {
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return null;
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
