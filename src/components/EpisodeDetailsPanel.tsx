import { useEffect, useState } from "react";
import type { Episode } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import { getOmdbEpisodeRating, hasOmdbKey, type OmdbEpisodeRating } from "../omdb";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";

interface Props {
  show: { name: string; imdbId?: string | null };
  episode: Episode;
  watched: boolean;
  canToggleWatched?: boolean;
  onToggleWatched: () => void;
  onClose: () => void;
}

export default function EpisodeDetailsPanel({ show, episode, watched, canToggleWatched = true, onToggleWatched, onClose }: Props) {
  // Same reference-counted lock DetailsPanel uses. This panel is often
  // opened FROM WITHIN an already-open DetailsPanel (both call this hook),
  // the ref-counting in useLockBodyScroll ensures closing this one doesn't
  // prematurely unlock scroll while the parent panel is still open.
  useLockBodyScroll();

  const [rating, setRating] = useState<OmdbEpisodeRating | null | "loading">("loading");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasOmdbKey()) {
        setRating(null);
        return;
      }
      setRating("loading");
      const r = await getOmdbEpisodeRating({ title: show.name, imdbId: show.imdbId }, episode.seasonNumber, episode.episodeNumber);
      if (!cancelled) setRating(r);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [show, episode.seasonNumber, episode.episodeNumber]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal details-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <div className="details-layout">
          {episode.stillPath ? (
            <img
              src={`${TMDB_IMAGE_BASE}${episode.stillPath}`}
              alt={episode.name}
              className="details-poster episode-still"
            />
          ) : (
            <div className="poster-placeholder details-poster episode-still" />
          )}
          <div className="details-body">
            <p className="muted small">
              {show.name} &middot; Season {episode.seasonNumber}, Episode {episode.episodeNumber}
            </p>
            <h2>{episode.name}</h2>
            <p className="muted small">{episode.airDate || "Air date unknown"}</p>

            <div className="ratings-row">
              <span className="rating-pill">TMDB {episode.tmdbRating.toFixed(1)}</span>
              {rating === "loading" && hasOmdbKey() && <span className="muted small">Loading IMDb rating...</span>}
              {rating && rating !== "loading" && rating.imdbRating && (
                <span className="rating-pill">IMDb {rating.imdbRating}</span>
              )}
              {rating && rating !== "loading" && !rating.imdbRating && (
                <span className="muted small">
                  {rating.error ? `OMDb: ${rating.error}` : "No IMDb rating found for this episode."}
                </span>
              )}
              {!hasOmdbKey() && <span className="muted small">Add an OMDb key in Settings to see IMDb ratings.</span>}
            </div>

            <p className="overview">
              {episode.overview || (rating !== "loading" && rating?.plot) || "No summary available."}
            </p>

            {/* Deliberately a plain button, not a <label> wrapping anything else, this exact
                pattern (a checkbox/label sharing space with a clickable sibling) was the root
                cause of a real bug where opening episode details also silently toggled its
                watched state. Keeping these fully separate interactive elements on purpose. */}
            {canToggleWatched && (
              <button onClick={onToggleWatched}>{watched ? "Mark unwatched" : "Mark watched"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
