import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import DetailsPanel from "../components/DetailsPanel";

export default function Library({ onOpenShow }: { onOpenShow: (tmdbId: number) => void }) {
  const shows = useLiveQuery(() => db.shows.orderBy("name").toArray(), []);
  const watchedCounts = useLiveQuery(async () => {
    const all = await db.watchedEpisodes.toArray();
    const counts = new Map<number, number>();
    for (const w of all) counts.set(w.showId, (counts.get(w.showId) ?? 0) + 1);
    return counts;
  }, []);
  const [openDetails, setOpenDetails] = useState<number | null>(null);

  if (!shows) return <p className="muted">Loading...</p>;

  if (shows.length === 0) {
    return (
      <div className="panel">
        <h2>Shows</h2>
        <p className="muted">No shows yet. Import your TV Time export, or search TMDB from Add.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Shows</h2>
      <div className="show-grid">
        {shows.map((show) => (
          <div key={show.tmdbId} className="show-card">
            <div className="poster-wrap" onClick={() => onOpenShow(show.tmdbId)}>
              {show.posterPath ? (
                <img src={`${TMDB_IMAGE_BASE}${show.posterPath}`} alt={show.name} />
              ) : (
                <div className="poster-placeholder" />
              )}
              <button
                className="info-badge"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenDetails(show.tmdbId);
                }}
                aria-label="Show details"
              >
                i
              </button>
            </div>
            <div className="show-card-body" onClick={() => onOpenShow(show.tmdbId)}>
              <p className="show-name">{show.name}</p>
              <p className="muted small">{watchedCounts?.get(show.tmdbId) ?? 0} episodes watched</p>
              {show.isArchived && <p className="muted small">Stopped</p>}
            </div>
          </div>
        ))}
      </div>

      {openDetails !== null && <DetailsPanel kind="show" tmdbId={openDetails} onClose={() => setOpenDetails(null)} />}
    </div>
  );
}
