import type {
  TankRoom,
  Profile,
} from "module-react3fiber/protocol";
import { sanitizeDisplayName } from "module-react3fiber/protocol";
import { DEFAULT_SKIN, SKINS } from "module-react3fiber/engine";

const CATALOG = [
  { id: "room-1", name: "Pacific" },
  { id: "room-2", name: "Atlantic" },
  { id: "room-3", name: "Indian" },
  { id: "room-4", name: "Arctic" },
] as const;
// Human seats per tank. Bots fill the rest of the 32-shark roster (see room-do.ts).
const CAPACITY = 8,
  STALE_MS = 70_000;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000,
  AUDIT_MAX_ROWS = 5_000,
  AUDIT_RATE_PER_MINUTE = 60;
/**
 * Public writes reach the audit log through the unauthenticated /api/audit route, so they
 * get two limits the trusted server-side callers do not: a per-connection bucket plus a
 * global floor across every public caller at once (Lobby is a singleton DO, so an
 * in-memory counter is a real global limit).
 */
const PUBLIC_AUDIT_RATE_PER_MINUTE = 240;
/**
 * Profile writes, per edge connection and across every public caller at once.
 *
 * A profile save is a Durable Object write on the one global instance, and the identity it
 * writes under is a cookie the caller mints for itself, so nothing about the caller bounds
 * it. `PROFILE_CAP` bounds how many rows may be *created*; it says nothing about how often
 * an existing row may be overwritten, and an overwrite costs the same write as a creation.
 * These two buckets are what bound the overwrite. The per-minute figures are set well above
 * a person playing — a save happens on a name change or a new best score — and well below a
 * loop.
 */
const PROFILE_WRITE_RATE_PER_MINUTE = 20;
const PUBLIC_PROFILE_WRITE_RATE_PER_MINUTE = 120;
/**
 * The types /api/audit is allowed to write, and the number of such rows kept. Trimming to
 * AUDIT_MAX_ROWS alone means a flood of public rows evicts every server-recorded row from
 * the 90-day log; holding public rows to their own floor means a flood can only evict
 * other public rows, leaving AUDIT_MAX_ROWS - AUDIT_PUBLIC_MAX_ROWS for real evidence.
 */
const PUBLIC_AUDIT_TYPES = ["play", "customize"] as const,
  AUDIT_PUBLIC_MAX_ROWS = 1_500;
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
/**
 * A client with no cookie is handed a fresh identity, so `profile:*` rows are created by
 * anyone who asks for one and nothing ever removed them. The id format is constrained, so
 * this is a volume problem rather than key injection: unlimited minted UUIDs meant
 * unlimited rows. Creation of *new* rows is what gets capped — an existing profile is
 * always readable and always writable, because the cheap fix (evicting rows to make room)
 * would delete real players' saved names and scores to absorb someone else's flood.
 * Eviction is therefore limited to rows that are provably disposable: never seen for the
 * full audit retention window and holding no score at all. Rows written before this cap
 * existed carry no last-seen stamp and are never evicted on that basis.
 */
const PROFILE_CAP = 2_000,
  PROFILE_STALE_MS = AUDIT_RETENTION_MS,
  PROFILE_SCAN_PAGE = 500,
  PROFILE_SCAN_PAGES = 8,
  PROFILE_REFUSAL_AUDIT_INTERVAL_MS = 60_000;
interface Env {
  AUDIT_GENERATION?: string;
  BILLING_HARD_LIMIT_USD?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  R2_ASSETS?: R2Bucket;
  R2_BUCKET_NAME?: string;
  R2_PREFIX?: string;
  ROOM: DurableObjectNamespace;
}
interface Report {
  players: number;
  bots: number;
  topScore: number;
  topName: string;
  at: number;
  activeDurationMs: number;
  wsMessages: number;
  connections: number;
  storageWrites: number;
  storageRowsRead: number;
  storageRowsWritten: number;
  storageBytes: number;
}
/** One point on the spend trend: cumulative metered spend and volume at a moment. */
interface SpendSample {
  ts: number;
  usd: number;
  requests: number;
  rowsWritten: number;
}
const SPEND_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
const SPEND_SAMPLE_CAP = 336; // 14 days of hourly points
/**
 * Cumulative totals as they stood at the first billing computation of the current UTC day.
 * Every free-tier allowance that matters here is a *daily* allowance, so "how much of
 * today's limit have we used" needs a day boundary to subtract from — an all-time total
 * and a lifetime average cannot answer it. One key, rewritten once a day.
 */
