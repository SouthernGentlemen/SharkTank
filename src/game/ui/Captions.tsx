// Visual captions for sound effects (WCAG 1.2.1 — an alternative for audio cues, and
// a way to verify audio is firing without hearing it). Shown only when captions are on.

import { useEffect, useState } from "react";
import type { Caption } from "../audio/useGameAudio.js";
import { goldenFishNearby } from "../game/preyPresentation.js";
import type { RoomSocket } from "../net/useRoomSocket.js";

export function Captions({ caption }: { caption: Caption | null }) {
  if (!caption) return null;
  return (
    <div aria-hidden="true" className="game-captions">
      <span className="game-caption-pill" key={caption.id}>{caption.text}</span>
    </div>
  );
}

/** The rare fish gets a semantic, always-visible proximity caption independent of audio. */
export function GoldenFishCaption({ socket }: { socket: RoomSocket }) {
  const [nearby, setNearby] = useState(false);
  useEffect(() => {
    const update = () => {
      const state = socket.stateRef.current;
      const self = state?.sharks.find((shark) => shark.id === socket.youId && shark.alive);
      const visible = !!state && goldenFishNearby(state.food, self?.position);
      setNearby((previous) => previous === visible ? previous : visible);
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [socket.stateRef, socket.youId]);
  if (!nearby) return null;
  return <div role="status" aria-live="polite" className="game-golden-caption">✦ Golden fish nearby · 12 points</div>;
}
