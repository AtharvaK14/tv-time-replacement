import { db, episodeKey, type Show, type WatchedEpisode, type Movie } from "../db";
import { getTvShowDetails, getMovieDetails } from "../tmdb";
import {
  parseWatchedMovies,
  parseWantToWatchMovies,
  parseEpisodeEvents,
  parseShowFollowStatus,
  groupEpisodeEventsByShow,
  groupMoviesByTitle,
} from "./parseTvTimeCsv";
import { resolveShowTitle, resolveMovieTitle, type ResolveAmbiguous } from "./matcher";

export interface ImportProgress {
  phase: "shows" | "movies" | "done";
  current: number;
  total: number;
  currentTitle: string;
}

export interface ImportResult {
  showsMatched: number;
  showsSkipped: string[];
  moviesMatched: number;
  moviesSkipped: string[];
  episodesImported: number;
}

/**
 * opts.recordsCsvText  = tracking-prod-records.csv    (movies live here)
 * opts.recordsV2CsvText = tracking-prod-records-v2.csv (episode history lives here)
 * Both optional independently.
 */
export async function runImport(
  opts: { recordsCsvText?: string; recordsV2CsvText?: string },
  resolveAmbiguous: ResolveAmbiguous,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const result: ImportResult = {
    showsMatched: 0,
    showsSkipped: [],
    moviesMatched: 0,
    moviesSkipped: [],
    episodesImported: 0,
  };

  // ---- Episodes + follow status, both from tracking-prod-records-v2.csv ----
  if (opts.recordsV2CsvText) {
    const followRows = parseShowFollowStatus(opts.recordsV2CsvText);
    const followByName = new Map(followRows.map((r) => [r.series_name.trim(), r]));

    const eventRows = parseEpisodeEvents(opts.recordsV2CsvText);
    const byShow = groupEpisodeEventsByShow(eventRows);
    const titles = [...byShow.keys()];

    for (let i = 0; i < titles.length; i++) {
      const rawTitle = titles[i];
      onProgress?.({ phase: "shows", current: i + 1, total: titles.length, currentTitle: rawTitle });

      const tmdbId = await resolveShowTitle(rawTitle, resolveAmbiguous);
      if (tmdbId === null) {
        result.showsSkipped.push(rawTitle);
        continue;
      }

      // Dedupe events to one record per (season, episode), earliest created_at wins.
      const episodeRows = byShow.get(rawTitle)!;
      const bySeasonEpisode = new Map<string, (typeof episodeRows)[number]>();
      for (const row of episodeRows) {
        const k = `${row.season_number}-${row.episode_number}`;
        const existing = bySeasonEpisode.get(k);
        if (!existing || (row.created_at && row.created_at < existing.created_at)) {
          bySeasonEpisode.set(k, row);
        }
      }
      const dedupedRows = [...bySeasonEpisode.values()];
      const lastWatchedAt = episodeRows.reduce<string | null>(
        (max, r) => (!max || r.created_at > max ? r.created_at : max),
        null
      );

      const follow = followByName.get(rawTitle);

      const existingShow = await db.shows.get(tmdbId);
      if (!existingShow) {
        const details = await getTvShowDetails(tmdbId);
        const show: Show = {
          tmdbId: details.id,
          name: details.name,
          posterPath: details.poster_path,
          firstAirYear: details.first_air_date ? Number(details.first_air_date.slice(0, 4)) : null,
          status: details.status,
          addedAt: new Date().toISOString(),
          isFollowed: follow ? follow.is_followed === "true" : true,
          isArchived: follow ? follow.is_archived === "true" : false,
          lastWatchedAt,
        };
        await db.shows.put(show);
      } else {
        // Show already exists locally (e.g. re-running import): refresh
        // follow/archive/recency fields, don't touch cached poster/status.
        await db.shows.update(tmdbId, {
          isFollowed: follow ? follow.is_followed === "true" : existingShow.isFollowed,
          isArchived: follow ? follow.is_archived === "true" : existingShow.isArchived,
          lastWatchedAt:
            !existingShow.lastWatchedAt || (lastWatchedAt && lastWatchedAt > existingShow.lastWatchedAt)
              ? lastWatchedAt
              : existingShow.lastWatchedAt,
        });
      }

      const watchedRecords: WatchedEpisode[] = dedupedRows.map((row) => {
        const season = Number(row.season_number);
        const episode = Number(row.episode_number);
        return {
          key: episodeKey(tmdbId, season, episode),
          showId: tmdbId,
          seasonNumber: season,
          episodeNumber: episode,
          watchedAt: row.created_at || new Date().toISOString(),
        };
      });
      await db.watchedEpisodes.bulkPut(watchedRecords);
      result.episodesImported += watchedRecords.length;
      result.showsMatched++;
    }
  }

  // ---- Movies, from tracking-prod-records.csv -----------------------------
  if (opts.recordsCsvText) {
    const watchedRows = parseWatchedMovies(opts.recordsCsvText);
    const wantRows = parseWantToWatchMovies(opts.recordsCsvText);
    const byMovieWatched = groupMoviesByTitle(watchedRows);
    const wantedTitles = new Set(wantRows.map((r) => r.movie_name.trim()));

    // Union of watched + want-to-watch titles, so a movie on your watchlist
    // but not yet watched still gets added (as wantsToWatch, watched=false).
    const allTitles = new Set([...byMovieWatched.keys(), ...wantedTitles]);
    const titles = [...allTitles];

    for (let i = 0; i < titles.length; i++) {
      const rawTitle = titles[i];
      onProgress?.({ phase: "movies", current: i + 1, total: titles.length, currentTitle: rawTitle });

      const tmdbId = await resolveMovieTitle(rawTitle, resolveAmbiguous);
      if (tmdbId === null) {
        result.moviesSkipped.push(rawTitle);
        continue;
      }

      const details = await getMovieDetails(tmdbId);
      const watchedRow = byMovieWatched.get(rawTitle);
      const movie: Movie = {
        tmdbId: details.id,
        title: details.title,
        posterPath: details.poster_path,
        releaseYear: details.release_date ? Number(details.release_date.slice(0, 4)) : null,
        watched: !!watchedRow,
        watchedAt: watchedRow?.created_at ?? null,
        wantsToWatch: wantedTitles.has(rawTitle),
      };
      await db.movies.put(movie);
      result.moviesMatched++;
    }
  }

  onProgress?.({ phase: "done", current: 1, total: 1, currentTitle: "" });
  return result;
}
