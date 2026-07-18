import { useEffect, useState } from "react";

// Same breakpoint as the bottom-nav switch in index.css. Kept identical on
// purpose, a screen that gets the mobile bottom-tab-bar should also get the
// mobile drag-sheet details panel, not a mismatched combination of the two.
const MOBILE_BREAKPOINT_QUERY = "(max-width: 640px)";

/**
 * Reactive, not a one-time check: uses matchMedia's change event so it
 * updates live if the window is resized or, more relevantly while
 * developing, if you toggle device emulation in devtools without a full
 * page reload.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  return isMobile;
}