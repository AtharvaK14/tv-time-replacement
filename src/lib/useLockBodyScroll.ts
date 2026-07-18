import { useEffect } from "react";

// Reference-counted rather than a plain boolean, so nested modals (e.g.
// EpisodeDetailsPanel opened from within DetailsPanel, both of which call
// this hook) don't unlock the body the moment the INNER one closes while
// the outer one is still open. Verified this actually happens in this app:
// opening an episode's details from a show's details panel mounts a second
// modal on top of the first, they are not mutually exclusive.
let lockCount = 0;
let savedScrollY = 0;
let savedBodyStyles: {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
} | null = null;

/**
 * Locks page scroll while mounted, restores the exact prior scroll position
 * on unmount. Call unconditionally from any component that is itself only
 * ever mounted while its modal is open (this app's existing pattern of
 * `{openX !== null && <SomeModal ... />}` already guarantees that).
 *
 * Deliberately NOT just `document.body.style.overflow = "hidden"`. Checked
 * current cross-browser behavior before building this: overflow:hidden on
 * <body> does not reliably block touch-driven scrolling on iOS Safari, a
 * still-live WebKit quirk as of early 2026, not something later iOS
 * versions fixed. The reliable technique, confirmed against multiple
 * current sources, is pinning <body> with position:fixed at its current
 * scroll offset and restoring that exact offset on unlock. Source:
 * https://www.jayfreestone.com/writing/locking-body-scroll-ios/
 */
export function useLockBodyScroll(): void {
  useEffect(() => {
    if (lockCount === 0) {
      savedScrollY = window.scrollY;
      const body = document.body;
      savedBodyStyles = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        overflow: body.style.overflow,
      };
      body.style.position = "fixed";
      body.style.top = `-${savedScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.overflow = "hidden";
    }
    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0 && savedBodyStyles) {
        const body = document.body;
        body.style.position = savedBodyStyles.position;
        body.style.top = savedBodyStyles.top;
        body.style.left = savedBodyStyles.left;
        body.style.right = savedBodyStyles.right;
        body.style.width = savedBodyStyles.width;
        body.style.overflow = savedBodyStyles.overflow;
        window.scrollTo(0, savedScrollY);
        savedBodyStyles = null;
      }
    };
  }, []);
}
