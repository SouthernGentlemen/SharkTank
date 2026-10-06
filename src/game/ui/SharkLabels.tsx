// Colorblind name labels. Reads projected head positions written each frame by the
// Scene into a shared ref and renders DOM name tags over the canvas, so a shark's
// identity never depends on color alone (WCAG 1.4.1). Purely decorative for AT
// (aria-hidden) — the leaderboard already conveys names/scores semantically.

import { useEffect, useRef, useState } from "react";
import { resolveClientPerformanceProfile } from "../game/performance.js";
import type { SceneQuality } from "../game/sceneMath.js";
import type { SharkLabel } from "../game/Scene.js";

export function SharkLabels({
  labelsRef,
  quality,
}: {
  labelsRef: React.MutableRefObject<SharkLabel[]>;
  quality: SceneQuality;
}) {
  const [labels, setLabels] = useState<SharkLabel[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = () => {
      setLabels(labelsRef.current.slice(0, 7));
    };
    tick();
    const interval = resolveClientPerformanceProfile(quality).labelUpdateMs;
    timer.current = setInterval(tick, interval);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [labelsRef, quality]);

  return (
    <svg className="shark-label-layer" width="100%" height="100%" aria-hidden="true">
      {labels.map((l) => (
        <g
          key={l.id}
          className={`shark-label${l.me ? " is-me" : ""}${l.apex ? " is-apex" : ""}`}
          transform={`translate(${l.x} ${l.y - 28})`}
        >
          <rect
            x="-68"
            y="-12"
            width="136"
            height="24"
            rx="6"
            fill={l.color}
            stroke={l.me ? "#fff" : l.apex ? "#ffd54a" : "rgba(0,0,0,0.35)"}
            strokeWidth={l.me || l.apex ? 2 : 1}
          />
          <text x="0" y="4" textAnchor="middle">{l.name}{l.apex ? " · APEX" : ""}</text>
        </g>
      ))}
    </svg>
  );
}
