/** Short, non-interactive local growth feedback. No wire fields or world particles. */
import { useEffect, useRef, useState } from "react";
import type { SharkTier } from "../../engine/growth.js";
import { useAnnouncer } from "../a11y/announcer.js";
import { audio } from "../audio/AudioManager.js";
import type { RoomSocket } from "../net/useRoomSocket.js";
import { detectEvolution, type EvolutionTracker } from "./evolution.js";

interface EvolutionToast {
  name: SharkTier;
  key: number;
}

export function EvolutionMoment({ socket, reducedMotion }: {
  socket: RoomSocket;
  reducedMotion: boolean;
}) {
  const { announce } = useAnnouncer();
  const tracker = useRef<EvolutionTracker | null>(null);
  const nextKey = useRef(0);
  const [toast, setToast] = useState<EvolutionToast | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      if (socket.status !== "open" || !socket.youId) return;
      const state = socket.stateRef.current;
      const me = state?.sharks.find((shark) => shark.id === socket.youId);
      if (!state || !me) return;
      const result = detectEvolution(tracker.current, {
        playerId: me.id,
        roundNumber: state.round.number,
        tick: state.tick,
        alive: me.alive,
        length: me.length,
        score: me.score,
      });
      tracker.current = result.tracker;
      if (!result.evolved) return;

      nextKey.current += 1;
      setToast({ name: result.evolved, key: nextKey.current });
      announce(`Evolved: ${result.evolved}.`, "polite");
      if (!reducedMotion) audio.playSfx("evolve", { key: "evolve", minIntervalMs: 180 });
    }, 100);
    return () => clearInterval(timer);
  }, [socket, announce, reducedMotion]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast((current) => current?.key === toast.key ? null : current);
    }, 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="game-evolution" aria-hidden="true">
      {!reducedMotion && <span key={toast.key} className="game-evolution__ring" />}
      <span className="game-evolution__toast">Evolved: {toast.name}</span>
    </div>
  );
}
