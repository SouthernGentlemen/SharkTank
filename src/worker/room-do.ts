import { applyAction, createRoom, leaderboard, PREY_BUDGET, SKINS, spawnBots, step, TICKS_PER_SECOND, type RoomState } from "module-react3fiber/engine";
import { clientInputToAction, parseRealtimeClientMessage, sanitizeDisplayName, toNetState, withRealtimeProtocol, type ServerMessagePayload } from "module-react3fiber/protocol";
import { bootstrapRoomSnapshot } from "./room-state-schema.js";

// A tank holds 32 sharks: up to SHARK_CAPACITY - BOT_COUNT humans, with bots making up
// the rest so a lightly-populated tank still feels like a full lobby.
const SHARK_CAPACITY = 32, CAPACITY = 8, BOT_COUNT = SHARK_CAPACITY - CAPACITY;
const ROOM_NAME = "SharkTank";
const OCEAN_RADIUS = 82;
const LEADERBOARD_EVERY = TICKS_PER_SECOND * 2;
const STATE_BROADCAST_EVERY = 2; // 20Hz authoritative simulation, 10Hz snapshots.
const SNAPSHOT_EVERY = TICKS_PER_SECOND * 30;
const MAX_MESSAGE_BYTES = 4_096, INPUTS_PER_SECOND = 40;
interface SessionAttachment { id: string; name: string; skin: string; wasAlive: boolean; joined: boolean; rateAt: number; rateCount: number }
interface Session extends SessionAttachment { ws: WebSocket }
interface RoomMeta { roomId: string; roomName: string; booted: boolean; maintenance?: boolean }

export class Room implements DurableObject {
  private room: RoomState;
  private readonly sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private roomId = "room-local";
  private roomName = ROOM_NAME;
  private booted = false;
  private maintenance = false;

