import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import DetailsPanel from "../components/DetailsPanel";

export default function Movies() {
  const movies = useLiveQuery(() => db.movies.orderBy("title").toArray(), []);
  const [openDetails, setOpenDetails] = useState<number | null>(null);

  if (!movies) return <p className="muted">Loading...</p>;

  async function toggleWatched(tmdbId: number, currentlyWatched: boolean) {
    await db.movies.update(tmdbId, {
      watched: !currentlyWatched,
      watchedAt: !currentlyWatched ? new Date().toISOString() : null,
    });
  }

  return (
    <div className="panel">
      <h2>Movies</h2>
      {movies.length === 0 && <p className="muted">No movies yet. Import your TV Time export, or add one from Add.</p>}
      <div className="show-grid">
        {movies.map((m) => (
          <div key={m.tmdbId} className="show-card movie-card">
            {m.posterPath ? (
              <img src={`${TMDB_IMAGE_BASE}${m.posterPath}`} alt={m.title} onClick={() => setOpenDetails(m.tmdbId)} />
            ) : (
              <div className="poster-placeholder" onClick={() => setOpenDetails(m.tmdbId)} />
            )}
            <div className="show-card-body">
              <p className="show-name" onClick={() => setOpenDetails(m.tmdbId)}>
                {m.title} {m.releaseYear ? `(${m.releaseYear})` : ""}
              </p>
              <label className="muted small">
                <input type="checkbox" checked={m.watched} onChange={() => toggleWatched(m.tmdbId, m.watched)} />{" "}
                Watched
              </label>
            </div>
          </div>
        ))}
      </div>

      {openDetails !== null && (
        <DetailsPanel kind="movie" tmdbId={openDetails} onClose={() => setOpenDetails(null)} />
      )}
    </div>
  );
}
