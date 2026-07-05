import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { getTvShowDetails, getMovieDetails } from "../tmdb";
import { averageRuntime } from "./runtime";

export interface DurationParts {
  months: number;
  days: number;
  hours: number;
}

export function toDurationParts(totalMinutes: number): DurationParts {
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (24 * 30));
  const days = Math.floor((totalHours % (24 * 30)) / 24);
  const hours = totalHours % 24;
  return { months, days, hours };
}

/** TV time and episode count, rewatch-aware (uses watchCount, not just presence of a row). */
export function useShowStats() {
  const shows = useLiveQuery(() => db.shows.toArray(), []);
  const watched = useLiveQuery(() => db.watchedEpisodes.toArray(), []);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!shows) return;
    const needing = shows.filter((s) => s.episodeRuntimeMinutes === undefined);
    if (needing.length === 0) return;
    let cancelled = false;
    async function backfill() {
      setBackfilling(true);
      let done = 0;
      setBackfillProgress({ done, total: needing.length });
      for (const show of needing) {
        if (cancelled) return;
        try {
          const details = await getTvShowDetails(show.tmdbId);
          await db.shows.update(show.tmdbId, {
            episodeRuntimeMinutes: averageRuntime(details.episode_run_time),
            genreIds: show.genreIds ?? details.genres.map((g) => g.id),
            imdbId: show.imdbId ?? details.external_ids?.imdb_id ?? null,
          });
        } catch {
          await db.shows.update(show.tmdbId, { episodeRuntimeMinutes: null });
        }
        done++;
        setBackfillProgress({ done, total: needing.length });
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
  }, [shows]);

  if (!shows || !watched) {
    return {
      loading: true as const,
      backfilling,
      backfillProgress,
      totalMinutes: 0,
      episodeWatchEvents: 0,
      distinctEpisodesWatched: 0,
    };
  }

  const runtimeByShow = new Map(shows.map((s) => [s.tmdbId, s.episodeRuntimeMinutes ?? 0]));
  // watchCount undefined means this row predates the rewatch-count fix, not
  // zero, assume 1 watch rather than silently excluding it from the total.
  let totalMinutes = 0;
  let episodeWatchEvents = 0;
  for (const w of watched) {
    const count = w.watchCount ?? 1;
    totalMinutes += (runtimeByShow.get(w.showId) ?? 0) * count;
    episodeWatchEvents += count;
  }

  return {
    loading: false as const,
    backfilling,
    backfillProgress,
    totalMinutes,
    episodeWatchEvents,
    distinctEpisodesWatched: watched.length,
  };
}

/** Movie time and count, rewatch-aware (uses rewatchCount). */
export function useMovieStats() {
  const movies = useLiveQuery(() => db.movies.toArray(), []);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!movies) return;
    const needing = movies.filter((m) => m.runtimeMinutes === undefined);
    if (needing.length === 0) return;
    let cancelled = false;
    async function backfill() {
      setBackfilling(true);
      let done = 0;
      setBackfillProgress({ done, total: needing.length });
      for (const movie of needing) {
        if (cancelled) return;
        try {
          const details = await getMovieDetails(movie.tmdbId);
          await db.movies.update(movie.tmdbId, {
            runtimeMinutes: details.runtime,
            genreIds: movie.genreIds ?? details.genres.map((g) => g.id),
            imdbId: movie.imdbId ?? details.external_ids?.imdb_id ?? null,
          });
        } catch {
          await db.movies.update(movie.tmdbId, { runtimeMinutes: null });
        }
        done++;
        setBackfillProgress({ done, total: needing.length });
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
  }, [movies]);

  if (!movies) {
    return { loading: true as const, backfilling, backfillProgress, totalMinutes: 0, moviesWatched: 0 };
  }

  const watchedMovies = movies.filter((m) => m.watched);
  const totalMinutes = watchedMovies.reduce((sum, m) => {
    const watches = 1 + (m.rewatchCount ?? 0);
    return sum + (m.runtimeMinutes ?? 0) * watches;
  }, 0);

  return { loading: false as const, backfilling, backfillProgress, totalMinutes, moviesWatched: watchedMovies.length };
}