  constructor(private readonly ctx: DurableObjectState) {
    this.room = createRoom({ id: this.ctx.id.toString(), seed: `seed-${this.ctx.id.toString().slice(0, 8)}`, oceanRadius: OCEAN_RADIUS }); spawnBots(this.room, BOT_COUNT);
    void this.ctx.blockConcurrencyWhile(async () => {
      const storedRoom = await this.ctx.storage.get<unknown>("snapshot");
      const snapshotBoot = bootstrapRoomSnapshot(storedRoom, this.room);
      this.room = snapshotBoot.room;
      for (const id of Object.keys(this.room.snakes)) {
        const botIndex = /^bot-(\d+)$/.exec(id);
        if (botIndex && Number(botIndex[1]) >= BOT_COUNT) delete this.room.snakes[id];
      }
      spawnBots(this.room, BOT_COUNT);
      if (this.room.food.length > PREY_BUDGET.max) this.room.food.splice(0, this.room.food.length - PREY_BUDGET.max);
      if (snapshotBoot.persistSnapshot) await this.ctx.storage.put("snapshot", this.room);
      const meta = await this.ctx.storage.get<RoomMeta>("meta");
      if (meta) { this.roomId = meta.roomId; this.roomName = ROOM_NAME; this.booted = meta.booted; this.maintenance = meta.maintenance ?? false; }
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as SessionAttachment | null;
        if (a?.id) this.sessions.set(ws, { ws, ...a });
      }
      if (this.maintenance) for (const ws of [...this.sessions.keys()]) this.close(ws, 1012, "maintenance");
      else if ([...this.sessions.values()].some((s) => s.joined)) this.ensureLoop();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.roomId = url.searchParams.get("roomId") ?? this.roomId; this.roomName = ROOM_NAME;
    if (url.pathname.endsWith("/maintenance")) {
      this.maintenance = url.searchParams.get("enabled") === "1";
      if (this.maintenance) for (const ws of [...this.sessions.keys()]) this.close(ws, 1012, "maintenance");
      this.persist();
      return roomJson({ ok: true, maintenance: this.maintenance });
    }
    if (this.maintenance) return new Response("maintenance", { status: 503, headers: { "retry-after": "60" } });
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    const session: Session = { id: `p-${crypto.randomUUID().slice(0, 12)}`, ws: server, name: "Player", skin: "cyan", wasAlive: true, joined: false, rateAt: Date.now(), rateCount: 0 };
    this.sessions.set(server, session); this.saveAttachment(session); this.ctx.acceptWebSocket(server);
    if (!this.booted) { this.booted = true; this.persist(); }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const session = this.sessions.get(ws) ?? this.restoreSession(ws); if (!session) return this.close(ws, 1008, "missing session");
    if (typeof message !== "string" || message.length > MAX_MESSAGE_BYTES || !this.allowInput(session)) return this.close(ws, 1008, "invalid or excessive input");
    let parsed: unknown; try { parsed = JSON.parse(message) as unknown; } catch { return this.close(ws, 1007, "invalid JSON"); }
    if (parsed && typeof parsed === "object" && (parsed as { t?: unknown }).t === "debug") return;
    const parsedMessage = parseRealtimeClientMessage(parsed);
    if (!parsedMessage.ok) return this.close(ws, 1008, parsedMessage.reason === "stale-schema" ? "realtime schema mismatch" : "invalid message");
    const msg = parsedMessage.message;
    if (msg.t === "hello") {
      if (session.joined) return;
      if (this.full()) return this.close(ws, 1013, "room full");
      session.name = sanitizeDisplayName(msg.name); session.skin = SKINS.some((s) => s.id === msg.skin) ? msg.skin : "cyan"; session.joined = true;
      applyAction(this.room, { type: "join", playerId: session.id, name: session.name, skin: session.skin });
      session.wasAlive = this.room.snakes[session.id]?.alive ?? false;
      this.saveAttachment(session);
      this.send(ws, { t: "welcome", youId: session.id, roomId: this.roomId, state: toNetState(this.room) }); this.ensureLoop(); return;
    }
    if (msg.t === "ping") { this.send(ws, { t: "pong", ts: msg.ts }); return; }
    if (msg.t === "input" && session.joined) applyAction(this.room, clientInputToAction(msg.action, session.id));
  }
  webSocketClose(ws: WebSocket): void { this.dropSession(ws); }
  webSocketError(ws: WebSocket): void { this.dropSession(ws); }

  private dropSession(ws: WebSocket): void {
    const session = this.sessions.get(ws) ?? this.restoreSession(ws); if (!session) return;
    this.sessions.delete(ws);
    if (session.joined) applyAction(this.room, { type: "leave", playerId: session.id });
    if (![...this.sessions.values()].some((s) => s.joined)) { this.stopLoop(); this.persist(); }
  }
  private restoreSession(ws: WebSocket): Session | null { const a = ws.deserializeAttachment() as SessionAttachment | null; if (!a?.id) return null; const s = { ws, ...a }; this.sessions.set(ws, s); return s; }
  private saveAttachment(s: Session): void { const { id, name, skin, wasAlive, joined, rateAt, rateCount } = s; s.ws.serializeAttachment({ id, name, skin, wasAlive, joined, rateAt, rateCount } satisfies SessionAttachment); }
  private full(): boolean { return [...this.sessions.values()].filter((s) => s.joined).length >= CAPACITY; }
  private allowInput(s: Session): boolean { const now = Date.now(); if (now - s.rateAt >= 1_000) { s.rateAt = now; s.rateCount = 0; } s.rateCount += 1; return s.rateCount <= INPUTS_PER_SECOND; }
  private close(ws: WebSocket, code: number, reason: string): void { try { ws.close(code, reason); } catch { /* closed */ } this.dropSession(ws); }

  private ensureLoop(): void { if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / TICKS_PER_SECOND); }
  private stopLoop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private tick(): void {
    const beforeRound = this.room.round.number;
    const beforePhase = this.room.round.phase;
    step(this.room);
    if (beforeRound !== this.room.round.number || beforePhase !== this.room.round.phase) this.persist();
    for (const session of this.sessions.values()) {
      if (!session.joined) continue;
      const snake = this.room.snakes[session.id], alive = snake?.alive ?? false;
      if (session.wasAlive && !alive && snake) {
        const death = snake.lastDeath;
        const killer = death?.killerId ? this.room.snakes[death.killerId]?.name ?? death.killerId : null;
        this.send(session.ws, { t: "died", by: killer, action: death?.action ?? null, tick: death?.tick ?? this.room.tick, score: snake.score, respawnInMs: Math.max(0, (snake.respawnTick - this.room.tick) * (1000 / TICKS_PER_SECOND)) });
      }
      if (session.wasAlive !== alive) { session.wasAlive = alive; this.saveAttachment(session); }
    }
    if (this.room.tick % STATE_BROADCAST_EVERY === 0) this.broadcast({ t: "state", state: toNetState(this.room) });
    if (this.room.tick % LEADERBOARD_EVERY === 0) this.broadcast({ t: "leaderboard", entries: leaderboard(this.room, 10) });
    if (this.room.tick % SNAPSHOT_EVERY === 0) this.persist();
  }
  private send(ws: WebSocket, msg: ServerMessagePayload): void { try { ws.send(JSON.stringify(withRealtimeProtocol(msg))); } catch { this.dropSession(ws); } }
  private broadcast(msg: ServerMessagePayload): void { const body = JSON.stringify(withRealtimeProtocol(msg)); for (const s of [...this.sessions.values()]) if (s.joined) { try { s.ws.send(body); } catch { this.dropSession(s.ws); } } }
  private persist(): void { this.ctx.waitUntil(this.ctx.storage.put({ snapshot: this.room, meta: { roomId: this.roomId, roomName: this.roomName, booted: this.booted, maintenance: this.maintenance } satisfies RoomMeta })); }
}

function roomJson(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
