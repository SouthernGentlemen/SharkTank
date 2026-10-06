// Screen-reader announcer. A single polite/assertive live region pair lives at the
// app root; components call announce() to push status text (score changes, deaths,
// leaderboard shifts, screen transitions) — satisfying WCAG 4.1.3 Status Messages
// without moving focus.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Politeness = "polite" | "assertive";

interface AnnouncerApi {
  announce: (message: string, politeness?: Politeness) => void;
}

const Ctx = createContext<AnnouncerApi>({ announce: () => {} });

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  // Clearing the region and setting it again on the next frame is what makes a live
  // region re-fire. There used to be a `message === last` guard in front of this, which
  // meant an identical consecutive message was dropped instead of re-announced — so a
  // second death at the same score, or a second disconnect, was silent. Every caller
  // announces on a state transition rather than per frame, so repeats are real events
  // and are worth speaking.
  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    if (!message) return;
    const set = politeness === "assertive" ? setAssertive : setPolite;
    // Clear, then set on a later task: the empty render is what makes the region fire
    // again for a message identical to the last one. A timer rather than
    // requestAnimationFrame because rAF does not run at all while the document is
    // hidden, which silently swallowed the announcement instead of delaying it.
    set("");
    setTimeout(() => set(message), 60);
  }, []);

  const api = useMemo(() => ({ announce }), [announce]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </Ctx.Provider>
  );
}

export function useAnnouncer(): AnnouncerApi {
  return useContext(Ctx);
}
