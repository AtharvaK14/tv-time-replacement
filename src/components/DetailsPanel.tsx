import { useEffect, useState } from "react";
import { db } from "../db";
import { getTvShowDetails, getMovieDetails, TMDB_IMAGE_BASE } from "../tmdb";
import { getOmdbRatings, hasOmdbKey, type OmdbRatings } from "../omdb";

interface Props {
  kind: "show" | "movie";
  tmdbId: number;
  onClose: () => void;
}

interface CoreDetails {
  name: string;
  posterPath: string | null;
  releaseDate: string | null;
  overview: string | null;
  status?: string; // shows only
}

export default function DetailsPanel({ kind, tmdbId, onClose }: Props) {
  const [details, setDetails] = useState<CoreDetails | null>(null);
  const [ratings, setRatings] = useState<OmdbRatings | null | "loading">("loading");
  const [inLibrary, setInLibrary] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (kind === "show") {
          const d = await getTvShowDetails(tmdbId);
          if (cancelled) return;
          setDetails({
            name: d.name,
            posterPath: d.poster_path,
            releaseDate: d.first_air_date,
            overview: d.overview,
            status: d.status,
          });
          const existing = await db.shows.get(tmdbId);
          setInLibrary(!!existing);
          if (hasOmdbKey()) {
            const r = await getOmdbRatings(d.name, d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null);
            if (!cancelled) setRatings(r);
          } else {
            setRatings(null);
          }
        } else {
          const d = await getMovieDetails(tmdbId);
          if (cancelled) return;
          setDetails({
            name: d.title,
            posterPath: d.poster_path,
            releaseDate: d.release_date,
            overview: d.overview,
          });
          const existing = await db.movies.get(tmdbId);
          setInLibrary(!!existing);
          if (hasOmdbKey()) {
            const r = await getOmdbRatings(d.title, d.release_date ? Number(d.release_date.slice(0, 4)) : null);
            if (!cancelled) setRatings(r);
          } else {
            setRatings(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [kind, tmdbId]);

  async function handleAdd() {
    if (!details) return;
    if (kind === "show") {
      await db.shows.put({
        tmdbId,
        name: details.name,
        posterPath: details.posterPath,
        firstAirYear: details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null,
        status: details.status ?? "",
        addedAt: new Date().toISOString(),
        isFollowed: true,
        isArchived: false,
        lastWatchedAt: null,
      });
    } else {
      await db.movies.put({
        tmdbId,
        title: details.name,
        posterPath: details.posterPath,
        releaseYear: details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null,
        watched: false,
        watchedAt: null,
        wantsToWatch: true,
      });
    }
    setInLibrary(true);
    setAdded(true);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal details-modal" onClick={(e) => e.stopPropagation()}>
        <button className="close-x" onClick={onClose} aria-label="Close">
          &times;
        </button>

        {error && <p className="status-error">{error}</p>}

        {!details && !error && <p className="muted">Loading...</p>}

        {details && (
          <div className="details-layout">
            {details.posterPath ? (
              <img src={`${TMDB_IMAGE_BASE}${details.posterPath}`} alt={details.name} className="details-poster" />
            ) : (
              <div className="poster-placeholder details-poster" />
            )}
            <div className="details-body">
              <h2>{details.name}</h2>
              <p className="muted small">
                {details.releaseDate ? details.releaseDate.slice(0, 4) : "Release date unknown"}
                {details.status ? ` \u00b7 ${details.status}` : ""}
              </p>

              <div className="ratings-row">
                {ratings === "loading" && hasOmdbKey() && <span className="muted small">Loading ratings...</span>}
                {ratings && ratings !== "loading" && (
                  <>
                    {ratings.imdbRating && <span className="rating-pill">IMDb {ratings.imdbRating}</span>}
                    {ratings.rottenTomatoes && <span className="rating-pill">RT {ratings.rottenTomatoes}</span>}
                    {!ratings.imdbRating && !ratings.rottenTomatoes && (
                      <span className="muted small">No ratings found for this title on OMDb.</span>
                    )}
                  </>
                )}
                {!hasOmdbKey() && (
                  <span className="muted small">Add an OMDb key in Settings to see IMDb/RT ratings.</span>
                )}
              </div>

              <p className="overview">
                {details.overview || (ratings !== "loading" && ratings?.plot) || "No summary available."}
              </p>

              {inLibrary ? (
                <p className="status-ok">{added ? "Added to your library." : "Already in your library."}</p>
              ) : (
                <button onClick={handleAdd}>Add to library</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
