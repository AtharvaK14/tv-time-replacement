import { useEffect, useRef } from "react";

// A stack of "handle the Android hardware/gesture back button" callbacks.
// Open overlays (details panel, episode panel, filter sheet, wizard) push a
// handler while mounted; a back press runs the TOP handler only (so a panel
// stacked on a panel closes one layer at a time). When the stack is empty,
// App falls back to tab navigation, then to exiting the app.
//
// This module is pure (no Capacitor import) so it works and can be reasoned
// about on the web build too; only App wires it to the real native event.

type BackHandler = () => void;

const stack: BackHandler[] = [];

function pushBackHandler(fn: BackHandler): () => void {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Runs the topmost handler, if any. Returns true when one handled the press. */
export function runTopBackHandler(): boolean {
  const fn = stack[stack.length - 1];
  if (fn) {
    fn();
    return true;
  }
  return false;
}

/**
 * Registers `handler` as the back action while `active` (typically: while an
 * overlay is open). The latest handler is always used via a ref, so callers
 * can pass an inline function without churning the registration.
 */
export function useBackHandler(active: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}
