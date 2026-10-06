import { applyAction, createRoom, leaderboard, SKINS, spawnBots, step, TICKS_PER_SECOND, type RoomState } from "../engine/index.js";
import { clientInputToAction, parseRealtimeClientMessage, sanitizeDisplayName, toNetState, withRealtimeProtocol, type ServerMessagePayload } from "../protocol/index.js";

// A tank holds 32 sharks: up to SHARK_CAPACITY - BOT_COUNT humans, with bots making up
// the rest so a lightly-populated tank still feels like a full lobby.
const SHARK_CAPACITY = 32, CAPACITY = 8, BOT_COUNT = SHARK_CAPACITY - CAPACITY;
const OCEAN_RADIUS = 82;
const LEADERBOARD_EVERY = TICKS_PER_SECOND * 2;
const STATE_BROADCAST_EVERY = 2; // 20Hz authoritative simulation, 10Hz snapshots.
const MAX_MESSAGE_BYTES = 4_096, INPUTS_PER_SECOND = 40;
interface Session { id: string; ws: WebSocket; name: string; skin: string; wasAlive: boolean; joined: boolean; rateAt: number; rateCount: number }

export class Room {
  private room: RoomState;
  private readonly sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private roomId = "room-local";

  constructor(private readonly ctx: DurableObjectState) {
    this.room = createRoom({ id: this.ctx.id.toString(), seed: `seed-${this.ctx.id.toString().slice(0, 8)}`, oceanRadius: OCEAN_RADIUS });
    spawnBots(this.room, BOT_COUNT);
    // ST-144 intentionally abandons Room persistence. Clear legacy snapshots/metadata before
    // the object serves requests; every object boot then starts from the fresh in-memory room above.
    void this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.roomId = url.searchParams.get("roomId") ?? this.roomId;
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });

    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    const session: Session = { id: `p-${crypto.randomUUID().slice(0, 12)}`, ws: server, name: "Player", skin: "cyan", wasAlive: true, joined: false, rateAt: Date.now(), rateCount: 0 };
    this.sessions.set(server, session);
    server.accept();
    server.addEventListener("message", (event) => this.webSocketMessage(server, event.data));
    server.addEventListener("close", () => this.dropSession(server));
    server.addEventListener("error", () => this.dropSession(server));
    this.ensureLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  private webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const session = this.sessions.get(ws); if (!session) return this.close(ws, 1008, "missing session");
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
      this.send(ws, { t: "welcome", youId: session.id, roomId: this.roomId, state: toNetState(this.room) }); return;
    }
    if (msg.t === "ping") { this.send(ws, { t: "pong", ts: msg.ts }); return; }
    if (msg.t === "input" && session.joined) applyAction(this.room, clientInputToAction(msg.action, session.id));
  }

  private dropSession(ws: WebSocket): void {
    const session = this.sessions.get(ws); if (!session) return;
    this.sessions.delete(ws);
    if (session.joined) applyAction(this.room, { type: "leave", playerId: session.id });
    if (this.sessions.size === 0) this.stopLoop();
  }
  private full(): boolean { return [...this.sessions.values()].filter((s) => s.joined).length >= CAPACITY; }
  private allowInput(s: Session): boolean { const now = Date.now(); if (now - s.rateAt >= 1_000) { s.rateAt = now; s.rateCount = 0; } s.rateCount += 1; return s.rateCount <= INPUTS_PER_SECOND; }
  private close(ws: WebSocket, code: number, reason: string): void { try { ws.close(code, reason); } catch { /* closed */ } this.dropSession(ws); }

  private ensureLoop(): void { if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / TICKS_PER_SECOND); }
  private stopLoop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private tick(): void {
    step(this.room);
    for (const session of this.sessions.values()) {
      if (!session.joined) continue;
      const snake = this.room.snakes[session.id], alive = snake?.alive ?? false;
      if (session.wasAlive && !alive && snake) {
        const death = snake.lastDeath;
        const killer = death?.killerId ? this.room.snakes[death.killerId]?.name ?? death.killerId : null;
        this.send(session.ws, { t: "died", by: killer, action: death?.action ?? null, tick: death?.tick ?? this.room.tick, score: snake.score, respawnInMs: Math.max(0, (snake.respawnTick - this.room.tick) * (1000 / TICKS_PER_SECOND)) });
      }
      session.wasAlive = alive;
    }
    if (this.room.tick % STATE_BROADCAST_EVERY === 0) this.broadcast({ t: "state", state: toNetState(this.room) });
    if (this.room.tick % LEADERBOARD_EVERY === 0) this.broadcast({ t: "leaderboard", entries: leaderboard(this.room, 10) });
  }
  private send(ws: WebSocket, msg: ServerMessagePayload): void { try { ws.send(JSON.stringify(withRealtimeProtocol(msg))); } catch { this.dropSession(ws); } }
  private broadcast(msg: ServerMessagePayload): void { const body = JSON.stringify(withRealtimeProtocol(msg)); for (const s of [...this.sessions.values()]) if (s.joined) { try { s.ws.send(body); } catch { this.dropSession(s.ws); } } }
}
