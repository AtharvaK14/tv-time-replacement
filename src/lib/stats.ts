import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { getTvShowDetails, getMovieDetails } from "../tmdb";
import { averageRuntime } from "./runtime";
import { totalEpisodeCount } from "./episodeSync";

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

// Movies almost always have a real TMDB runtime, but for the rare title
// that doesn't, use the same "don't silently contribute zero forever"
// principle as the show-level fallback. ~110 min is a reasonable general
// movie-length estimate, a judgment call like the show fallback above,
// not a TMDB-confirmed number.
const FALLBACK_MOVIE_RUNTIME_MINUTES = 110;

/** TV time and episode count, rewatch-aware (uses watchCount, not just presence of a row). */
export function useShowStats() {
  const shows = useLiveQuery(() => db.shows.toArray(), []);
  const watched = useLiveQuery(() => db.watchedEpisodes.toArray(), []);
  const episodesWithRuntime = useLiveQuery(
    () => db.episodes.toArray().then((eps) => eps.filter((e) => e.runtimeMinutes != null)),
    []
  );
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!shows) return;
    // == null catches BOTH undefined (never attempted) and null (a past
    // fetch attempt that failed, e.g. a network error). The old version
    // only checked undefined, so a failed attempt got stuck at null
    // forever with no retry, contributing zero permanently. That was a
    // real bug, not just a missing-data limitation.
    // Also catches numberOfEpisodes == null on its own: a show backfilled
    // for episodeRuntimeMinutes under an older schema version wouldn't be
    // picked up again by the runtime check alone once that field is set,
    // and would otherwise sit with no episode total (and no progress bar
    // on the Shows grid) permanently.
    const needing = shows.filter((s) => s.episodeRuntimeMinutes == null || s.numberOfEpisodes == null);
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
            numberOfEpisodes: totalEpisodeCount(details.seasons),
            genreIds: show.genreIds ?? details.genres.map((g) => g.id),
            imdbId: show.imdbId ?? details.external_ids?.imdb_id ?? null,
          });
        } catch {
          // Genuine fetch/network error, leave as null so it's retried
          // next time (unlike "TMDB responded with no data", which
          // averageRuntime already resolves to the fallback, never null).
          await db.shows.update(show.tmdbId, { episodeRuntimeMinutes: null, numberOfEpisodes: null });
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

  if (!shows || !watched || !episodesWithRuntime) {
    return {
      loading: true as const,
      backfilling,
      backfillProgress,
      totalMinutes: 0,
      episodeWatchEvents: 0,
      distinctEpisodesWatched: 0,
      exactRuntimeCount: 0,
    };
  }

  const runtimeByShow = new Map(shows.map((s) => [s.tmdbId, s.episodeRuntimeMinutes ?? 0]));
  // Real per-episode runtime (from TVmaze) when we have it, keyed the same
  // way as WatchedEpisode. Falls back to the show-level average otherwise,
  // since TMDB/TVDB don't reliably expose per-episode runtime at all.
  const episodeRuntimeByKey = new Map(episodesWithRuntime.map((e) => [e.key, e.runtimeMinutes as number]));

  let totalMinutes = 0;
  let episodeWatchEvents = 0;
  let exactRuntimeCount = 0;
  for (const w of watched) {
    const count = w.watchCount ?? 1;
    const exact = episodeRuntimeByKey.get(w.key);
    const perEpisodeMinutes = exact ?? runtimeByShow.get(w.showId) ?? 0;
    if (exact != null) exactRuntimeCount++;
    totalMinutes += perEpisodeMinutes * count;
    episodeWatchEvents += count;
  }

  return {
    loading: false as const,
    backfilling,
    backfillProgress,
    totalMinutes,
    episodeWatchEvents,
    distinctEpisodesWatched: watched.length,
    exactRuntimeCount,
  };
}

/** Movie time and count, rewatch-aware (uses rewatchCount). */
export function useMovieStats() {
  const movies = useLiveQuery(() => db.movies.toArray(), []);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!movies) return;
    const needing = movies.filter((m) => m.runtimeMinutes == null || m.releaseDate == null);
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
            runtimeMinutes: details.runtime ?? FALLBACK_MOVIE_RUNTIME_MINUTES,
            releaseDate: details.release_date,
            genreIds: movie.genreIds ?? details.genres.map((g) => g.id),
            imdbId: movie.imdbId ?? details.external_ids?.imdb_id ?? null,
          });
        } catch {
          await db.movies.update(movie.tmdbId, { runtimeMinutes: null, releaseDate: null });
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
