// Pause dialog. Satisfies WCAG 2.2.2 (pause/stop) for the moving game content: while
// open, gameplay input is disabled and the player can resume, open settings, or quit.
// Focus is trapped; Esc resumes.

import { useRef } from "react";
import { useFocusTrap } from "../a11y/useFocusTrap.js";

export function PauseMenu({
  onResume,
  onSettings,
  onQuit,
  pauseLabel = "Esc",
}: {
  onResume: () => void;
  onSettings: () => void;
  onQuit: () => void;
  pauseLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onResume);

  return (
    <div className="scrim">
      <div
        ref={ref}
        className="panel stack pause-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
      >
        <h2 id="pause-title" className="dialog-title">Paused</h2>
        <div className="stack">
          <button className="btn btn--primary btn--lg btn--block" onClick={onResume}>Resume</button>
          <button className="btn btn--block" onClick={onSettings}>Settings</button>
          <button className="btn btn--block" onClick={onQuit}>Quit to tank</button>
        </div>
        <p className="dialog-note">
          Press <kbd>{pauseLabel}</kbd> to resume.
        </p>
      </div>
    </div>
  );
}
