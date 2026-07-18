import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

// The small gap left at the very top of the screen when fully expanded,
// matching the requested "drag to the top, small gap remaining" behavior.
// Must match the sheet's own `top` value in CSS (.details-sheet { top }).
export const SHEET_TOP_GAP_PX = 12;

// How much of the viewport height is visible in the sheet's default
// (not dragged) state. A judgment call, not a spec, tune if it feels too
// tall or too short once you've used it.
const COLLAPSED_VISIBLE_FRACTION = 0.55;

const SNAP_TRANSITION = "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)";
// Must match the transition duration above: after triggering a dismiss we
// wait this long before actually calling onDismiss, so the panel closes
// (and unmounts) only once it has visibly finished sliding away, not
// mid-animation.
const DISMISS_ANIMATION_MS = 320;

// A fast flick snaps to the direction of the flick even if the release
// position is closer to the OTHER snap point, matching native bottom-sheet
// feel (e.g. iOS). Units: px per ms. Judgment call, not a platform constant.
const VELOCITY_FLICK_THRESHOLD = 0.5;

// Once dragged below the collapsed resting point, further finger movement
// only moves the sheet by this fraction, "rubber band" resistance so
// pulling past collapsed reads as deliberate, not an accidental free-fall
// toward closing. Judgment call, not a platform constant.
const DISMISS_DRAG_RESISTANCE = 0.55;

// How far past collapsed (in already-damped px, i.e. what's actually on
// screen, not raw finger travel) a slow release needs to be before it's
// treated as "let go to close" rather than "spring back to collapsed".
// Judgment call, not a spec.
const DISMISS_DISTANCE_PX = 70;

interface DragState {
  startClientY: number;
  startTranslateY: number;
  lastClientY: number;
  lastTimestamp: number;
  velocity: number; // px/ms, positive = moving down
}

export interface DraggableSheetHandle {
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  isDragging: boolean;
  sheetStyle: CSSProperties;
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  };
}

/**
 * Drives a bottom-sheet-style panel with two snap points (collapsed and
 * expanded near the top) plus drag-to-dismiss: dragging down past the
 * collapsed resting point, or a fast downward flick once already at or
 * below it, closes the panel by calling `onDismiss` after the slide-away
 * animation finishes.
 *
 * Deliberately gated on "already at or below collapsed": a fast downward
 * flick starting from the fully-expanded position collapses rather than
 * closes, you have to actually reach the resting point first before
 * letting go dismisses it. Otherwise one enthusiastic flick from expanded
 * could close the whole panel when the person only meant to collapse it.
 *
 * Uses Pointer Events (not separate touch/mouse handlers) so the same code
 * path handles mouse, touch, and pen. The consumer spreads `handleProps`
 * onto a dedicated drag-handle element only, not the whole panel, so
 * normal scrolling/clicking elsewhere in the panel is unaffected.
 */
export function useDraggableSheet(onDismiss: () => void): DraggableSheetHandle {
  const [expanded, setExpanded] = useState(false);
  const [collapsedOffset, setCollapsedOffset] = useState(0);
  const [dismissOffset, setDismissOffset] = useState(0);
  const [liveTranslateY, setLiveTranslateY] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<DragState | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    function computeOffsets() {
      const fullSheetHeight = window.innerHeight - SHEET_TOP_GAP_PX;
      const visibleWhenCollapsed = window.innerHeight * COLLAPSED_VISIBLE_FRACTION;
      setCollapsedOffset(Math.max(0, fullSheetHeight - visibleWhenCollapsed));
      // Fully off-screen: translated down by the sheet's own full height,
      // so its top edge lands exactly at the bottom edge of the viewport.
      setDismissOffset(fullSheetHeight);
    }
    computeOffsets();
    window.addEventListener("resize", computeOffsets);
    return () => window.removeEventListener("resize", computeOffsets);
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current !== null) window.clearTimeout(dismissTimeoutRef.current);
    };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const startTranslateY = expanded ? 0 : collapsedOffset;
      dragState.current = {
        startClientY: e.clientY,
        startTranslateY,
        lastClientY: e.clientY,
        lastTimestamp: e.timeStamp,
        velocity: 0,
      };
      setIsDragging(true);
      setLiveTranslateY(startTranslateY);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [expanded, collapsedOffset]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      e.preventDefault();
      const deltaY = e.clientY - drag.startClientY;
      const raw = drag.startTranslateY + deltaY;

      let next: number;
      if (raw <= collapsedOffset) {
        next = Math.max(0, raw); // normal expand<->collapse range, 1:1
      } else {
        // Past the resting point: damped, see DISMISS_DRAG_RESISTANCE.
        const overshoot = raw - collapsedOffset;
        next = collapsedOffset + Math.min(overshoot * DISMISS_DRAG_RESISTANCE, dismissOffset - collapsedOffset);
      }

      const dt = e.timeStamp - drag.lastTimestamp;
      if (dt > 0) {
        drag.velocity = (e.clientY - drag.lastClientY) / dt;
      }
      drag.lastClientY = e.clientY;
      drag.lastTimestamp = e.timeStamp;
      setLiveTranslateY(next);
    },
    [collapsedOffset, dismissOffset]
  );

  const endDrag = useCallback(() => {
    const drag = dragState.current;
    if (!drag || liveTranslateY === null) {
      dragState.current = null;
      setIsDragging(false);
      return;
    }

    const pastCollapseBy = liveTranslateY - collapsedOffset; // >0 once at/below the resting point
    let outcome: "expand" | "collapse" | "dismiss";

    if (pastCollapseBy > 0) {
      outcome = drag.velocity > VELOCITY_FLICK_THRESHOLD || pastCollapseBy > DISMISS_DISTANCE_PX ? "dismiss" : "collapse";
    } else if (drag.velocity < -VELOCITY_FLICK_THRESHOLD) {
      outcome = "expand";
    } else if (drag.velocity > VELOCITY_FLICK_THRESHOLD) {
      outcome = "collapse";
    } else {
      outcome = liveTranslateY < collapsedOffset / 2 ? "expand" : "collapse";
    }

    dragState.current = null;
    setIsDragging(false);

    if (outcome === "dismiss") {
      setLiveTranslateY(dismissOffset); // let the transition slide it the rest of the way off-screen
      dismissTimeoutRef.current = window.setTimeout(() => onDismissRef.current(), DISMISS_ANIMATION_MS);
    } else {
      setExpanded(outcome === "expand");
      setLiveTranslateY(null); // hand control back to the expanded/collapsed CSS value
    }
  }, [liveTranslateY, collapsedOffset, dismissOffset]);

  const currentTranslateY = liveTranslateY !== null ? liveTranslateY : expanded ? 0 : collapsedOffset;

  return {
    expanded,
    setExpanded,
    isDragging,
    sheetStyle: {
      transform: `translateY(${currentTranslateY}px)`,
      transition: isDragging ? "none" : SNAP_TRANSITION,
    },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}