interface DayBaseline {
  day: string;
  startedAt: number;
  requests: number;
  gbSeconds: number;
  rowsRead: number;
  rowsWritten: number;
  r2ClassA: number;
  r2ClassB: number;
  usd: number;
}
interface Usage {
  startedAt: number;
  requests: number;
  reports: number;
  events: number;
  roomsSeen: string[];
  storageWrites: number;
  storageRowsRead: number;
  storageRowsWritten: number;
  r2ClassA: number;
  r2ClassB: number;
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
/**
 * What is actually stored under `profile:<id>`. `seenAt` is bookkeeping for the row cap and
 * is never returned to the client, so the public `Profile` shape is unchanged.
 */
type StoredProfile = Profile & { seenAt?: number };
interface ProfileStats {
  count: number;
  countedAt: number;
  /** True when the initial count stopped at the scan bound instead of reaching the end. */
  truncated: boolean;
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
interface MaintenanceState {
  enabled: boolean;
  changedAt: number;
  reason: string;
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
interface R2Snapshot {
  checkedAt: number;
  objectCount: number;
  storageBytes: number;
  bucket: string;
  truncated: boolean;
}
interface BillingRoomBaseline {
  activeDurationMs: number;
  wsMessages: number;
  connections: number;
  storageWrites: number;
  storageRowsRead: number;
  storageRowsWritten: number;
}
interface BillingWindow {
  versionId: string;
  startedAt: number;
  tankRequests: number;
  storageWrites: number;
  storageRowsRead: number;
  storageRowsWritten: number;
  r2ClassA: number;
  r2ClassB: number;
  rooms: Record<string, BillingRoomBaseline>;
}

/**
 * A.8.13 asks for backups that are taken, retained, and demonstrably restorable.
 * Everything this object holds sits in two places at once: Durable Object KV keys, and
 * two SQLite tables — the 90-day action log and the tamper-evident receipt chain. An
 * export covering only one of them would restore to a service that looked intact and had
 * quietly lost its evidence, so both are read in a single pass and digested together.
 *
 * The digest is taken over a canonical form (KV keys sorted, rows in primary-key order)
 * so that exporting the same state twice produces the same hash. That is what makes a
 * restore drill meaningful: restore into a scratch instance, export it, and compare the
 * two digests. Equal digests mean the copy is the original, not merely similar to it.
 */
const BACKUP_FORMAT = "wizardgang-state-export";
const BACKUP_VERSION = 1;
/** Ceiling on export paging, so a runaway key space cannot make an export unbounded. */
const BACKUP_MAX_PAGES = 200;
interface StateExport {
  format: string;
  version: number;
  takenAt: number;
  generation: string;
  kv: Record<string, unknown>;
  audit: Array<Record<string, unknown>>;
  controlHistory: Array<Record<string, unknown>>;
  counts: { kv: number; profiles: number; audit: number; controlHistory: number };
  /** Present on a completed export; absent from the body the digest is computed over. */
  digest?: string;
  truncated?: boolean;
}
/** What the public status panel is allowed to say about backups. No content, only shape. */
export interface BackupState {
  lastBackupAt: number;
  lastBackupKey: string;
  lastBackupBytes: number;
  lastBackupDigest: string;
  lastBackupCounts: { kv: number; profiles: number; audit: number; controlHistory: number } | null;
  lastBackupError: string;
  retainedCopies: number;
  lastDrillAt: number;
  lastDrillOk: boolean;
  lastDrillDetail: string;
}
const EMPTY_BACKUP_STATE: BackupState = {
  lastBackupAt: 0, lastBackupKey: "", lastBackupBytes: 0, lastBackupDigest: "",
  lastBackupCounts: null, lastBackupError: "", retainedCopies: 0,
  lastDrillAt: 0, lastDrillOk: false, lastDrillDetail: "",
};

export class Lobby implements DurableObject {
  private readonly reports = new Map<string, Report>();
  private readonly rates = new Map<string, RateBucket>();
  /** Identifies this resident instance, so ops can see whether in-memory state survives. */
  private readonly bootId = crypto.randomUUID().slice(0, 8);
  private readonly bootedAt = Date.now();
  private usage: Usage = {
    startedAt: Date.now(),
    requests: 0,
    reports: 0,
    events: 0,
    roomsSeen: [],
    storageWrites: 0,
    storageRowsRead: 0,
    storageRowsWritten: 0,
    r2ClassA: 0,
    r2ClassB: 0,
  };
  private maintenance: MaintenanceState = {
    enabled: false,
    changedAt: 0,
    reason: "",
  };
  private maintenanceIncidents: MaintenanceIncident[] = [];
  private r2Snapshot: R2Snapshot = {
    checkedAt: 0,
    objectCount: 0,
    storageBytes: 0,
    bucket: "wizardgang-demo-assets",
    truncated: false,
  };
  private billingWindow: BillingWindow = {
    versionId: "",
    startedAt: Date.now(),
    tankRequests: 0,
    storageWrites: 0,
    storageRowsRead: 0,
    storageRowsWritten: 0,
    r2ClassA: 0,
    r2ClassB: 0,
    rooms: {},
  };
  /**
   * Hourly samples of cumulative all-time metered spend, for the /inquiry trend chart.
   * Cost was only ever reported as a single instantaneous number, so there was no way
   * to see whether spend was flat, creeping, or accelerating toward the hard stop.
   * Sampled lazily whenever billing is computed; ~14 days retained.
   */
  private spendHistory: SpendSample[] = [];
  /** Where today started. Captured on the first billing computation of each UTC day. */
  private dayBaseline: DayBaseline | null = null;
  private historyQueue: Promise<void> = Promise.resolve();
  /** Loaded lazily on first use, then kept in step with every append. */
  private historyAnchor: ControlHistoryAnchor | null = null;
  private historyAnchorLoaded = false;
  /** Last verification pass. Cleared implicitly whenever its cache keys stop matching. */
  private historyVerification: ControlHistoryVerification | null = null;
  /** Row count for `profile:*`. Null until the first count; see `profileStatsNow`. */
  private profileStats: ProfileStats | null = null;
  private lastProfileRefusalAuditAt = 0;
  /** Mirrors the `backupState` key. Loaded on first use, written on every backup event. */
  private backupState: BackupState | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
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
    const schemaRowsRead =
        auditTable.rowsRead +
        auditIndex.rowsRead +
        historyTable.rowsRead +
        historyIndex.rowsRead,
      schemaRowsWritten =
        auditTable.rowsWritten +
        auditIndex.rowsWritten +
        historyTable.rowsWritten +
        historyIndex.rowsWritten;
    void this.ctx.blockConcurrencyWhile(async () => {
      let bootstrapReads = 0;
      this.usage = (await this.ctx.storage.get<Usage>("usage")) ?? this.usage;
      this.spendHistory = (await this.ctx.storage.get<SpendSample[]>("spendHistory")) ?? [];
      bootstrapReads += 1;
      this.dayBaseline = (await this.ctx.storage.get<DayBaseline>("dayBaseline")) ?? null;
      bootstrapReads += 1;
      this.usage.storageWrites ??= 0;
      this.usage.storageRowsRead ??= 0;
      this.usage.storageRowsWritten ??= this.usage.storageWrites;
      this.usage.r2ClassA ??= 0;
      this.usage.r2ClassB ??= 0;
      this.maintenance =
        (await this.ctx.storage.get<MaintenanceState>("maintenance")) ??
        this.maintenance;
      bootstrapReads += 1;
      this.maintenanceIncidents =
        (await this.ctx.storage.get<MaintenanceIncident[]>(
          "maintenanceIncidents",
        )) ?? [];
      bootstrapReads += 1;
      const securityIncidentSemantics =
        await this.ctx.storage.get<string>("securityIncidentSemantics");
      bootstrapReads += 1;
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
        this.countWrites(reopened.length ? 2 : 1);
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
      bootstrapReads += 1;
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
        this.countWrites(changed ? 2 : 1);
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
        this.countWrites(1);
        await this.ctx.storage.put(
          "maintenanceIncidents",
          this.maintenanceIncidents,
        );
      }
      this.r2Snapshot =
        (await this.ctx.storage.get<R2Snapshot>("r2Snapshot")) ??
        this.r2Snapshot;
      bootstrapReads += 1;
      const reports =
        (await this.ctx.storage.get<Record<string, Report>>("reports")) ?? {};
      bootstrapReads += 1;
      for (const [id, report] of Object.entries(reports))
        this.reports.set(id, {
          ...report,
          bots: report.bots ?? 24,
          activeDurationMs: report.activeDurationMs ?? 0,
          wsMessages: report.wsMessages ?? 0,
          connections: report.connections ?? 0,
          storageWrites: report.storageWrites ?? 0,
          storageRowsRead: report.storageRowsRead ?? 0,
          storageRowsWritten:
            report.storageRowsWritten ?? report.storageWrites ?? 0,
          storageBytes: report.storageBytes ?? 0,
        });
      const generation = this.env.AUDIT_GENERATION;
      const savedGeneration =
        await this.ctx.storage.get<string>("auditGeneration");
      bootstrapReads += 1;
      this.usage.storageRowsRead += schemaRowsRead + bootstrapReads;
      this.usage.storageRowsWritten += schemaRowsWritten;
      if (generation && savedGeneration !== generation) {
        this.trackSql("DELETE FROM audit");
        await this.ctx.storage.delete("audit"); // remove the legacy array-backed audit log too
        this.countWrites(3);
        await this.ctx.storage.put({
          auditGeneration: generation,
          usage: this.usage,
        });
      }
      const versionId =
        this.env.CF_VERSION_METADATA?.id ?? generation ?? "local";
      const savedBilling =
        await this.ctx.storage.get<BillingWindow>("billingWindow");
      this.usage.storageRowsRead += 1;
      if (!savedBilling || savedBilling.versionId !== versionId) {
        this.billingWindow = this.newBillingWindow(versionId);
        this.countWrites(2);
        await this.ctx.storage.put({
          billingWindow: this.billingWindow,
          usage: this.usage,
        });
      } else
        this.billingWindow = {
          ...savedBilling,
          tankRequests:
            savedBilling.tankRequests ??
            (savedBilling as { lobbyRequests?: number }).lobbyRequests ??
            0,
          storageRowsRead: savedBilling.storageRowsRead ?? 0,
          storageRowsWritten:
            savedBilling.storageRowsWritten ?? savedBilling.storageWrites ?? 0,
          r2ClassA: savedBilling.r2ClassA ?? 0,
          r2ClassB: savedBilling.r2ClassB ?? 0,
        };
    });
  }

