// WebSocket client for a Room. Keeps the latest NetState in a ref (so the R3F render
// loop can read it every frame without triggering React re-renders) while surfacing
// low-frequency UI state (connection status, leaderboard, death) through React state.
// Auto-reconnects with backoff.

import { useCallback, useEffect, useRef, useState } from "react";
import { clampPitch, normalizeYaw, shortestYawDelta, TICKS_PER_SECOND } from "../../engine/index.js";
import { parseRealtimeServerMessage, withRealtimeProtocol, type ClientMessagePayload, type NetState, type ScoreEntry } from "../../protocol/index.js";
import { connectionAfterClose, connectionAfterWelcome, type ConnectionStatus } from "./roomConnectionState.js";

import { toClientState, type ClientState } from "./clientState.js";

const TICK_MS = 1000 / TICKS_PER_SECOND;

export type { ConnectionStatus } from "./roomConnectionState.js";

export interface DeathInfo {
  by: string | null;
  action: "bite" | "boundary" | "retire" | null;
  tick: number;
  score: number;
  respawnInMs: number;
  at: number; // client timestamp
}

/** A pair of buffered snapshots straddling the render time, plus the blend factor. */
export interface InterpFrame {
  older: ClientState;
  newer: ClientState;
  alpha: number; // 0 at `older`, 1 at `newer`
}

export interface RoomSocket {
  /** Latest authoritative snapshot; null until the first packet. Used by HUD/minimap/audio. */
  stateRef: React.MutableRefObject<ClientState | null>;
  /** performance.now() when the newest snapshot arrived — for prediction reconciliation. */
  newestAtRef: React.MutableRefObject<number>;
  /**
   * Sample the snapshot buffer at (now − delayMs) and return the two snapshots that
   * bracket that render time with an interpolation factor. This is anchored to the
   * server tick timeline (buffer timestamps), NOT to jittery packet-arrival time, so
   * the 60fps render stays smooth. Returns null before the first packet.
   */
  frameAt: (delayMs: number) => InterpFrame | null;
  youId: string | null;
  status: ConnectionStatus;
  leaderboard: ScoreEntry[];
  death: DeathInfo | null;
  setOrientation: (yaw: number, pitch: number) => void;
  setBoost: (on: boolean) => void;
  bite: () => void;
  respawn: () => void;
  retry: () => void;
}

function wsUrl(roomId: string, roomName: string): string {
  const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof window !== "undefined" ? window.location.host : "localhost";
  return `${protocol}//${host}/room/${encodeURIComponent(roomId)}/ws?roomName=${encodeURIComponent(roomName)}`;
}

