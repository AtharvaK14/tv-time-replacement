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

// A fast flick snaps to the direction of the flick even if the release
// position is closer to the OTHER snap point, matching native bottom-sheet
// feel (e.g. iOS). Units: px per ms. Judgment call, not a platform constant.
const VELOCITY_FLICK_THRESHOLD = 0.5;

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
 * Drives a bottom-sheet-style panel with exactly two snap points: a default
 * "collapsed" position and an "expanded" position near the top of the
 * screen. Deliberately not drag-to-dismiss, dragging down only ever
 * returns to the collapsed position, never closes the panel, that wasn't
 * asked for and silently adding it would risk an accidental close gesture.
 *
 * Uses Pointer Events (not separate touch/mouse handlers) so the same code
 * path handles mouse, touch, and pen. The consumer spreads `handleProps`
 * onto a dedicated drag-handle element only, not the whole panel, so
 * normal scrolling/clicking elsewhere in the panel is unaffected.
 */
export function useDraggableSheet(): DraggableSheetHandle {
  const [expanded, setExpanded] = useState(false);
  const [collapsedOffset, setCollapsedOffset] = useState(0);
  const [liveTranslateY, setLiveTranslateY] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<DragState | null>(null);

  useEffect(() => {
    function computeAndSetOffset() {
      const fullSheetHeight = window.innerHeight - SHEET_TOP_GAP_PX;
      const visibleWhenCollapsed = window.innerHeight * COLLAPSED_VISIBLE_FRACTION;
      setCollapsedOffset(Math.max(0, fullSheetHeight - visibleWhenCollapsed));
    }
    computeAndSetOffset();
    window.addEventListener("resize", computeAndSetOffset);
    return () => window.removeEventListener("resize", computeAndSetOffset);
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
      const next = Math.min(collapsedOffset, Math.max(0, drag.startTranslateY + deltaY));
      const dt = e.timeStamp - drag.lastTimestamp;
      if (dt > 0) {
        drag.velocity = (e.clientY - drag.lastClientY) / dt;
      }
      drag.lastClientY = e.clientY;
      drag.lastTimestamp = e.timeStamp;
      setLiveTranslateY(next);
    },
    [collapsedOffset]
  );

  const endDrag = useCallback(() => {
    const drag = dragState.current;
    if (!drag || liveTranslateY === null) {
      dragState.current = null;
      setIsDragging(false);
      return;
    }
    let shouldExpand: boolean;
    if (drag.velocity < -VELOCITY_FLICK_THRESHOLD) {
      shouldExpand = true; // fast upward flick
    } else if (drag.velocity > VELOCITY_FLICK_THRESHOLD) {
      shouldExpand = false; // fast downward flick
    } else {
      shouldExpand = liveTranslateY < collapsedOffset / 2; // nearest snap point
    }
    dragState.current = null;
    setIsDragging(false);
    setExpanded(shouldExpand);
    setLiveTranslateY(null); // hand control back to the expanded/collapsed CSS value
  }, [liveTranslateY, collapsedOffset]);

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