  async fetch(request: Request): Promise<Response> {
    this.usage.requests += 1;
    const versionId =
      this.env.CF_VERSION_METADATA?.id ?? this.env.AUDIT_GENERATION ?? "local";
    if (this.billingWindow.versionId !== versionId) {
      this.billingWindow = this.newBillingWindow(versionId);
      this.countWrites(2);
      await this.ctx.storage.put({
        billingWindow: this.billingWindow,
        usage: this.usage,
      });
    }
    const url = new URL(request.url),
      path = url.pathname;
    if (path.endsWith("/maintenance")) {
      if (request.method === "GET") {
        await this.enforceSpendLimit();
        return json({ ok: true, maintenance: this.maintenance });
      }
      if (request.method !== "POST")
        return json({ ok: false, error: "method not allowed" }, 405);
      const body = await safeJson<{ enabled?: boolean; reason?: string }>(
        request,
      );
      if (!body || typeof body.enabled !== "boolean")
        return json({ ok: false, error: "enabled must be boolean" }, 400);
      if (!body.enabled) {
        const billing = await this.billing();
        if (billing.hardLimitExceeded)
          return json(
            {
              ok: false,
              error:
                "billing hard limit must be reset before the game can return online",
              maintenance: this.maintenance,
            },
            409,
          );
      }
      const now = Date.now(),
        wasEnabled = this.maintenance.enabled,
        previousChangedAt = this.maintenance.changedAt,
        reason = clean(body.reason, 120) ?? "",
        reasonSentence = reason
          ? `${reason}${/[.!?]$/.test(reason) ? "" : "."}`
          : "";
      let transitionReference: string | null = null;
      if (body.enabled !== wasEnabled) {
        if (body.enabled) {
          const incident: MaintenanceIncident = {
            id: `maintenance-${now}`,
            title: "Tank maintenance",
            cause: "Audit control",
            status: "active",
            startedAt: now,
            resolvedAt: null,
            impactEndedAt: null,
            summary:
              reason || "The tank was intentionally taken offline from the operations control panel.",
          };
          this.maintenanceIncidents.push(incident);
          transitionReference = incident.id;
        } else {
          for (const incident of this.maintenanceIncidents) {
            if (incident.status !== "active") continue;
            if (incident.cause === "Independent security report") {
              incident.impactEndedAt ??= now;
              transitionReference ??= incident.id;
              continue;
            }
            incident.status = "resolved";
            incident.resolvedAt = now;
            incident.impactEndedAt ??= now;
            transitionReference = incident.id;
          }
        }
      }
      const openSecurityReports = this.maintenanceIncidents.filter(
          (incident) =>
            incident.cause === "Independent security report" &&
            incident.status === "active",
        ).length,
        securityReportLabel = `${openSecurityReports} security report${openSecurityReports === 1 ? "" : "s"}`,
        securityReportVerb = openSecurityReports === 1 ? "remains" : "remain",
        message =
          body.enabled === wasEnabled
            ? `Game traffic is already ${body.enabled ? "offline" : "online"}. ${securityReportLabel} ${securityReportVerb} open.`
            : body.enabled
              ? openSecurityReports
                ? `Operator maintenance enabled as a separate control event. ${securityReportLabel} ${securityReportVerb} open.`
                : "Operator maintenance enabled as a separate control event."
              : openSecurityReports
                ? `Game traffic restored. ${securityReportLabel} ${securityReportVerb} open; restoring service does not close security reporting.`
                : "Game traffic restored and operational downtime resolved.";
      this.maintenance = { enabled: body.enabled, changedAt: now, reason };
      this.pruneIncidents();
      this.countWrites(3);
      await this.ctx.storage.put({
        maintenance: this.maintenance,
        maintenanceIncidents: this.maintenanceIncidents,
        usage: this.usage,
      });
      let history: ControlHistoryEntry | null = null;
      if (body.enabled !== wasEnabled) {
        this.record({
          ts: now,
          type: body.enabled ? "maintenance-on" : "maintenance-off",
          subject: "ops",
          detail: body.enabled
            ? openSecurityReports
              ? `${reason || "Tank taken offline"}; separate from ${securityReportLabel}`
              : reason || "Tank taken offline"
            : `Tank restored after ${Math.round((now - (previousChangedAt || now)) / 1000)}s; ${securityReportLabel} ${securityReportVerb} open`,
        });
        history = await this.appendControlHistory({
          ts: now,
          code: body.enabled
            ? "OPS-MAINTENANCE-ON"
            : "OPS-MAINTENANCE-OFF",
          actor: "ops",
          title: body.enabled ? "Game traffic disabled" : "Game traffic restored",
          summary: body.enabled
            ? openSecurityReports
              ? `${reasonSentence || "Authenticated operations control disabled the game."} This is separate from ${securityReportLabel}.`
              : reasonSentence || "Authenticated operations control disabled the game."
            : openSecurityReports
              ? `Authenticated operations control restored game traffic. ${securityReportLabel} ${securityReportVerb} open until separately resolved.`
              : "Authenticated operations control restored the game and resolved operational downtime.",
          reference: transitionReference,
          detail: `maintenance=${body.enabled ? "enabled" : "disabled"};openSecurityReports=${openSecurityReports}`,
        });
      }
      return json({
        ok: true,
        maintenance: this.maintenance,
        history,
        message,
        openSecurityReports,
      });
    }
    if (path.endsWith("/billing/reset")) {
      if (request.method !== "POST")
        return json({ ok: false, error: "method not allowed" }, 405);
      this.billingWindow = this.newBillingWindow(
        this.env.CF_VERSION_METADATA?.id ??
          this.env.AUDIT_GENERATION ??
          "local",
      );
      this.countWrites(2);
      await this.ctx.storage.put({
        billingWindow: this.billingWindow,
        usage: this.usage,
      });
      const now = Date.now();
      this.record({
        ts: now,
        type: "billing-reset",
        subject: "ops",
        detail: "Billing measurement window reset; uptime preserved",
      });
      const history = await this.appendControlHistory({
        ts: now,
        code: "BILLING-WINDOW-RESET",
        actor: "ops",
        title: "Billing counter reset",
        summary:
          "The tracked spend window was reset without changing uptime, incidents, or control history.",
        reference: `billing-window-${now}`,
        detail: `version=${this.billingWindow.versionId}`,
      });
      return json({ ok: true, billingWindow: await this.billing(), history });
    }
    if (path.endsWith("/profile")) return this.profile(request);
    if (path.endsWith("/report") && request.method === "POST") {
      const b = await safeJson<TankRoom & { topName?: string }>(request);
      if (!b || !CATALOG.some((r) => r.id === b.id))
        return json({ ok: false, error: "invalid room" }, 400);
      const metrics = b as TankRoom & {
        topName?: string;
        activeDurationMs?: number;
        wsMessages?: number;
        connections?: number;
        storageWrites?: number;
        storageRowsRead?: number;
        storageRowsWritten?: number;
        storageBytes?: number;
      };
      this.reports.set(b.id, {
        players: clampInt(b.players, 0, CAPACITY),
        bots: clampInt(b.bots ?? 24, 0, 32),
        topScore: clampInt(b.topScore, 0, 1e9),
        topName: sanitizeDisplayName(b.topName),
        at: Date.now(),
        activeDurationMs: clampInt(
          metrics.activeDurationMs ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        wsMessages: clampInt(
          metrics.wsMessages ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        connections: clampInt(
          metrics.connections ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        storageWrites: clampInt(
          metrics.storageWrites ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        storageRowsRead: clampInt(
          metrics.storageRowsRead ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        storageRowsWritten: clampInt(
          metrics.storageRowsWritten ?? metrics.storageWrites ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
        storageBytes: clampInt(
          metrics.storageBytes ?? 0,
          0,
          Number.MAX_SAFE_INTEGER,
        ),
      });
      this.usage.reports += 1;
      if (!this.usage.roomsSeen.includes(b.id)) this.usage.roomsSeen.push(b.id);
      this.countWrites(2);
      this.ctx.waitUntil(
        this.ctx.storage.put({
          usage: this.usage,
          reports: Object.fromEntries(this.reports),
        }),
      );
      return json({ ok: true });
    }
    if (path.endsWith("/event") && request.method === "POST") {
      const actor = request.headers.get("x-actor-id") ?? "server";
      // x-rate-key is present only on events the Worker forwarded from the public
      // /api/audit route, and the Worker derives it from the edge connection. x-actor-id
      // is the caller's own wg_player cookie, so it cannot be the bucket key: dropping
      // the cookie would hand every request a fresh identity and a fresh allowance.
      const publicKey = request.headers.get("x-rate-key");
      const limited = publicKey
        ? !this.allow(`ip:${publicKey}`) ||
          !this.allow("public:all", PUBLIC_AUDIT_RATE_PER_MINUTE)
        : !this.allow(actor);
      if (limited) return json({ ok: false, error: "rate limited" }, 429);
      const ev = await safeJson<AuditEvent>(request);
      if (!ev || !validEventType(ev.type))
        return json({ ok: false, error: "invalid event" }, 400);
      // Public events name their subject by profile id and let the DO resolve it, rather
      // than costing the Worker a second call: this is a storage read, and it happens only
      // once the rate limit above has already passed. The Worker sets x-profile-id from
      // the wg_player cookie it validated, so it is never client-chosen.
      const profileOwner = request.headers.get("x-profile-id");
      if (!ev.subject && profileOwner && /^[a-f0-9-]{36}$/.test(profileOwner)) {
        const profile = await this.ctx.storage.get<Profile>(
          `profile:${profileOwner}`,
        );
        this.usage.storageRowsRead += 1;
        ev.subject = profile?.name ?? "Player";
      }
      this.record(ev, publicKey ? "public" : "server");
      return json({ ok: true });
    }
    if (path.endsWith("/audit")) {
      // The public log page shows the whole 90-day retention window, not a recent
      // slice, so the ceiling here is the retention cap rather than a page size.
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
      this.usage.storageRowsRead += cursor.rowsRead;
      this.usage.storageRowsWritten += cursor.rowsWritten;
      return json({ ok: true, events, retentionDays: 90 });
    }
    if (path.endsWith("/incidents"))
      return json({
        ok: true,
        incidents: this.maintenanceIncidents,
        ...(await this.controlHistory(100)),
      });
    // Full state export. The Worker gates this behind operations authentication; it is
    // every profile and every receipt in one body and must never answer a public request.
    if (path.endsWith("/backup") && request.method === "GET")
      return json({ ok: true, export: await this.exportState() });
    // Record the outcome of a copy the Worker has just written to object storage.
    if (path.endsWith("/backup/record") && request.method === "POST") {
      const body = await safeJson<Partial<BackupState> & { ok?: boolean }>(request);
      if (!body) return json({ ok: false, error: "body must be JSON" }, 400);
      return json({ ok: true, backup: await this.recordBackup(body) });
    }
    // Record the outcome of a restore drill the Worker has just run.
    if (path.endsWith("/backup/drill-result") && request.method === "POST") {
      const body = await safeJson<{ ok?: boolean; detail?: string }>(request);
      if (!body) return json({ ok: false, error: "body must be JSON" }, 400);
      return json({ ok: true, backup: await this.recordDrill(Boolean(body.ok), clean(body.detail, 240) ?? "") });
    }
    // Wipe. Used to leave nothing behind in the scratch instance a restore drill restores
    // into: that instance holds a full copy of every player profile, and an orphaned copy
    // of personal data is not made acceptable by having been created to test a backup.
    if (path.endsWith("/wipe") && request.method === "POST") {
      const cleared = await this.wipeState();
      return json({ ok: true, cleared });
    }
    // Restore. Destructive and operator-only: it replaces every key and both tables.
    if (path.endsWith("/restore") && request.method === "POST") {
      let payload: unknown;
      try { payload = await request.json(); } catch { return json({ ok: false, error: "body must be JSON" }, 400); }
      const result = await this.importState(payload);
      return json(result, result.ok ? 200 : 400);
    }
    if (path.endsWith("/status"))
      return json({ ok: true, ...(await this.status()) });
    return json({ ok: true, rooms: this.list() });
  }

  private async profile(request: Request): Promise<Response> {
    const owner = request.headers.get("x-profile-id");
    if (!owner || !/^[a-f0-9-]{36}$/.test(owner))
      return json({ ok: false, error: "invalid profile" }, 400);
    const key = `profile:${owner}`;
    const stored = await this.ctx.storage.get<StoredProfile>(key);
    const previous: StoredProfile = stored ?? {
      name: "Player",
      skin: DEFAULT_SKIN,
      best: 0,
    };
    this.usage.storageRowsRead += 1;
    if (request.method === "GET")
      return json({ ok: true, profile: publicProfile(previous) });
    if (request.method !== "POST")
      return json({ ok: false, error: "method not allowed" }, 405);
    // Throttle before the body is read and before either branch below. x-rate-key is set by
    // the Worker from the edge connection; it is never the caller's own cookie, because the
    // cookie is self-issued. Absent, every caller shares one bucket, which limits harder.
    const rateKey = request.headers.get("x-rate-key");
    if (
      !this.allow(`profile:${rateKey ?? "edge"}`, PROFILE_WRITE_RATE_PER_MINUTE) ||
      !this.allow("profile:all", PUBLIC_PROFILE_WRITE_RATE_PER_MINUTE)
    )
      return json({ ok: false, error: "rate limited" }, 429);
    const body = await safeJson<Partial<Profile>>(request);
    if (!body) return json({ ok: false, error: "invalid JSON" }, 400);
    const skin = SKINS.some((s) => s.id === body.skin)
      ? body.skin!
      : previous.skin;
    const settings =
      body.settings && JSON.stringify(body.settings).length <= 8_192
        ? body.settings
        : previous.settings;
    const next: StoredProfile = {
      name: sanitizeDisplayName(body.name ?? previous.name),
      skin,
      best: Math.max(previous.best, clampInt(body.best ?? 0, 0, 1e9)),
      settings,
      seenAt: Date.now(),
    };
    // Writing over a row that already exists adds nothing to the row count, so the row
    // ceiling never refuses it and a saved name or score is never lost. The write itself is
    // still metered: the throttle above applies to both branches.
    if (stored) {
      this.countWrites(1);
      await this.ctx.storage.put(key, next);
      return json({ ok: true, profile: publicProfile(next), persisted: true });
    }
    if (!(await this.admitNewProfile()))
      // The row is refused, not the request: the client keeps playing under the identity it
      // asked for and simply gets no server-side copy of it. Failing the save closed would
      // take the game down for everyone the moment someone decided to mint UUIDs.
      return json({ ok: true, profile: publicProfile(next), persisted: false });
    this.countWrites(1);
    await this.ctx.storage.put(key, next);
    if (this.profileStats) {
      this.profileStats.count += 1;
      this.countWrites(1);
      this.ctx.waitUntil(this.ctx.storage.put("profileStats", this.profileStats));
    }
    return json({ ok: true, profile: publicProfile(next), persisted: true });
  }

  /**
   * Decide whether one more `profile:*` row may be created. Under the cap this is a pure
   * in-memory check; only at the cap does it do any work, and then it sweeps first and
   * refuses second, in that order.
   */
  private async admitNewProfile(): Promise<boolean> {
    if ((await this.profileStatsNow()).count < PROFILE_CAP) return true;
    await this.pruneProfiles();
    if ((this.profileStats?.count ?? PROFILE_CAP) < PROFILE_CAP) return true;
    // Refusals are the loud case, and an audit row per refused request would let the flood
    // it exists to bound flood the log instead. One row per minute records that it is
    // happening without becoming the next amplifier.
    const now = Date.now();
    if (now - this.lastProfileRefusalAuditAt >= PROFILE_REFUSAL_AUDIT_INTERVAL_MS) {
      this.lastProfileRefusalAuditAt = now;
      this.record({
        ts: now,
        type: "profiles-refused",
        subject: "system",
        detail: `new player record creation refused at the ${PROFILE_CAP} record ceiling; existing records continue to load and save`,
      });
    }
    return false;
  }
  /**
   * Count `profile:*` rows once, then keep the number in step by hand. The count is paged
   * and stops at the scan bound rather than reading an unbounded table into memory; a run
   * that hits the bound is marked truncated, and a truncated count is only ever an
   * underestimate of a set already past the ceiling, so it still refuses.
   */
  private async profileStatsNow(): Promise<ProfileStats> {
    if (this.profileStats) return this.profileStats;
    const saved = await this.ctx.storage.get<ProfileStats>("profileStats");
    this.usage.storageRowsRead += 1;
    if (saved) {
      this.profileStats = saved;
      return saved;
    }
    let count = 0,
      startAfter: string | undefined,
      truncated = false;
    for (let page = 0; page < PROFILE_SCAN_PAGES; page += 1) {
      const batch = await this.ctx.storage.list<StoredProfile>({
        prefix: "profile:",
        limit: PROFILE_SCAN_PAGE,
        startAfter,
      });
      this.usage.storageRowsRead += batch.size;
      count += batch.size;
      if (batch.size < PROFILE_SCAN_PAGE) break;
      startAfter = [...batch.keys()].at(-1);
      if (page === PROFILE_SCAN_PAGES - 1) truncated = true;
    }
    this.profileStats = { count, countedAt: Date.now(), truncated };
    this.countWrites(1);
    await this.ctx.storage.put("profileStats", this.profileStats);
    return this.profileStats;
  }
  /**
   * Drop only rows that are provably disposable: last written longer ago than the audit
   * retention window *and* holding no score at all. A row with a score is somebody's record
   * and is never dropped; a row with no last-seen stamp predates this cap and is never
   * dropped either, since there is no evidence it is abandoned. That deliberately leaves a
   * fresh flood unprunable — the ceiling, not the sweep, is what stops that.
   */
  private async pruneProfiles(): Promise<void> {
    const now = Date.now(),
      doomed: string[] = [];
    let startAfter: string | undefined;
    for (let page = 0; page < PROFILE_SCAN_PAGES; page += 1) {
      const batch = await this.ctx.storage.list<StoredProfile>({
        prefix: "profile:",
        limit: PROFILE_SCAN_PAGE,
        startAfter,
      });
      this.usage.storageRowsRead += batch.size;
      for (const [profileKey, profile] of batch)
        if (
          typeof profile?.seenAt === "number" &&
          now - profile.seenAt > PROFILE_STALE_MS &&
          !(profile.best > 0)
        )
          doomed.push(profileKey);
      if (batch.size < PROFILE_SCAN_PAGE) break;
      startAfter = [...batch.keys()].at(-1);
    }
    if (!doomed.length) return;
    this.countWrites(doomed.length);
    await this.ctx.storage.delete(doomed);
    if (this.profileStats) {
      this.profileStats.count = Math.max(
        0,
        this.profileStats.count - doomed.length,
      );
      this.profileStats.countedAt = now;
      this.countWrites(1);
      await this.ctx.storage.put("profileStats", this.profileStats);
    }
    this.record({
      ts: now,
      type: "profiles-pruned",
      subject: "system",
      detail: `${doomed.length} unused player record${doomed.length === 1 ? "" : "s"} with no score dropped to keep the record count within its limit`,
    });
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
  private record(ev: AuditEvent, source: "server" | "public" = "server"): void {
    const ts = clampInt(
      ev.ts || Date.now(),
      Date.now() - AUDIT_RETENTION_MS,
      Date.now() + 60_000,
    );
    this.trackSql(
      "INSERT INTO audit(ts,type,room,subject,detail) VALUES(?,?,?,?,?)",
      ts,
      ev.type.slice(0, 32),
      clean(ev.room, 32),
      ev.subject ? sanitizeDisplayName(ev.subject) : null,
      clean(ev.detail, 160),
    );
    // Publicly written rows are trimmed to their own floor first, so a flood through the
    // unauthenticated route evicts other public rows instead of server-recorded evidence.
    if (source === "public") {
      const placeholders = PUBLIC_AUDIT_TYPES.map(() => "?").join(",");
      this.trackSql(
        `DELETE FROM audit WHERE type IN (${placeholders}) AND id NOT IN (SELECT id FROM audit WHERE type IN (${placeholders}) ORDER BY id DESC LIMIT ?)`,
        ...PUBLIC_AUDIT_TYPES,
        ...PUBLIC_AUDIT_TYPES,
        AUDIT_PUBLIC_MAX_ROWS,
      );
    }
    this.trackSql(
      "DELETE FROM audit WHERE ts < ? OR id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT ?)",
      Date.now() - AUDIT_RETENTION_MS,
      AUDIT_MAX_ROWS,
    );
    this.usage.events += 1;
    this.countWrites(1);
    if (ev.room && !this.usage.roomsSeen.includes(ev.room))
      this.usage.roomsSeen.push(ev.room);
    this.ctx.waitUntil(this.ctx.storage.put("usage", this.usage));
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
  private async status() {
    const rooms = this.list(),
      billingWindow = await this.enforceSpendLimit();
    return {
      maintenance: this.maintenance,
      maintenanceIncidents: this.maintenanceIncidents,
      usage: {
        startedAt: this.usage.startedAt,
        uptimeMs: Date.now() - this.usage.startedAt,
        tankRequests: this.usage.requests,
        presenceReports: this.usage.reports,
        auditEvents: this.usage.events,
        durableObjects: {
          tank: 1,
          rooms: this.usage.roomsSeen.length,
          total: 1 + this.usage.roomsSeen.length,
        },
        storage: "Durable Object SQLite audit + profiles + game logs",
      },
      // Operations-only. In-memory throttles are only worth anything if this object stays
      // resident: a bootId that changes between requests means every rate bucket is being
      // discarded with it. Not public — /audit/ is authenticated.
      instance: {
        bootId: this.bootId,
        bootedAt: this.bootedAt,
        residentMs: Date.now() - this.bootedAt,
        rateBuckets: this.rates.size,
        publicWindowCount: this.rates.get("public:all")?.count ?? 0,
      },
      billingWindow,
      // Shape and timing of the last state copy. Public: it is the only way a reader can
      // check that A.8.13 is operated rather than merely written down.
      backup: await this.loadBackupState(),
      ...(await this.controlHistory(50)),
      rooms,
    };
  }
  private async billing() {
    await this.refreshR2();
    let activeMs = 0,
      messages = 0,
      connections = 0,
      roomWrites = 0,
      roomRowsRead = 0,
      roomRowsWritten = 0,
      storageBytes = this.ctx.storage.sql.databaseSize;
    let allActiveMs = 0,
      allMessages = 0,
      allConnections = 0,
      allRoomWrites = 0,
      allRoomRowsRead = 0,
      allRoomRowsWritten = 0;
    for (const [id, report] of this.reports) {
      const base = this.billingWindow.rooms[id] ?? {
        activeDurationMs: 0,
        wsMessages: 0,
        connections: 0,
        storageWrites: 0,
        storageRowsRead: 0,
        storageRowsWritten: 0,
      };
      activeMs += Math.max(0, report.activeDurationMs - base.activeDurationMs);
      messages += Math.max(0, report.wsMessages - base.wsMessages);
      connections += Math.max(0, report.connections - base.connections);
      roomWrites += Math.max(0, report.storageWrites - base.storageWrites);
      roomRowsRead += Math.max(
        0,
        report.storageRowsRead - base.storageRowsRead,
      );
      roomRowsWritten += Math.max(
        0,
        report.storageRowsWritten - base.storageRowsWritten,
      );
      storageBytes += report.storageBytes;
      allActiveMs += report.activeDurationMs;
      allMessages += report.wsMessages;
      allConnections += report.connections;
      allRoomWrites += report.storageWrites;
      allRoomRowsRead += report.storageRowsRead;
      allRoomRowsWritten += report.storageRowsWritten;
    }
    const tankRequests = Math.max(
      0,
      this.usage.requests - this.billingWindow.tankRequests,
    );
    const storageWrites =
      Math.max(0, this.usage.storageWrites - this.billingWindow.storageWrites) +
      roomWrites;
    const storageRowsRead =
      Math.max(
        0,
        this.usage.storageRowsRead - this.billingWindow.storageRowsRead,
      ) + roomRowsRead;
    const storageRowsWritten =
      Math.max(
        0,
        this.usage.storageRowsWritten - this.billingWindow.storageRowsWritten,
      ) + roomRowsWritten;
    const r2ClassA = Math.max(
        0,
        this.usage.r2ClassA - this.billingWindow.r2ClassA,
      ),
      r2ClassB = Math.max(0, this.usage.r2ClassB - this.billingWindow.r2ClassB);
    const requests = tankRequests + connections + messages / 20;
    const gbSeconds = (activeMs / 1000) * 0.128;
    const observedMs = Math.max(1, Date.now() - this.billingWindow.startedAt),
      projectionSampleMs = Math.max(60_000, observedMs),
      monthFactor = (30 * 24 * 60 * 60 * 1000) / projectionSampleMs;
    const doRequestUsd = (requests / 1_000_000) * 0.15,
      doDurationUsd = (gbSeconds / 1_000_000) * 12.5,
      doReadUsd = (storageRowsRead / 1_000_000) * 0.001,
      doWriteUsd = storageRowsWritten / 1_000_000;
    const doStorageMonthlyUsd = (storageBytes / 1_000_000_000) * 0.2;
    const r2OperationUsd =
      (r2ClassA / 1_000_000) * 4.5 + (r2ClassB / 1_000_000) * 0.36;
    const r2StorageMonthlyUsd =
      (this.r2Snapshot.storageBytes / 1_000_000_000) * 0.015;
    const meteredWindowUsd =
      doRequestUsd + doDurationUsd + doReadUsd + doWriteUsd + r2OperationUsd;
    const storageWindowUsd =
      (doStorageMonthlyUsd + r2StorageMonthlyUsd) / monthFactor;
    const estimatedVariableUsd = meteredWindowUsd + storageWindowUsd;
    const projectedMonthlyVariableUsd =
      meteredWindowUsd * monthFactor +
      doStorageMonthlyUsd +
      r2StorageMonthlyUsd;
    const freeTier = {
      workers: { requestsPerDay: 100_000 },
      durableObjects: {
        requestsPerDay: 100_000,
        gbSecondsPerDay: 13_000,
        rowsReadPerDay: 5_000_000,
        rowsWrittenPerDay: 100_000,
        storageBytes: 5_000_000_000,
      },
      d1: { configured: false },
      r2: {
        storageBytesPerMonth: 10_000_000_000,
        classAOperationsPerMonth: 1_000_000,
        classBOperationsPerMonth: 10_000_000,
      },
      sources: {
        workers: "https://developers.cloudflare.com/workers/platform/pricing/",
        durableObjects:
          "https://developers.cloudflare.com/durable-objects/platform/pricing/",
        r2: "https://developers.cloudflare.com/r2/pricing/",
      },
    };
    const projectedRequests = requests * monthFactor,
      projectedGbSeconds = gbSeconds * monthFactor,
      projectedRowsRead = storageRowsRead * monthFactor,
      projectedRowsWritten = storageRowsWritten * monthFactor,
      projectedR2ClassA = r2ClassA * monthFactor,
      projectedR2ClassB = r2ClassB * monthFactor;
    const freeTierProjectedMonthlyUsd =
      (Math.max(
        0,
        projectedRequests - freeTier.durableObjects.requestsPerDay * 30,
      ) /
        1_000_000) *
        0.15 +
      (Math.max(
        0,
        projectedGbSeconds - freeTier.durableObjects.gbSecondsPerDay * 30,
      ) /
        1_000_000) *
        12.5 +
      (Math.max(
        0,
        projectedRowsRead - freeTier.durableObjects.rowsReadPerDay * 30,
      ) /
        1_000_000) *
        0.001 +
      Math.max(
        0,
        projectedRowsWritten - freeTier.durableObjects.rowsWrittenPerDay * 30,
      ) /
        1_000_000 +
      (Math.max(0, storageBytes - freeTier.durableObjects.storageBytes) /
        1_000_000_000) *
        0.2 +
      (Math.max(0, projectedR2ClassA - freeTier.r2.classAOperationsPerMonth) /
        1_000_000) *
        4.5 +
      (Math.max(0, projectedR2ClassB - freeTier.r2.classBOperationsPerMonth) /
        1_000_000) *
        0.36 +
      (Math.max(
        0,
        this.r2Snapshot.storageBytes - freeTier.r2.storageBytesPerMonth,
      ) /
        1_000_000_000) *
        0.015;
    const allRequests = this.usage.requests + allConnections + allMessages / 20,
      allGbSeconds = (allActiveMs / 1000) * 0.128,
      allRowsRead = this.usage.storageRowsRead + allRoomRowsRead,
      allRowsWritten = this.usage.storageRowsWritten + allRoomRowsWritten,
      allR2ClassA = this.usage.r2ClassA,
      allR2ClassB = this.usage.r2ClassB;
    const allObservedMs = Math.max(1, Date.now() - this.usage.startedAt),
      allMonthFactor = (30 * 24 * 60 * 60 * 1000) / allObservedMs;
    const allMeteredUsd =
      (allRequests / 1_000_000) * 0.15 +
      (allGbSeconds / 1_000_000) * 12.5 +
      (allRowsRead / 1_000_000) * 0.001 +
      allRowsWritten / 1_000_000 +
      (allR2ClassA / 1_000_000) * 4.5 +
      (allR2ClassB / 1_000_000) * 0.36;
    const allTime = {
      startedAt: this.usage.startedAt,
      observedDays: allObservedMs / 86_400_000,
      requests: Math.round(allRequests),
      gbSeconds: Number(allGbSeconds.toFixed(2)),
      storageWrites: this.usage.storageWrites + allRoomWrites,
      storageRowsRead: allRowsRead,
      storageRowsWritten: allRowsWritten,
      currentStorageBytes: storageBytes,
      r2ClassA: allR2ClassA,
      r2ClassB: allR2ClassB,
      counters: {
        tankRequests: this.usage.requests,
        websocketConnections: allConnections,
        websocketMessages: allMessages,
        activeDurationMs: allActiveMs,
      },
      services: {
        durableObjects: { requests: Math.round(allRequests), gbSeconds: Number(allGbSeconds.toFixed(2)), rowsRead: allRowsRead, rowsWritten: allRowsWritten, storageBytes },
        d1: { configured: false, rowsRead: 0, rowsWritten: 0, storageBytes: 0 },
        r2: { configured: Boolean(this.env.R2_ASSETS), bucket: this.r2Snapshot.bucket, classAOperations: allR2ClassA, classBOperations: allR2ClassB, objects: this.r2Snapshot.objectCount, storageBytes: this.r2Snapshot.storageBytes },
      },
      estimatedVariableUsd: Number(
        (
          allMeteredUsd +
          (doStorageMonthlyUsd + r2StorageMonthlyUsd) / allMonthFactor
        ).toFixed(8),
      ),
      averageDaily: {
        requests: Number(
          (allRequests / Math.max(1, allObservedMs / 86_400_000)).toFixed(2),
        ),
        gbSeconds: Number(
          (allGbSeconds / Math.max(1, allObservedMs / 86_400_000)).toFixed(2),
        ),
        rowsRead: Number(
          (allRowsRead / Math.max(1, allObservedMs / 86_400_000)).toFixed(2),
        ),
        rowsWritten: Number(
          (allRowsWritten / Math.max(1, allObservedMs / 86_400_000)).toFixed(2),
        ),
      },
    };
    // Average spend per day, on the same all-time basis as the counters above it. This is
    // the figure "is today unusual?" is measured against.
    (allTime.averageDaily as Record<string, number>).estimatedUsd = Number(
      (
        allTime.estimatedVariableUsd /
        Math.max(1, allObservedMs / 86_400_000)
      ).toFixed(8),
    );
    const today = this.today({
      requests: allRequests,
      gbSeconds: allGbSeconds,
      rowsRead: allRowsRead,
      rowsWritten: allRowsWritten,
      r2ClassA: allR2ClassA,
      r2ClassB: allR2ClassB,
      usd: allTime.estimatedVariableUsd,
    });
    const estimated = Number(estimatedVariableUsd.toFixed(8)),
      hardLimitUsd = this.hardLimitUsd();
    this.sampleSpend(allTime.estimatedVariableUsd, allTime.requests, allRowsWritten);
    return {
      scope: "reset-window",
      spendHistory: this.spendHistory,
      spendSampleIntervalMs: SPEND_SAMPLE_INTERVAL_MS,
      startedAt: this.billingWindow.startedAt,
      versionId: this.billingWindow.versionId,
      observedHours: observedMs / 3_600_000,
      requests: Math.round(requests),
      gbSeconds: Math.round(gbSeconds),
      storageWrites,
      storageRowsRead,
      storageRowsWritten,
      currentStorageBytes: storageBytes,
      estimatedVariableUsd: estimated,
      projectedMonthlyVariableUsd: Number(
        projectedMonthlyVariableUsd.toFixed(4),
      ),
      freeTierProjectedMonthlyUsd: Number(
        freeTierProjectedMonthlyUsd.toFixed(4),
      ),
      freeTier,
      allTime,
      today,
      hardLimitUsd,
      hardLimitRemainingUsd: Number(
        Math.max(0, hardLimitUsd - estimated).toFixed(8),
      ),
      hardLimitExceeded: estimated >= hardLimitUsd,
      projectionSampleSeconds: Math.round(projectionSampleMs / 1000),
      requestRatePerMinute: Number(
        ((requests / projectionSampleMs) * 60_000).toFixed(2),
      ),
      counters: {
        tankRequests,
        websocketConnections: connections,
        websocketMessages: messages,
        activeDurationMs: activeMs,
      },
      services: {
        workers: {
          configured: true,
          requests: null,
          cpuMs: null,
          estimatedUsd: null,
          note: "Exact Worker request and CPU billing is available only from Cloudflare account analytics; static asset requests are free.",
        },
        durableObjects: {
          configured: true,
          requests: Math.round(requests),
          gbSeconds: Number(gbSeconds.toFixed(2)),
          rowsRead: storageRowsRead,
          rowsWritten: storageRowsWritten,
          storageBytes,
          estimatedUsd: Number(
            (
              doRequestUsd +
              doDurationUsd +
              doReadUsd +
              doWriteUsd +
              doStorageMonthlyUsd / monthFactor
            ).toFixed(8),
          ),
        },
        d1: {
          configured: false,
          rowsRead: 0,
          rowsWritten: 0,
          storageBytes: 0,
          estimatedUsd: 0,
          note: "No D1 database is bound to this deployment.",
        },
        r2: {
          configured: Boolean(this.env.R2_ASSETS),
          bucket: this.r2Snapshot.bucket,
          classAOperations: r2ClassA,
          classBOperations: r2ClassB,
          objects: this.r2Snapshot.objectCount,
          storageBytes: this.r2Snapshot.storageBytes,
          snapshotAt: this.r2Snapshot.checkedAt,
          estimatedUsd: Number(
            (r2OperationUsd + r2StorageMonthlyUsd / monthFactor).toFixed(8),
          ),
          monthlyStorageRunRateUsd: Number(r2StorageMonthlyUsd.toFixed(8)),
          note: "Standard storage; current bucket bytes plus operations performed by this deployment.",
        },
      },
      rates: {
        requestUsdPerMillion: 0.15,
        durationUsdPerMillionGbSeconds: 12.5,
        doReadUsdPerMillion: 0.001,
        doWriteUsdPerMillion: 1,
        doStorageUsdPerGbMonth: 0.2,
        r2ClassAUsdPerMillion: 4.5,
        r2ClassBUsdPerMillion: 0.36,
        r2StorageUsdPerGbMonth: 0.015,
        websocketMessagesPerRequest: 20,
        memoryGb: 0.128,
      },
      disclaimer:
        "Resettable app-metered list-price usage. Free-tier anchors use current published Cloudflare limits; daily and monthly allowances reset independently. Account-wide included quotas, rounding, Workers CPU/request analytics, and operations outside this deployment require Cloudflare billing analytics; the Cloudflare invoice remains authoritative.",
    };
  }
  /**
   * Append a spend sample at most once per interval. Deliberately a lazy write on read:
   * a Durable Object alarm purely to sample a number that is already being computed
   * would cost more than the datapoint is worth, and the page that shows the trend is
   * the same request that computes it.
   */
  /**
   * Today's consumption, as cumulative-now minus the baseline captured when the UTC day
   * turned over. Rolls the baseline forward on the first call of a new day, and re-captures
   * it if the cumulative counters ever move backwards (a storage generation reset), which
   * would otherwise report a negative day clamped to zero until midnight.
   */
  private today(current: Omit<DayBaseline, "day" | "startedAt">) {
    const now = Date.now(),
      day = new Date(now).toISOString().slice(0, 10),
      midnight = Date.parse(`${day}T00:00:00.000Z`);
    let baseline = this.dayBaseline;
    // The backwards test is deliberately slack. A deploy can lose up to one snapshot
    // interval of room activity, which dips the derived duration by a fraction of a
    // percent — that must not be read as a counter reset and wipe the day. Only a real
    // reset (a storage generation change) moves a cumulative counter by tenths.
    const wentBackwards = (value: number, base: number) => value < base * 0.9;
    if (
      !baseline ||
      baseline.day !== day ||
      wentBackwards(current.usd, baseline.usd) ||
      wentBackwards(current.requests, baseline.requests)
    ) {
      baseline = { day, startedAt: now, ...current };
      this.dayBaseline = baseline;
      this.countWrites(1);
      this.ctx.waitUntil(this.ctx.storage.put("dayBaseline", baseline));
    }
    const since = baseline.startedAt,
      delta = (value: number, base: number) => Math.max(0, value - base);
    return {
      day,
      since,
      // A baseline captured after midnight — first boot of the day, or the day this
      // measurement shipped — covers only part of the day. The page says so rather than
      // presenting a partial figure as a full one.
      partial: since > midnight + 60_000,
      elapsedHours: Number(((now - midnight) / 3_600_000).toFixed(2)),
      measuredHours: Number(((now - since) / 3_600_000).toFixed(2)),
      requests: Math.round(delta(current.requests, baseline.requests)),
      gbSeconds: Number(delta(current.gbSeconds, baseline.gbSeconds).toFixed(2)),
      rowsRead: delta(current.rowsRead, baseline.rowsRead),
      rowsWritten: delta(current.rowsWritten, baseline.rowsWritten),
      r2ClassA: delta(current.r2ClassA, baseline.r2ClassA),
      r2ClassB: delta(current.r2ClassB, baseline.r2ClassB),
      estimatedUsd: Number(delta(current.usd, baseline.usd).toFixed(8)),
    };
  }

  private sampleSpend(usd: number, requests: number, rowsWritten: number): void {
    const now = Date.now(), last = this.spendHistory[this.spendHistory.length - 1];
    if (last && now - last.ts < SPEND_SAMPLE_INTERVAL_MS) return;
    this.spendHistory.push({ ts: now, usd, requests, rowsWritten });
    if (this.spendHistory.length > SPEND_SAMPLE_CAP) this.spendHistory.splice(0, this.spendHistory.length - SPEND_SAMPLE_CAP);
    this.ctx.waitUntil(this.ctx.storage.put("spendHistory", this.spendHistory));
  }

  private hardLimitUsd(): number {
    const configured = Number(this.env.BILLING_HARD_LIMIT_USD ?? 5);
    return Number.isFinite(configured) && configured > 0 ? configured : 5;
  }
  private async enforceSpendLimit() {
    const billing = await this.billing();
    if (!billing.hardLimitExceeded || this.maintenance.enabled) return billing;
    const now = Date.now(),
      reason = `Measured application spend reached the $${billing.hardLimitUsd.toFixed(2)} hard limit.`;
    this.maintenance = { enabled: true, changedAt: now, reason };
    this.maintenanceIncidents.push({
      id: `spend-limit-${now}`,
      title: "Spend threshold shutdown",
      cause: "Billing hard limit",
      status: "active",
      startedAt: now,
      resolvedAt: null,
      impactEndedAt: null,
      summary:
        "The system disabled all game traffic after the measured spend threshold was reached.",
    });
    this.pruneIncidents();
    this.countWrites(3);
    await this.ctx.storage.put({
      maintenance: this.maintenance,
      maintenanceIncidents: this.maintenanceIncidents,
      usage: this.usage,
    });
    this.record({
      ts: now,
      type: "billing-hard-stop",
      subject: "system",
      detail: reason,
    });
    await this.appendControlHistory({
      ts: now,
      code: "BILLING-HARD-STOP",
      actor: "system",
      title: "Spend threshold forced game downtime",
      summary:
        "The measured application spend threshold was reached and all game traffic was disabled.",
      reference: `spend-limit-${now}`,
      detail: reason,
    });
    await Promise.all(
      CATALOG.map(({ id }) =>
        this.env.ROOM.get(this.env.ROOM.idFromName(id)).fetch(
          `https://room/maintenance?enabled=1&roomId=${id}`,
          { method: "POST" },
        ),
      ),
    );
    return billing;
  }
  private newBillingWindow(versionId: string): BillingWindow {
    const rooms: Record<string, BillingRoomBaseline> = {};
    for (const [id, report] of this.reports)
      rooms[id] = {
        activeDurationMs: report.activeDurationMs,
        wsMessages: report.wsMessages,
        connections: report.connections,
        storageWrites: report.storageWrites,
        storageRowsRead: report.storageRowsRead,
        storageRowsWritten: report.storageRowsWritten,
      };
    return {
      versionId,
      startedAt: Date.now(),
      tankRequests: this.usage.requests,
      storageWrites: this.usage.storageWrites,
      storageRowsRead: this.usage.storageRowsRead,
      storageRowsWritten: this.usage.storageRowsWritten,
      r2ClassA: this.usage.r2ClassA,
      r2ClassB: this.usage.r2ClassB,
      rooms,
    };
  }
  private countWrites(count: number): void {
    this.usage.storageWrites += count;
    this.usage.storageRowsWritten += count;
  }
  private trackSql(query: string, ...bindings: unknown[]): void {
    const cursor = this.ctx.storage.sql.exec(query, ...bindings);
    cursor.toArray();
    this.usage.storageRowsRead += cursor.rowsRead;
    this.usage.storageRowsWritten += cursor.rowsWritten;
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
    this.usage.storageRowsRead += previousCursor.rowsRead;
    this.usage.storageRowsWritten += previousCursor.rowsWritten;
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
    this.usage.storageRowsRead += insert.rowsRead;
    this.usage.storageRowsWritten += insert.rowsWritten;
    const sequenceCursor = this.ctx.storage.sql.exec<{ sequence: number }>(
      "SELECT sequence FROM control_history ORDER BY sequence DESC LIMIT 1",
    );
    const sequence = sequenceCursor.toArray()[0]?.sequence ?? 0;
    this.usage.storageRowsRead += sequenceCursor.rowsRead;
    this.usage.storageRowsWritten += sequenceCursor.rowsWritten;
    // Move the out-of-table head marker in the same breath as the row that created it.
    // A chain whose anchor is only ever written on read would treat a truncation that
    // happens between two reads as the new legitimate head.
    const previousAnchor = await this.loadHistoryAnchor(),
      entryCount =
        previousAnchor && previousAnchor.sequence < sequence
          ? previousAnchor.entryCount + 1
          : this.countControlHistoryRows();
    this.historyAnchor = { sequence, hash, entryCount, updatedAt: Date.now() };
    // Anchor and usage go in one put: two keys, one write, and the anchor cannot be
    // silently skipped by a failure that still recorded the row's cost.
    this.usage.storageWrites += 2;
    this.usage.storageRowsWritten += 1;
    await this.ctx.storage.put({
      controlHistoryAnchor: this.historyAnchor,
      usage: this.usage,
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
    this.usage.storageRowsRead += historyCursor.rowsRead + countCursor.rowsRead;
    this.usage.storageRowsWritten +=
      historyCursor.rowsWritten + countCursor.rowsWritten;
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
    this.usage.storageRowsRead += headCursor.rowsRead;
    this.usage.storageRowsWritten += headCursor.rowsWritten;
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
    this.usage.storageRowsRead += walkCursor.rowsRead;
    this.usage.storageRowsWritten += walkCursor.rowsWritten;
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
    this.usage.storageRowsRead += 1;
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
    this.countWrites(1);
    await this.ctx.storage.put("controlHistoryAnchor", this.historyAnchor);
  }
  private countControlHistoryRows(): number {
    const cursor = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM control_history",
    );
    const count = cursor.toArray()[0]?.count ?? 0;
    this.usage.storageRowsRead += cursor.rowsRead;
    this.usage.storageRowsWritten += cursor.rowsWritten;
    return count;
  }
  private async refreshR2(): Promise<void> {
    if (!this.env.R2_ASSETS || Date.now() - this.r2Snapshot.checkedAt < 300_000)
      return;
    let cursor: string | undefined,
      objectCount = 0,
      storageBytes = 0,
      operations = 0,
      truncated = false;
    do {
      const page = await this.env.R2_ASSETS.list({ prefix: this.env.R2_PREFIX ?? "", limit: 1000, cursor });
      operations += 1;
      objectCount += page.objects.length;
      storageBytes += page.objects.reduce(
        (sum, object) => sum + object.size,
        0,
      );
      truncated = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && operations < 100);
    this.usage.r2ClassA += operations;
    this.r2Snapshot = {
      checkedAt: Date.now(),
      objectCount,
      storageBytes,
      bucket: this.env.R2_BUCKET_NAME ?? "wizardgang-demo-assets",
      truncated,
    };
    this.countWrites(2);
    await this.ctx.storage.put({
      r2Snapshot: this.r2Snapshot,
      usage: this.usage,
    });
  }

  /* ── State export and restore (A.8.13) ────────────────────────────────────── */

  /**
   * Read every key and both tables into one self-describing object. Keys are sorted and
   * rows come back in primary-key order, so two exports of unchanged state are
   * byte-identical and therefore hash-identical.
   */
  private async exportState(): Promise<StateExport> {
    const kv: Record<string, unknown> = {};
    let startAfter: string | undefined,
      pages = 0,
      truncated = false;
    for (;;) {
      const batch = await this.ctx.storage.list<unknown>({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
      if (batch.size === 0) break;
      for (const [key, value] of batch) { kv[key] = value; startAfter = key; }
      this.usage.storageRowsRead += batch.size;
      pages += 1;
      if (batch.size < 1000) break;
      if (pages >= BACKUP_MAX_PAGES) { truncated = true; break; }
    }
    const auditCursor = this.ctx.storage.sql.exec<Record<string, string | number | null>>(
      "SELECT id,ts,type,room,subject,detail FROM audit ORDER BY id ASC",
    );
    const audit = auditCursor.toArray();
    this.usage.storageRowsRead += auditCursor.rowsRead;
    const historyCursor = this.ctx.storage.sql.exec<Record<string, string | number | null>>(
      "SELECT sequence,ts,code,actor,title,summary,reference,detail,previous_hash,hash FROM control_history ORDER BY sequence ASC",
    );
    const controlHistory = historyCursor.toArray();
    this.usage.storageRowsRead += historyCursor.rowsRead;
    const sortedKv: Record<string, unknown> = {};
    for (const key of Object.keys(kv).sort()) sortedKv[key] = kv[key];
    const body: StateExport = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      takenAt: Date.now(),
      generation: this.env.AUDIT_GENERATION ?? "local",
      kv: sortedKv,
      audit,
      controlHistory,
      counts: {
        kv: Object.keys(sortedKv).length,
        profiles: Object.keys(sortedKv).filter((key) => key.startsWith("profile:")).length,
        audit: audit.length,
        controlHistory: controlHistory.length,
      },
      ...(truncated ? { truncated: true } : {}),
    };
    return { ...body, digest: await backupDigest(body) };
  }

  /**
   * Replace every key and both tables with the contents of an export. Refuses anything
   * whose digest does not match its body, because restoring a mutated copy would put
   * unverifiable rows into a chain the site advertises as tamper-evident.
   */
  private async importState(payload: unknown): Promise<{ ok: boolean; error?: string; restored?: StateExport["counts"]; digest?: string }> {
    const candidate = payload as { export?: StateExport } | StateExport | null;
    const data = (candidate && typeof candidate === "object" && "export" in candidate ? candidate.export : candidate) as StateExport | null;
    if (!data || typeof data !== "object") return { ok: false, error: "no export in body" };
    if (data.format !== BACKUP_FORMAT) return { ok: false, error: "unrecognised export format" };
    if (data.version !== BACKUP_VERSION) return { ok: false, error: `unsupported export version ${String(data.version)}` };
    if (!data.kv || typeof data.kv !== "object" || !Array.isArray(data.audit) || !Array.isArray(data.controlHistory))
      return { ok: false, error: "export is missing one of kv, audit or controlHistory" };
    const { digest, ...body } = data;
    const recomputed = await backupDigest(body as StateExport);
    if (digest && digest !== recomputed) return { ok: false, error: "export digest does not match its contents" };

    // Clear first, in one pass each, so a key present in the live object but absent from
    // the export does not survive the restore and make the copy look incomplete.
    let startAfter: string | undefined, pages = 0;
    const doomed: string[] = [];
    for (;;) {
      const batch = await this.ctx.storage.list<unknown>({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
      if (batch.size === 0) break;
      for (const key of batch.keys()) { doomed.push(key); startAfter = key; }
      pages += 1;
      if (batch.size < 1000 || pages >= BACKUP_MAX_PAGES) break;
    }
    for (let i = 0; i < doomed.length; i += 128) await this.ctx.storage.delete(doomed.slice(i, i + 128));
    this.trackSql("DELETE FROM audit");
    this.trackSql("DELETE FROM control_history");

    const entries = Object.entries(data.kv);
    for (let i = 0; i < entries.length; i += 128)
      await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 128)));
    for (const row of data.audit)
      this.ctx.storage.sql.exec(
        "INSERT INTO audit(id,ts,type,room,subject,detail) VALUES(?,?,?,?,?,?)",
        row.id ?? null, row.ts ?? 0, row.type ?? "", row.room ?? null, row.subject ?? null, row.detail ?? null,
      ).toArray();
    for (const row of data.controlHistory)
      this.ctx.storage.sql.exec(
        "INSERT INTO control_history(sequence,ts,code,actor,title,summary,reference,detail,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
        row.sequence ?? null, row.ts ?? 0, row.code ?? "", row.actor ?? "", row.title ?? "",
        row.summary ?? "", row.reference ?? null, row.detail ?? null, row.previous_hash ?? "", row.hash ?? "",
      ).toArray();

    await this.reloadFromStorage();
    return { ok: true, restored: data.counts, digest: recomputed };
  }

  /**
   * Re-read the in-memory caches after a restore. Without this the object would answer
   * from the state it held before the restore and report the copy as having failed.
   */
  private async reloadFromStorage(): Promise<void> {
    this.usage = (await this.ctx.storage.get<Usage>("usage")) ?? this.usage;
    this.spendHistory = (await this.ctx.storage.get<SpendSample[]>("spendHistory")) ?? [];
    this.dayBaseline = (await this.ctx.storage.get<DayBaseline>("dayBaseline")) ?? null;
    this.maintenance = (await this.ctx.storage.get<MaintenanceState>("maintenance")) ?? { enabled: false, changedAt: 0, reason: "" };
    this.maintenanceIncidents = (await this.ctx.storage.get<MaintenanceIncident[]>("maintenanceIncidents")) ?? [];
    this.r2Snapshot = (await this.ctx.storage.get<R2Snapshot>("r2Snapshot")) ?? this.r2Snapshot;
    this.reports.clear();
    const reports = (await this.ctx.storage.get<Record<string, Report>>("reports")) ?? {};
    for (const [id, report] of Object.entries(reports)) this.reports.set(id, report);
    const billingWindow = await this.ctx.storage.get<BillingWindow>("billingWindow");
    if (billingWindow) this.billingWindow = billingWindow;
    this.profileStats = (await this.ctx.storage.get<ProfileStats>("profileStats")) ?? null;
    this.backupState = (await this.ctx.storage.get<BackupState>("backupState")) ?? null;
    // The anchor and the cached verification both describe the chain that was here a
    // moment ago. Drop them so the next read re-derives them from the restored rows.
    this.historyAnchor = null;
    this.historyAnchorLoaded = false;
    this.historyVerification = null;
  }

  /**
   * Delete every key and both tables. Only ever called on the scratch instance used by a
   * restore drill; the drill's own `finally` calls it whether the drill passed or failed,
   * so a failed drill does not become the thing that leaves profiles lying around.
   */
  private async wipeState(): Promise<number> {
    let startAfter: string | undefined, pages = 0;
    const doomed: string[] = [];
    for (;;) {
      const batch = await this.ctx.storage.list<unknown>({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
      if (batch.size === 0) break;
      for (const key of batch.keys()) { doomed.push(key); startAfter = key; }
      pages += 1;
      if (batch.size < 1000 || pages >= BACKUP_MAX_PAGES) break;
    }
    for (let i = 0; i < doomed.length; i += 128) await this.ctx.storage.delete(doomed.slice(i, i + 128));
    this.trackSql("DELETE FROM audit");
    this.trackSql("DELETE FROM control_history");
    await this.reloadFromStorage();
    return doomed.length;
  }

  private async loadBackupState(): Promise<BackupState> {
    if (!this.backupState) {
      this.backupState = (await this.ctx.storage.get<BackupState>("backupState")) ?? { ...EMPTY_BACKUP_STATE };
      this.usage.storageRowsRead += 1;
    }
    return this.backupState;
  }

  /** Record a copy the Worker has written, and receipt it into the chain. */
  private async recordBackup(input: Partial<BackupState> & { ok?: boolean }): Promise<BackupState> {
    const current = await this.loadBackupState(),
      failed = input.ok === false,
      error = clean(input.lastBackupError, 200) ?? "";
    const next: BackupState = failed
      ? { ...current, lastBackupError: error || "backup failed" }
      : {
          ...current,
          lastBackupAt: clampInt(Number(input.lastBackupAt ?? Date.now()), 0, Number.MAX_SAFE_INTEGER),
          lastBackupKey: clean(input.lastBackupKey, 200) ?? current.lastBackupKey,
          lastBackupBytes: clampInt(Number(input.lastBackupBytes ?? 0), 0, Number.MAX_SAFE_INTEGER),
          lastBackupDigest: clean(input.lastBackupDigest, 64) ?? "",
          lastBackupCounts: input.lastBackupCounts ?? current.lastBackupCounts,
          retainedCopies: clampInt(Number(input.retainedCopies ?? current.retainedCopies), 0, 100_000),
          lastBackupError: "",
        };
    this.backupState = next;
    this.countWrites(2);
    await this.ctx.storage.put({ backupState: next, usage: this.usage });
    await this.appendControlHistory({
      ts: Date.now(),
      code: failed ? "BACKUP-FAILED" : "BACKUP-TAKEN",
      actor: "system",
      title: failed ? "Scheduled state copy failed" : "State copied to object storage",
      summary: failed
        ? `A scheduled copy of service state did not complete: ${error || "no detail recorded"}.`
        : `Service state copied to object storage: ${next.lastBackupCounts?.kv ?? 0} keys, ${next.lastBackupCounts?.controlHistory ?? 0} receipts, ${next.lastBackupBytes} bytes.`,
      reference: failed ? null : next.lastBackupKey,
      detail: failed ? null : `digest=${next.lastBackupDigest}; retained=${next.retainedCopies}`,
    });
    return next;
  }

  /** Record a restore drill result, and receipt it. A drill nobody can see proves nothing. */
  private async recordDrill(ok: boolean, detail: string): Promise<BackupState> {
    const current = await this.loadBackupState(),
      next: BackupState = { ...current, lastDrillAt: Date.now(), lastDrillOk: ok, lastDrillDetail: detail };
    this.backupState = next;
    this.countWrites(2);
    await this.ctx.storage.put({ backupState: next, usage: this.usage });
    await this.appendControlHistory({
      ts: next.lastDrillAt,
      code: ok ? "RESTORE-DRILL-PASSED" : "RESTORE-DRILL-FAILED",
      actor: "operator",
      title: ok ? "Restore drill passed" : "Restore drill failed",
      summary: ok
        ? "The most recent copy in object storage was read back, restored into a scratch instance, and its export digest matched the copy's."
        : "A restore drill did not read back and reproduce the most recent stored copy. The backup path is not proven until this passes.",
      reference: "/status/#backup",
      detail: detail || null,
    });
    return next;
  }
}
/** Strip the internal last-seen bookkeeping before a profile leaves the Worker. */
function publicProfile(profile: StoredProfile): Profile {
  return {
    name: profile.name,
    skin: profile.skin,
    best: profile.best,
    ...(profile.settings ? { settings: profile.settings } : {}),
  };
}
/**
 * The one and only receipt hash. Both the append path and the verifier call this, because
 * two implementations that drift by a single field or key order would make verification
 * fail on honest data and be indistinguishable from a real tamper alarm.
 */
/**
 * Digest of the *state* an export carries, not of the export envelope. Three fields are
 * deliberately outside it: `digest` itself, because a hash cannot cover the place it is
 * about to be written to; `takenAt`, because it is the moment of capture rather than
 * anything about the data; and `generation`, which names the deployment that took the
 * copy. Including `takenAt` would make two exports of identical state hash differently,
 * which would defeat the one comparison this digest exists to support — restore a copy
 * into a scratch instance, export it, and check the two digests are equal.
 *
 * Object keys are emitted in sorted order at every depth, so the order storage happened
 * to hand keys back cannot change the hash.
 */
async function backupDigest(body: unknown): Promise<string> {
  const source = (body ?? {}) as Record<string, unknown>;
  const state = { format: source.format, version: source.version, kv: source.kv, audit: source.audit, controlHistory: source.controlHistory, counts: source.counts };
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      const source = value as Record<string, unknown>, out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) if (key !== "digest") out[key] = canonical(source[key]);
      return out;
    }
    return value;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(state)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
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
    /^(room-boot|join|leave|death|play|customize|skin|settings|nav|quit)$/.test(
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
