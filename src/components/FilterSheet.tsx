import { useEffect, type ReactNode } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";

interface Props {
  resultCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Wraps the filter <select> controls shared by Library.tsx and Movies.tsx.
 * Desktop: transparent passthrough, renders children exactly where they
 * were before, no behavior change at all.
 * Mobile: replaces the old pattern of three <select> elements shrunk to
 * share one row (a real usability problem: small touch targets, hard to
 * scan) with a single "Filters" trigger that opens a bottom sheet
 * containing the same, unmodified select elements, now full-width and
 * easy to tap.
 */
export default function FilterSheet({ resultCount, open, onOpenChange, children }: Props) {
  const isMobile = useIsMobile();

  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <>
      <button type="button" className="filter-sheet-trigger" onClick={() => onOpenChange(true)}>
        <span className="filter-sheet-trigger-dot" />
        Filters
      </button>
      {open && (
        <FilterSheetOverlay resultCount={resultCount} onClose={() => onOpenChange(false)}>
          {children}
        </FilterSheetOverlay>
      )}
    </>
  );
}

function FilterSheetOverlay({
  resultCount,
  onClose,
  children,
}: {
  resultCount: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useLockBodyScroll();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="filter-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="filter-sheet-handle">
          <div className="sheet-drag-handle-bar" />
        </div>
        <div className="filter-sheet-body">{children}</div>
        <button type="button" className="filter-sheet-apply" onClick={onClose}>
          Show {resultCount} result{resultCount === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
