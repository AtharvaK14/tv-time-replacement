import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { getTvShowDetails, getMovieDetails } from "../tmdb";
import { averageRuntime } from "../lib/runtime";

function formatMinutes(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export default function Stats() {
  const shows = useLiveQuery(() => db.shows.toArray(), []);
  const movies = useLiveQuery(() => db.movies.toArray(), []);
  const watchedEpisodeCount = useLiveQuery(() => db.watchedEpisodes.count(), []);
  const watchedCountsByShow = useLiveQuery(async () => {
    const all = await db.watchedEpisodes.toArray();
    const counts = new Map<number, number>();
    for (const w of all) counts.set(w.showId, (counts.get(w.showId) ?? 0) + 1);
    return counts;
  }, []);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  // Self-healing backfill: shows/movies added before the runtime fields
  // existed have episodeRuntimeMinutes/runtimeMinutes as undefined. Rather
  // than show an inaccurate total that silently excludes them, fetch the
  // missing runtime once and cache it, so this cost is paid once per title,
  // not every time Stats loads.
  useEffect(() => {
    if (!shows || !movies) return;
    const showsNeeding = shows.filter((s) => s.episodeRuntimeMinutes === undefined);
    const moviesNeeding = movies.filter((m) => m.runtimeMinutes === undefined);
    if (showsNeeding.length === 0 && moviesNeeding.length === 0) return;

    let cancelled = false;
    async function backfill() {
      setBackfilling(true);
      const total = showsNeeding.length + moviesNeeding.length;
      let done = 0;
      setBackfillProgress({ done, total });

      for (const show of showsNeeding) {
        if (cancelled) return;
        try {
          const details = await getTvShowDetails(show.tmdbId);
          await db.shows.update(show.tmdbId, { episodeRuntimeMinutes: averageRuntime(details.episode_run_time) });
        } catch {
          await db.shows.update(show.tmdbId, { episodeRuntimeMinutes: null });
        }
        done++;
        setBackfillProgress({ done, total });
      }
      for (const movie of moviesNeeding) {
        if (cancelled) return;
        try {
          const details = await getMovieDetails(movie.tmdbId);
          await db.movies.update(movie.tmdbId, { runtimeMinutes: details.runtime });
        } catch {
          await db.movies.update(movie.tmdbId, { runtimeMinutes: null });
        }
        done++;
        setBackfillProgress({ done, total });
      }
      if (!cancelled) {
        setBackfilling(false);
        setBackfillProgress(null);
      }
    }
    backfill();
    return () => {
      cancelled = true;
    };
  }, [shows, movies]);

  if (!shows || !movies || watchedEpisodeCount === undefined || !watchedCountsByShow) {
    return <p className="muted">Loading...</p>;
  }

  const totalTvMinutes = shows.reduce((sum, s) => {
    const runtime = s.episodeRuntimeMinutes ?? 0;
    const watched = watchedCountsByShow.get(s.tmdbId) ?? 0;
    return sum + runtime * watched;
  }, 0);

  const watchedMovies = movies.filter((m) => m.watched);
  const totalMovieMinutes = watchedMovies.reduce((sum, m) => sum + (m.runtimeMinutes ?? 0), 0);

  return (
    <div className="panel">
      <h2>Stats</h2>

      {backfilling && backfillProgress && (
        <p className="muted small">
          Fetching runtime data for titles added before this feature existed: {backfillProgress.done} /{" "}
          {backfillProgress.total}
        </p>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{formatMinutes(totalTvMinutes)}</div>
          <div className="stat-label">TV time</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{watchedEpisodeCount.toLocaleString()}</div>
          <div className="stat-label">Episodes watched</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatMinutes(totalMovieMinutes)}</div>
          <div className="stat-label">Movie time</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{watchedMovies.length.toLocaleString()}</div>
          <div className="stat-label">Movies watched</div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 8 }}>
        TV time is an estimate: watched episode count per show times TMDB's average episode runtime for that show,
        not the actual runtime of each individual episode watched (TMDB doesn't expose that in bulk without a call
        per episode). Movie time uses each movie's actual runtime.
      </p>
    </div>
  );
}
