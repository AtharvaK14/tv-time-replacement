import { useEffect, useState } from "react";
import type { Episode } from "../db";
import { getOmdbEpisodeRating, hasOmdbKey, type OmdbEpisodeRating } from "../omdb";

interface Props {
  showName: string;
  episode: Episode;
  watched: boolean;
  onToggleWatched: () => void;
  onClose: () => void;
}

export default function EpisodeDetailsPanel({ showName, episode, watched, onToggleWatched, onClose }: Props) {
  const [rating, setRating] = useState<OmdbEpisodeRating | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasOmdbKey()) {
        setRating(null);
        return;
      }
      setRating("loading");
      const r = await getOmdbEpisodeRating(showName, episode.seasonNumber, episode.episodeNumber);
      if (!cancelled) setRating(r);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [showName, episode.seasonNumber, episode.episodeNumber]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal details-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <p className="muted small">
          {showName} &middot; Season {episode.seasonNumber}, Episode {episode.episodeNumber}
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
            <span className="muted small">No IMDb rating found for this episode.</span>
          )}
          {!hasOmdbKey() && <span className="muted small">Add an OMDb key in Settings to see IMDb ratings.</span>}
        </div>

        <p className="overview">
          {episode.overview || (rating !== "loading" && rating?.plot) || "No summary available."}
        </p>

        <label className="muted small">
          <input type="checkbox" checked={watched} onChange={onToggleWatched} /> Watched
        </label>
      </div>
    </div>
  );
}
