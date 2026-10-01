import { applyAction, createRoom, leaderboard, playerCount, PREY_BUDGET, replay, SKINS, spawnBots, step, TICKS_PER_SECOND, type Action, type GameLogEntry, type RoomState } from "module-react3fiber/engine";
import { clientInputToAction, parseRealtimeClientMessage, sanitizeDisplayName, toNetState, withRealtimeProtocol, type ServerMessagePayload } from "module-react3fiber/protocol";
import { GAME_LOG_SCHEMA_VERSION, bootstrapRoomSnapshot, shouldRotateGameLogSchema } from "./room-state-schema.js";

// A tank holds 32 sharks: up to SHARK_CAPACITY - BOT_COUNT humans, with bots making up
// the rest so a lightly-populated tank still feels like a full lobby.
const SHARK_CAPACITY = 32, CAPACITY = 8, BOT_COUNT = SHARK_CAPACITY - CAPACITY;
const OCEAN_RADIUS = 82;
const LEADERBOARD_EVERY = TICKS_PER_SECOND * 2, REPORT_EVERY = TICKS_PER_SECOND * 30;
const STATE_BROADCAST_EVERY = 2; // 20Hz authoritative simulation, 10Hz snapshots.
// Tank captures are a rolling 24-hour record: anything older is pruned, so the public
// page, the JSON, and the TXT download always describe exactly the same window.
const SNAPSHOT_EVERY = TICKS_PER_SECOND * 30, GAME_LOG_RETENTION_MS = 24 * 60 * 60 * 1000, GAME_LOG_CAP = 10_000;
const MAX_MESSAGE_BYTES = 4_096, INPUTS_PER_SECOND = 40;
interface Env { LOBBY: DurableObjectNamespace; AUDIT_GENERATION?: string; GAME_LOG_GENERATION?: string }
interface SessionAttachment { id: string; profileId: string | null; name: string; skin: string; wasAlive: boolean; joined: boolean; rateAt: number; rateCount: number }
interface Session extends SessionAttachment { ws: WebSocket; lastOrientationLogTick: number }
interface RoomMeta { roomId: string; roomName: string; booted: boolean; maintenance?: boolean; activeMs: number; activeSince: number | null; wsMessages: number; connections: number; storageWrites: number; storageRowsRead?: number; storageRowsWritten?: number; lastProfileResultRound?: number }
interface StoredLog extends GameLogEntry { ts: number }

