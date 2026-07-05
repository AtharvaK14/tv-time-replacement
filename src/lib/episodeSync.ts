import { db, episodeKey, type Episode } from "../db";
import { getTvShowDetails, getSeasonDetails } from "../tmdb";

function toEpisodeRecords(
  tmdbId: number,
  seasonNumber: number,
  episodes: {
    episode_number: number;
    name: string;
    overview: string | null;
    air_date: string | null;
    vote_average: number;
    still_path: string | null;
  }[]
): Episode[] {
  return episodes.map((ep) => ({
    key: episodeKey(tmdbId, seasonNumber, ep.episode_number),
    showId: tmdbId,
    seasonNumber,
    episodeNumber: ep.episode_number,
    name: ep.name,
    overview: ep.overview,
    airDate: ep.air_date,
    tmdbRating: ep.vote_average,
    stillPath: ep.still_path,
  }));
}

/**
 * Makes sure every season's episode list for a show is cached locally.
 * Skips seasons we already have, so repeated calls are cheap. Used by Home,
 * which needs to know the "next unwatched episode" across every followed
 * show without the user having opened each show page first.
 */
export async function ensureEpisodesCached(tmdbId: number): Promise<number[]> {
  const details = await getTvShowDetails(tmdbId);
  const seasonNumbers = details.seasons.map((s) => s.season_number).filter((n) => n > 0);

  const existing = await db.episodes.where("showId").equals(tmdbId).toArray();
  const haveSeasons = new Set(existing.map((e) => e.seasonNumber));
  const missing = seasonNumbers.filter((s) => !haveSeasons.has(s));

  for (const seasonNumber of missing) {
    const season = await getSeasonDetails(tmdbId, seasonNumber);
    await db.episodes.bulkPut(toEpisodeRecords(tmdbId, seasonNumber, season.episodes));
  }

  return seasonNumbers;
}

/**
 * Fetches just the season list (numbers only, cheap) without pulling every
 * season's full episode list. Used by ShowDetail's accordion, which fetches
 * a season's episodes only when the user actually expands it.
 */
export async function getSeasonNumbers(tmdbId: number): Promise<number[]> {
  const details = await getTvShowDetails(tmdbId);
  return details.seasons.map((s) => s.season_number).filter((n) => n > 0);
}

/** Fetches and caches one season's episodes, only if not already cached. */
export async function ensureSeasonCached(tmdbId: number, seasonNumber: number): Promise<void> {
  const existing = await db.episodes.where("[showId+seasonNumber]").equals([tmdbId, seasonNumber]).count();
  if (existing > 0) return;
  const season = await getSeasonDetails(tmdbId, seasonNumber);
  await db.episodes.bulkPut(toEpisodeRecords(tmdbId, seasonNumber, season.episodes));
}

/** The next aired, unwatched episode for a show, in season/episode order. Null if none (up to date, or nothing cached yet). */
export function findNextUnwatched(episodes: Episode[], watchedKeys: Set<string>): Episode | null {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  for (const ep of sorted) {
    const aired = ep.airDate ? ep.airDate <= today : false;
    if (aired && !watchedKeys.has(ep.key)) return ep;
  }
  return null;
}
