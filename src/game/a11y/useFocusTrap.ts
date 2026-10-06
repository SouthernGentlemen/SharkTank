// Focus trap for modal dialogs (pause / settings / customize overlays).
// Traps Tab within the container, moves initial focus in, restores focus to the
// previously-focused element on unmount, and calls onEscape for Esc. Satisfies
// 2.1.2 (no keyboard trap escape) + 2.4.3 (focus order) for dialogs.

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void): void {
  // `onEscape` is almost always an inline closure at the call site, so it is a new function
  // on every render of the owning component. Keeping it in the dep array made this effect
  // tear down and re-arm on every re-render — and cleanup restores focus to the previously
  // focused element while setup focuses the first control. In-game that meant a keyboard
  // user was thrown back to the Close button in lockstep with the leaderboard broadcast
  // (every 2s), which is a keyboard trap in practice (WCAG 2.4.3, 2.1.1). Read it through a
  // ref instead: the handler always calls the latest callback, and the trap arms once.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the dialog (first focusable, else the container itself).
    const initial = focusables()[0] ?? container;
    initial.focus();

    /**
     * Bound to the document, not to the container.
     *
     * A keydown listener on the container only fires while focus is inside the container.
     * One click on the scrim — which has no click handler of its own — moves focus to
     * `<body>`, and from there the listener never runs again: Escape does not close a
     * dialog marked `aria-modal="true"`, and Tab walks the page behind it. That is a
     * keyboard trap in the exact situation the trap exists to prevent (SC 2.1.2).
     *
     * On the document, Escape always closes, and the Tab logic runs whether or not focus
     * escaped — a Tab from outside the container is pulled back to the first control
     * rather than continuing into the page underneath.
     */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      const outside = !container.contains(activeEl);
      // The shift branch already handled `outside`; the forward branch did not, so a Tab
      // from the scrim fell through to the browser's own order and left the dialog.
      if (e.shiftKey && (activeEl === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