export class Room implements DurableObject {
  private room: RoomState;
  private readonly sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private roomId = "room-local";
  private roomName = "Tank";
  private booted = false;
  private maintenance = false;
  private activeMs = 0;
  private activeSince: number | null = null;
  private wsMessages = 0;
  private connections = 0;
  private storageWrites = 0;
  private storageRowsRead = 0;
  private storageRowsWritten = 0;
  private lastProfileResultRound = 0;
  private profileResultInFlightRound = 0;

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    this.room = createRoom({ id: this.ctx.id.toString(), seed: `seed-${this.ctx.id.toString().slice(0, 8)}`, oceanRadius: OCEAN_RADIUS }); spawnBots(this.room, BOT_COUNT);
    this.trackSql("CREATE TABLE IF NOT EXISTS game_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, tick INTEGER NOT NULL, action TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ts')");
    try { this.trackSql("ALTER TABLE game_log ADD COLUMN language TEXT NOT NULL DEFAULT 'ts'"); } catch { /* existing schema already has the retained column */ }
    this.trackSql("CREATE INDEX IF NOT EXISTS game_log_ts ON game_log(ts)");
    void this.ctx.blockConcurrencyWhile(async () => {
      const generation = this.env.GAME_LOG_GENERATION ?? this.env.AUDIT_GENERATION;
      const storedGeneration = await this.ctx.storage.get<string>("gameLogGeneration"); this.storageRowsRead += 1;
      const storedLogSchema = await this.ctx.storage.get<number>("gameLogSchemaVersion"); this.storageRowsRead += 1;
      const storedRoom = await this.ctx.storage.get<unknown>("snapshot"); this.storageRowsRead += 1;
      const snapshotBoot = bootstrapRoomSnapshot(storedRoom, this.room);
      this.room = snapshotBoot.room;

      const generationChanged = Boolean(generation && storedGeneration !== generation);
      const replaySchemaChanged = shouldRotateGameLogSchema(storedLogSchema) || snapshotBoot.source.endsWith("-reset");
      if (generationChanged || replaySchemaChanged) this.trackSql("DELETE FROM game_log");
      if (generationChanged && generation) {
        await this.ctx.storage.put("gameLogGeneration", generation);
        this.storageRowsWritten += 1;
      }
      if (storedLogSchema !== GAME_LOG_SCHEMA_VERSION) {
        await this.ctx.storage.put("gameLogSchemaVersion", GAME_LOG_SCHEMA_VERSION);
        this.storageRowsWritten += 1;
      }
      for (const id of Object.keys(this.room.snakes)) {
        const botIndex = /^bot-(\d+)$/.exec(id);
        if (botIndex && Number(botIndex[1]) >= BOT_COUNT) delete this.room.snakes[id];
      }
      spawnBots(this.room, BOT_COUNT);
      if (this.room.food.length > PREY_BUDGET.max) this.room.food.splice(0, this.room.food.length - PREY_BUDGET.max);
      if (snapshotBoot.persistSnapshot) { await this.ctx.storage.put("snapshot", this.room); this.storageRowsWritten += 1; }
      const bootRowsRead = this.storageRowsRead, bootRowsWritten = this.storageRowsWritten;
      const meta = await this.ctx.storage.get<RoomMeta>("meta");
      if (meta) { this.roomId = meta.roomId; this.roomName = meta.roomName; this.booted = meta.booted; this.maintenance = meta.maintenance ?? false; this.activeMs = meta.activeMs ?? 0; this.activeSince = null; this.wsMessages = meta.wsMessages ?? 0; this.connections = meta.connections ?? 0; this.storageWrites = meta.storageWrites ?? 0; this.storageRowsRead = (meta.storageRowsRead ?? 0) + bootRowsRead + 1; this.storageRowsWritten = (meta.storageRowsWritten ?? meta.storageWrites ?? 0) + bootRowsWritten; this.lastProfileResultRound = meta.lastProfileResultRound ?? 0; }
      else this.storageRowsRead += 1;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as SessionAttachment | null;
        if (a?.id) this.sessions.set(ws, { ws, ...a, lastOrientationLogTick: -Infinity });
      }
      if (this.maintenance) for (const ws of [...this.sessions.keys()]) this.close(ws, 1012, "maintenance");
      else if ([...this.sessions.values()].some((s) => s.joined)) this.ensureLoop();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.roomId = url.searchParams.get("roomId") ?? this.roomId; this.roomName = cleanRoomName(url.searchParams.get("roomName") ?? this.roomName);
    if (url.pathname.endsWith("/maintenance")) {
      this.maintenance = url.searchParams.get("enabled") === "1";
      if (this.maintenance) for (const ws of [...this.sessions.keys()]) this.close(ws, 1012, "maintenance");
      this.persist();
      return roomJson({ ok: true, maintenance: this.maintenance });
    }
    if (url.pathname.endsWith("/log")) return this.gameLogResponse(url);
    if (url.pathname.endsWith("/replay")) return this.replayResponse(url);
    if (this.maintenance) return new Response("maintenance", { status: 503, headers: { "retry-after": "60" } });
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    if (this.full()) return new Response("room full", { status: 503, headers: { "retry-after": "5" } });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    const trustedProfileId = request.headers.get("x-profile-id");
    const profileId = trustedProfileId && /^[a-f0-9-]{36}$/.test(trustedProfileId) ? trustedProfileId : null;
    const session: Session = { id: `p-${crypto.randomUUID().slice(0, 12)}`, profileId, ws: server, name: "Player", skin: "cyan", wasAlive: true, joined: false, rateAt: Date.now(), rateCount: 0, lastOrientationLogTick: -Infinity };
    this.connections += 1;
    this.sessions.set(server, session); this.saveAttachment(session); this.ctx.acceptWebSocket(server);
    if (!this.booted) { this.booted = true; this.emitEvent("room-boot", this.roomName); this.persist(); }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.wsMessages += 1;
    const session = this.sessions.get(ws) ?? this.restoreSession(ws); if (!session) return this.close(ws, 1008, "missing session");
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES || !this.allowInput(session)) return this.close(ws, 1008, "invalid or excessive input");
    let parsed: unknown; try { parsed = JSON.parse(message) as unknown; } catch { return this.close(ws, 1007, "invalid JSON"); }
    if (parsed && typeof parsed === "object" && (parsed as { t?: unknown }).t === "debug") return;
    const parsedMessage = parseRealtimeClientMessage(parsed);
    if (!parsedMessage.ok) {
      return this.close(ws, 1008, parsedMessage.reason === "stale-schema" ? "realtime schema mismatch" : "invalid message");
    }
    const msg = parsedMessage.message;
    if (msg.t === "hello") {
      if (session.joined) return;
      // Seats are taken here, not at the upgrade: a socket that has not said hello yet is
      // still joined:false, so the upgrade check alone lets one client open N sockets and
      // then claim every seat at once. Re-check before this session becomes a player.
      if (this.full()) return this.close(ws, 1013, "room full");
      session.name = sanitizeDisplayName(msg.name); session.skin = SKINS.some((s) => s.id === msg.skin) ? msg.skin : "cyan"; session.joined = true;
      this.applyAndLog({ type: "join", playerId: session.id, name: session.name, skin: session.skin });
      session.wasAlive = this.room.snakes[session.id]?.alive ?? false;
      this.saveAttachment(session);
      this.send(ws, { t: "welcome", youId: session.id, roomId: this.roomId, state: toNetState(this.room) }); this.reportToLobby(); this.emitEvent("join", session.name); this.ensureLoop(); return;
    }
    if (msg.t === "ping") { this.send(ws, { t: "pong", ts: msg.ts }); return; }
    if (msg.t === "input" && session.joined) {
      const action = clientInputToAction(msg.action, session.id);
      if (action.type === "setOrientation" && this.room.tick - session.lastOrientationLogTick < 5) applyAction(this.room, action);
      else { this.applyAndLog(action); if (action.type === "setOrientation") session.lastOrientationLogTick = this.room.tick; }
    }
  }
  webSocketClose(ws: WebSocket): void { this.dropSession(ws); }
  webSocketError(ws: WebSocket): void { this.dropSession(ws); }

  private dropSession(ws: WebSocket): void {
    const session = this.sessions.get(ws) ?? this.restoreSession(ws); if (!session) return;
    this.sessions.delete(ws);
    if (session.joined) { this.applyAndLog({ type: "leave", playerId: session.id }); this.reportToLobby(); this.emitEvent("leave", session.name); }
    if (![...this.sessions.values()].some((s) => s.joined)) { this.stopLoop(); this.persist(); }
  }
  private restoreSession(ws: WebSocket): Session | null { const a = ws.deserializeAttachment() as SessionAttachment | null; if (!a?.id) return null; const s = { ws, ...a, lastOrientationLogTick: -Infinity }; this.sessions.set(ws, s); return s; }
  private saveAttachment(s: Session): void { const { id, profileId, name, skin, wasAlive, joined, rateAt, rateCount } = s; s.ws.serializeAttachment({ id, profileId, name, skin, wasAlive, joined, rateAt, rateCount } satisfies SessionAttachment); }
  private full(): boolean { return [...this.sessions.values()].filter((s) => s.joined).length >= CAPACITY; }
  private allowInput(s: Session): boolean { const now = Date.now(); if (now - s.rateAt >= 1_000) { s.rateAt = now; s.rateCount = 0; } s.rateCount += 1; return s.rateCount <= INPUTS_PER_SECOND; }
  private close(ws: WebSocket, code: number, reason: string): void { try { ws.close(code, reason); } catch { /* closed */ } this.dropSession(ws); }

  private ensureLoop(): void { if (!this.timer) { this.activeSince = Date.now(); this.timer = setInterval(() => this.tick(), 1000 / TICKS_PER_SECOND); } }
  private stopLoop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.activeSince) this.activeMs += Date.now() - this.activeSince; this.activeSince = null; }
  private tick(): void {
    const beforeRound = this.room.round.number;
    const beforePhase = this.room.round.phase;
    step(this.room);

    if (
      this.room.round.phase === "result"
      && this.lastProfileResultRound < this.room.round.number
    ) this.persistAuthoritativeResults();
    if (beforeRound !== this.room.round.number || beforePhase !== this.room.round.phase) this.persist();

    for (const session of this.sessions.values()) {
      if (!session.joined) continue;
      const snake = this.room.snakes[session.id], alive = snake?.alive ?? false;
      if (session.wasAlive && !alive && snake) {
        const death = snake.lastDeath;
        const killer = death?.killerId ? this.room.snakes[death.killerId]?.name ?? death.killerId : null;
        this.send(session.ws, { t: "died", by: killer, action: death?.action ?? null, tick: death?.tick ?? this.room.tick, score: snake.score, respawnInMs: Math.max(0, (snake.respawnTick - this.room.tick) * (1000 / TICKS_PER_SECOND)) });
        this.emitEvent("death", session.name, `action=${death?.action ?? "unknown"};killer=${killer ?? "none"};tick=${death?.tick ?? this.room.tick};score=${snake.score}`);
      }
      if (session.wasAlive !== alive) { session.wasAlive = alive; this.saveAttachment(session); }
    }
    if (this.room.tick % STATE_BROADCAST_EVERY === 0) this.broadcast({ t: "state", state: toNetState(this.room) });
    if (this.room.tick % LEADERBOARD_EVERY === 0) this.broadcast({ t: "leaderboard", entries: leaderboard(this.room, 10) });
    if (this.room.tick % REPORT_EVERY === 0) this.reportToLobby();
    if (this.room.tick % SNAPSHOT_EVERY === 0) this.persist();
  }
  private persistAuthoritativeResults(): void {
    const roundNumber = this.room.round.number;
    if (this.lastProfileResultRound >= roundNumber || this.profileResultInFlightRound === roundNumber) return;
    this.profileResultInFlightRound = roundNumber;

    const updates: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (!session.joined || !session.profileId) continue;
      const shark = this.room.snakes[session.id];
      if (!shark) continue;
      updates.push(
        this.env.LOBBY.get(this.env.LOBBY.idFromName("global")).fetch("https://lobby/profile-result", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-profile-id": session.profileId,
          },
          body: JSON.stringify({ best: shark.score, name: shark.name, skin: shark.skin }),
        }).then((response) => {
          if (!response.ok) throw new Error(`profile result write failed: ${response.status}`);
        }),
      );
    }

    const complete = () => {
      this.lastProfileResultRound = roundNumber;
      this.profileResultInFlightRound = 0;
      this.persist();
    };
    if (updates.length === 0) {
      complete();
      return;
    }
    this.ctx.waitUntil(
      Promise.all(updates)
        .then(complete)
        .catch(() => {
          // Leave the persisted marker behind the round so the next result tick (or a
          // hibernation restore) retries the idempotent max-score writes.
          this.profileResultInFlightRound = 0;
        }),
    );
  }
  private send(ws: WebSocket, msg: ServerMessagePayload): void { try { ws.send(JSON.stringify(withRealtimeProtocol(msg))); } catch { this.dropSession(ws); } }
  private broadcast(msg: ServerMessagePayload): void { const body = JSON.stringify(withRealtimeProtocol(msg)); for (const s of [...this.sessions.values()]) if (s.joined) { try { s.ws.send(body); } catch { this.dropSession(s.ws); } } }
  private reportToLobby(): void { const top = leaderboard(this.room, 1)[0]; this.ctx.waitUntil(this.env.LOBBY.get(this.env.LOBBY.idFromName("global")).fetch("https://lobby/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: this.roomId, name: this.roomName, players: playerCount(this.room), bots: BOT_COUNT, capacity: CAPACITY, sharkCapacity: SHARK_CAPACITY, topScore: top?.score ?? 0, topName: top?.name ?? "—", activeDurationMs: this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0), wsMessages: this.wsMessages, connections: this.connections, storageWrites: this.storageWrites, storageRowsRead: this.storageRowsRead, storageRowsWritten: this.storageRowsWritten, storageBytes: this.ctx.storage.sql.databaseSize }) }).then(() => undefined)); }
  private emitEvent(type: "room-boot" | "join" | "leave" | "death", subject?: string, detail?: string): void { this.ctx.waitUntil(this.env.LOBBY.get(this.env.LOBBY.idFromName("global")).fetch("https://lobby/event", { method: "POST", headers: { "content-type": "application/json", "x-actor-id": `room:${this.roomId}` }, body: JSON.stringify({ ts: Date.now(), type, room: this.roomId, subject, detail }) }).then(() => undefined)); }
  private applyAndLog(action: Action): void { applyAction(this.room, action); this.trackSql("INSERT INTO game_log(ts,tick,action,language) VALUES(?,?,?,'ts')", Date.now(), this.room.tick, JSON.stringify(action)); this.storageWrites += 1; if (this.room.tick % 100 === 0) this.pruneGameLog(); }
  private pruneGameLog(): void { this.trackSql("DELETE FROM game_log WHERE ts < ? OR id NOT IN (SELECT id FROM game_log ORDER BY id DESC LIMIT ?)", Date.now() - GAME_LOG_RETENTION_MS, GAME_LOG_CAP); }
  private persist(): void { this.storageWrites += 2; this.storageRowsWritten += 2; this.ctx.waitUntil(this.ctx.storage.put({ snapshot: this.room, meta: { roomId: this.roomId, roomName: this.roomName, booted: this.booted, maintenance: this.maintenance, activeMs: this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0), activeSince: null, wsMessages: this.wsMessages, connections: this.connections, storageWrites: this.storageWrites, storageRowsRead: this.storageRowsRead, storageRowsWritten: this.storageRowsWritten, lastProfileResultRound: this.lastProfileResultRound } satisfies RoomMeta })); }
  private logs(limit?: number): StoredLog[] { const cursor = limit ? this.ctx.storage.sql.exec<{ ts: number; tick: number; action: string }>("SELECT ts,tick,action FROM game_log ORDER BY id DESC LIMIT ?", limit) : this.ctx.storage.sql.exec<{ ts: number; tick: number; action: string }>("SELECT ts,tick,action FROM game_log ORDER BY id"); const rows = cursor.toArray(); this.storageRowsRead += cursor.rowsRead; this.storageRowsWritten += cursor.rowsWritten; const ordered = limit ? rows.reverse() : rows; return ordered.map((r) => ({ ts: r.ts, tick: r.tick, action: JSON.parse(r.action) as Action })); }
  private trackSql(query: string, ...bindings: unknown[]): void { const cursor = this.ctx.storage.sql.exec(query, ...bindings); cursor.toArray(); this.storageRowsRead += cursor.rowsRead; this.storageRowsWritten += cursor.rowsWritten; }
  private gameLogResponse(url?: URL): Response { this.pruneGameLog(); const requested = Number(url?.searchParams.get("limit") ?? 0); const limit = Number.isFinite(requested) && requested > 0 ? Math.min(GAME_LOG_CAP, Math.trunc(requested)) : undefined; return roomJson({ ok: true, roomId: this.roomId, seed: this.room.seed, botCount: BOT_COUNT, schemaVersion: GAME_LOG_SCHEMA_VERSION, tick: this.room.tick, events: this.logs(limit), retentionHours: 24, maxEvents: GAME_LOG_CAP }); }
  private replayResponse(url: URL): Response { const toTick = Math.max(0, Math.min(this.room.tick, Math.trunc(Number(url.searchParams.get("tick") ?? this.room.tick)))); if (toTick > 100_000) return roomJson({ ok: false, error: "replay tick exceeds safety limit" }, 422); const logs = this.logs(); if (logs.length && logs[0].tick > 0) return roomJson({ ok: false, error: "complete replay history has expired" }, 410); const state = replay({ seed: this.room.seed, id: this.roomId, botCount: BOT_COUNT }, logs, toTick); return roomJson({ ok: true, roomId: this.roomId, schemaVersion: GAME_LOG_SCHEMA_VERSION, tick: toTick, state: toNetState(state) }); }
}

function cleanRoomName(value: string): string { return value.replace(/[^a-zA-Z0-9 '-]/g, "").slice(0, 32) || "Tank"; }
function roomJson(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
