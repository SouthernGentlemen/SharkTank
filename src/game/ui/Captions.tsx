// Visual captions for sound effects (WCAG 1.2.1 — an alternative for audio cues, and
// a way to verify audio is firing without hearing it). Shown only when captions are on.

import type { Caption } from "../audio/useGameAudio.js";

export function Captions({ caption }: { caption: Caption | null }) {
  if (!caption) return null;
  return (
    <div aria-hidden="true" className="game-captions">
      <span className="game-caption-pill" key={caption.id}>{caption.text}</span>
    </div>
  );
}