export function useRoomSocket(
  roomId: string | null,
  identity: { name: string; skin: string },
  roomName = "Tank",
): RoomSocket {
  const stateRef = useRef<ClientState | null>(null);
  const newestAtRef = useRef<number>(0);
  // Ring of recent snapshots stamped with client receive time, ordered oldest→newest.
  const bufferRef = useRef<Array<{ t: number; state: ClientState }>>([]);
  // Convert the authoritative tick clock to the client's monotonic clock once per
  // connection. Interpolation then advances on server time instead of packet-arrival
  // time, so a late packet cannot make every remote entity visibly speed up or stall.
  const timelineOriginRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryNowRef = useRef<() => void>(() => {});
  const lastOrientationRef = useRef({ yaw: Infinity, pitch: Infinity });
  const lastOrientationSentAtRef = useRef(0);
  const lastBoostRef = useRef<boolean>(false);
  const youIdRef = useRef<string | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;


  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [youId, setYouId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [death, setDeath] = useState<DeathInfo | null>(null);

  const send = useCallback((msg: ClientMessagePayload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(withRealtimeProtocol(msg)));
  }, []);

  // Record a snapshot as the latest AND append it to the interpolation buffer.
  const pushSnapshot = useCallback((wireState: NetState) => {
    const state = toClientState(wireState);
    stateRef.current = state;
    const currentPlayerId = youIdRef.current;
    if (currentPlayerId && state.snakes.some((shark) => shark.id === currentPlayerId && shark.alive)) {
      setDeath(null);
    }
    const now = performance.now();
    newestAtRef.current = now;
    const buf = bufferRef.current;
    if (buf.length && state.tick < buf[buf.length - 1].state.tick) {
      buf.length = 0;
      timelineOriginRef.current = null;
    }
    timelineOriginRef.current ??= now - state.tick * TICK_MS;
    buf.push({ t: now, state });
    // Keep ~1.5s of history; always retain at least two to interpolate across.
    const cutoff = now - 1500;
    while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
  }, []);

  const frameAt = useCallback((delayMs: number): InterpFrame | null => {
    const buf = bufferRef.current;
    const n = buf.length;
    if (n === 0) return null;
    const origin = timelineOriginRef.current ?? (buf[0].t - buf[0].state.tick * TICK_MS);
    const renderServerTime = performance.now() - origin - delayMs;
    const oldestServerTime = buf[0].state.tick * TICK_MS;
    const newestServerTime = buf[n - 1].state.tick * TICK_MS;
    if (renderServerTime <= oldestServerTime) return { older: buf[0].state, newer: buf[0].state, alpha: 0 };
    if (renderServerTime >= newestServerTime) return { older: buf[n - 1].state, newer: buf[n - 1].state, alpha: 1 };
    // Find snapshots that bracket the render point on the authoritative tick clock.
    let i = n - 2;
    while (i > 0 && buf[i].state.tick * TICK_MS > renderServerTime) i -= 1;
    const older = buf[i];
    const newer = buf[i + 1];
    const olderServerTime = older.state.tick * TICK_MS;
    const span = (newer.state.tick - older.state.tick) * TICK_MS;
    const alpha = span > 0 ? (renderServerTime - olderServerTime) / span : 0;
    return { older: older.state, newer: newer.state, alpha };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let closedByUs = false;
    let failedAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = (keepFullStatus = false) => {
      if (closedByUs) return;
      clearReconnectTimer();
      if (!keepFullStatus) setStatus(failedAttempts === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(wsUrl(roomId, roomName));
      wsRef.current = ws;

      ws.onopen = () => {
        send({ t: "hello", name: identityRef.current.name, skin: identityRef.current.skin });
      };

      ws.onmessage = (ev) => {
        let raw: unknown;
        try { raw = JSON.parse(ev.data as string) as unknown; } catch { return; }
        const parsed = parseRealtimeServerMessage(raw);
        if (!parsed.ok) {
          if (parsed.reason === "stale-schema") {
            closedByUs = true;
            setStatus("incompatible");
            ws.close(1008, "realtime schema mismatch");
          }
          return;
        }
        const msg = parsed.message;
        switch (msg.t) {
          case "welcome": {
            const transition = connectionAfterWelcome();
            failedAttempts = transition.failedAttempts;
            setStatus(transition.status);
            bufferRef.current = [];
            timelineOriginRef.current = null;
            setYouId(msg.youId);
            youIdRef.current = msg.youId;
            pushSnapshot(msg.state);
            setDeath(null);
            break;
          }
          case "state": pushSnapshot(msg.state); break;
          case "leaderboard": setLeaderboard(msg.entries); break;
          case "died":
            setDeath({ by: msg.by, action: msg.action, tick: msg.tick, score: msg.score, respawnInMs: msg.respawnInMs, at: performance.now() });
            break;
          case "pong": break;
        }
      };

      ws.onclose = (event) => {
        if (event.code === 1008 && event.reason === "realtime schema mismatch") {
          closedByUs = true;
          setStatus("incompatible");
          return;
        }
        if (closedByUs) return;
        const transition = connectionAfterClose(event.code, event.reason, failedAttempts);
        failedAttempts = transition.failedAttempts;
        setStatus(transition.status);
        if (transition.retryInMs !== null) {
          reconnectTimer = setTimeout(() => connect(transition.status === "full"), transition.retryInMs);
        }
      };
      ws.onerror = () => ws.close();
    };

    retryNowRef.current = () => {
      if (closedByUs) return;
      clearReconnectTimer();
      failedAttempts = 0;
      connect();
    };
    connect();

    const onPageHide = () => {
      closedByUs = true;
      clearReconnectTimer();
      wsRef.current?.close();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);

    return () => {
      closedByUs = true;
      retryNowRef.current = () => {};
      clearReconnectTimer();
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
      wsRef.current?.close();
      wsRef.current = null;
      stateRef.current = null;
      bufferRef.current = [];
      timelineOriginRef.current = null;
    };
  }, [roomId, roomName, send, pushSnapshot]);

  const setOrientation = useCallback(
    (yaw: number, pitch: number) => {
      const safeYaw = normalizeYaw(yaw);
      const safePitch = clampPitch(pitch);
      const now = performance.now();
      const last = lastOrientationRef.current;
      const changed = !Number.isFinite(last.yaw)
        || Math.abs(shortestYawDelta(last.yaw, safeYaw)) >= 0.05
        || Math.abs(last.pitch - safePitch) >= 0.04;
      if (now - lastOrientationSentAtRef.current < 100 || !changed) return;
      lastOrientationSentAtRef.current = now;
      lastOrientationRef.current = { yaw: safeYaw, pitch: safePitch };
      send({ t: "input", action: { type: "setOrientation", yaw: safeYaw, pitch: safePitch } });
    },
    [send],
  );

  const setBoost = useCallback(
    (on: boolean) => {
      if (on === lastBoostRef.current) return;
      lastBoostRef.current = on;
      send({ t: "input", action: { type: "setBoost", on } });
    },
    [send],
  );

  const respawn = useCallback(() => {
    setDeath(null);
    send({ t: "input", action: { type: "respawn" } });
  }, [send]);
  const bite = useCallback(() => send({ t: "input", action: { type: "bite" } }), [send]);
  const retry = useCallback(() => retryNowRef.current(), []);

  return {
    stateRef,
    newestAtRef,
    frameAt,
    youId,
    status,
    leaderboard,
    death,
    setOrientation,
    setBoost,
    bite,
    respawn,
    retry,
  };
}
