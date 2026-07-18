import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { TMDB_IMAGE_BASE, getMovieGenres, type Genre } from "../tmdb";
import { useMovieStats, toDurationParts } from "../lib/stats";
import DetailsPanel from "../components/DetailsPanel";

type SortKey = "title" | "releaseYear" | "recentlyWatched" | "rating";
type FilterKey = "all" | "watched" | "wantToWatch";

export default function Movies() {
  const movies = useLiveQuery(() => db.movies.toArray(), []);
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [genreFilter, setGenreFilter] = useState<number | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);

  const stats = useMovieStats();

  useEffect(() => {
    getMovieGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  const visible = useMemo(() => {
    if (!movies) return [];
    let list = movies;

    if (filterKey === "watched") list = list.filter((m) => m.watched);
    if (filterKey === "wantToWatch") list = list.filter((m) => !m.watched && m.wantsToWatch);
    if (genreFilter !== null) list = list.filter((m) => m.genreIds?.includes(genreFilter));

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }

    const sorted = [...list];
    switch (sortKey) {
      case "title":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "releaseYear":
        sorted.sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
        break;
      case "recentlyWatched":
        sorted.sort((a, b) => (b.watchedAt ?? "").localeCompare(a.watchedAt ?? ""));
        break;
      case "rating":
        // No per-title rating cached locally (ratings come from OMDb live,
        // not stored), so this falls back to title order. Noted rather than
        // silently pretending to sort by something it can't.
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }
    return sorted;
  }, [movies, query, sortKey, filterKey, genreFilter]);

  if (!movies) return <p className="muted">Loading...</p>;

  async function toggleWatched(tmdbId: number, currentlyWatched: boolean) {
    await db.movies.update(tmdbId, {
      watched: !currentlyWatched,
      watchedAt: !currentlyWatched ? new Date().toISOString() : null,
    });
  }

  const duration = toDurationParts(stats.totalMinutes);

  return (
    <div className="panel">
      <h2>Movies</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">
            {duration.months}<span className="stat-unit">mo</span> {duration.days}
            <span className="stat-unit">d</span> {duration.hours}
            <span className="stat-unit">h</span>
          </div>
          <div className="stat-label">Movie time</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.loading ? "..." : stats.moviesWatched.toLocaleString()}</div>
          <div className="stat-label">Movies watched</div>
        </div>
      </div>
      {stats.backfilling && stats.backfillProgress && (
        <p className="muted small">
          Fetching runtime data for movies added before this feature existed: {stats.backfillProgress.done} /{" "}
          {stats.backfillProgress.total}
        </p>
      )}

      {movies.length === 0 ? (
        <p className="muted">No movies yet. Import your TV Time export, or add one below.</p>
      ) : (
        <>
          <div className="field-row filters-row">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your movies..."
            />
            <select value={filterKey} onChange={(e) => setFilterKey(e.target.value as FilterKey)}>
              <option value="all">All</option>
              <option value="watched">Watched</option>
              <option value="wantToWatch">Want to watch</option>
            </select>
            <select
              value={genreFilter ?? ""}
              onChange={(e) => setGenreFilter(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All genres</option>
              {genres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              <option value="title">Title (A-Z)</option>
              <option value="releaseYear">Release year</option>
              <option value="recentlyWatched">Recently watched</option>
            </select>
          </div>

          {visible.length === 0 && <p className="muted">No movies match that search/filter.</p>}

          <div className="show-grid">
            {visible.map((m) => (
              <div key={m.tmdbId} className="show-card movie-card">
                {m.posterPath ? (
                  <img
                    src={`${TMDB_IMAGE_BASE}${m.posterPath}`}
                    alt={m.title}
                    onClick={() => setOpenDetails(m.tmdbId)}
                  />
                ) : (
                  <div className="poster-placeholder" onClick={() => setOpenDetails(m.tmdbId)} />
                )}
                <div className="show-card-body">
                  <p className="show-name" onClick={() => setOpenDetails(m.tmdbId)}>
                    {m.title} {m.releaseYear ? `(${m.releaseYear})` : ""}
                  </p>
                </div>
                <button
                  className={`watched-pill ${m.watched ? "on" : ""}`}
                  onClick={() => toggleWatched(m.tmdbId, m.watched)}
                >
                  {m.watched ? "Watched" : "Mark watched"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {openDetails !== null && <DetailsPanel kind="movie" tmdbId={openDetails} onClose={() => setOpenDetails(null)} />}
    </div>
  );
}
