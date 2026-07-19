import { db, episodeKey, type Episode } from "../db";
import { getTvShowDetails, getSeasonDetails, type TvShowDetails } from "../tmdb";
import { getTvmazeRuntimesByTvdbId } from "../tvmaze";

/**
 * Sum of episode_count across real seasons (season_number > 0, excluding
 * specials), matching the same filter already used everywhere else in this
 * file for season numbers. Used to populate Show.numberOfEpisodes, which
 * powers the watched/total progress bar on the Shows grid, added at every
 * write site (DetailsPanel's handleAdd, both importers, and the stats.ts
 * backfill) since existing shows predate this field.
 */
export function totalEpisodeCount(seasons: TvShowDetails["seasons"]): number {
  return seasons.filter((s) => s.season_number > 0).reduce((sum, s) => sum + s.episode_count, 0);
}

// In-memory cache of TVmaze runtime lookups, keyed by tmdbId, for this
// browser session only (not persisted, cheap to re-derive, and TVmaze data
// doesn't change often enough to justify Dexie persistence complexity).
// Avoids re-fetching TVmaze once per season for the same show.
const tvmazeRuntimeCache = new Map<number, Promise<Map<string, number>>>();

async function getTvmazeRuntimesForShow(tmdbId: number): Promise<Map<string, number>> {
  const cached = tvmazeRuntimeCache.get(tmdbId);
  if (cached) return cached;

  const promise = (async () => {
    const show = await db.shows.get(tmdbId);
    if (!show?.tvdbId) return new Map<string, number>();
    return getTvmazeRuntimesByTvdbId(show.tvdbId);
  })();
  tvmazeRuntimeCache.set(tmdbId, promise);
  return promise;
}

async function toEpisodeRecords(
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
): Promise<Episode[]> {
  const tvmazeRuntimes = await getTvmazeRuntimesForShow(tmdbId);
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
    runtimeMinutes: tvmazeRuntimes.get(`${seasonNumber}-${ep.episode_number}`) ?? null,
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
    const records = await toEpisodeRecords(tmdbId, seasonNumber, season.episodes);
    await db.episodes.bulkPut(records);
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
  const records = await toEpisodeRecords(tmdbId, seasonNumber, season.episodes);
  await db.episodes.bulkPut(records);
}

/**
 * An episode counts as available to watch unless TMDB gives a CONFIRMED
 * future air date. A missing air date is treated as available, not
 * excluded, missing data means TMDB doesn't have the date populated yet,
 * it is not confirmation the episode hasn't aired. Treating missing as
 * "not aired" was the actual bug behind Watch Next silently hiding
 * episodes that were correctly marked unwatched but had incomplete TMDB
 * date data, confirmed via Diagnostics against a real show (Spider-Noir).
 */
function isAvailableToWatch(airDate: string | null, today: string): boolean {
  if (!airDate) return true;
  return airDate <= today;
}

/** The next available, unwatched episode for a show, in season/episode order. Null if none (up to date, or nothing cached yet). */
export function findNextUnwatched(episodes: Episode[], watchedKeys: Set<string>): Episode | null {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  for (const ep of sorted) {
    if (isAvailableToWatch(ep.airDate, today) && !watchedKeys.has(ep.key)) return ep;
  }
  return null;
}

/**
 * How many available-but-unwatched episodes exist beyond the immediate next
 * one, for the "+N" badge TV Time shows (e.g. "S01|E04 +4"). Returns 0 if
 * the next episode is the only one waiting.
 */
export function countAdditionalUnwatched(episodes: Episode[], watchedKeys: Set<string>): number {
  const today = new Date().toISOString().slice(0, 10);
  const unwatchedAvailable = episodes.filter((ep) => isAvailableToWatch(ep.airDate, today) && !watchedKeys.has(ep.key));
  return Math.max(0, unwatchedAvailable.length - 1);
}

/**
 * Nearest not-yet-aired episode, for Home's "Coming up" section. Mirror of
 * isAvailableToWatch's future-date check, but deliberately NOT the mirror
 * of its missing-date handling: isAvailableToWatch treats a missing
 * air_date as available (correct for Watch Next, where absence of proof
 * shouldn't hide something you might already be able to watch), but here
 * that same missing-date case must NOT count as "upcoming", an unknown
 * date is not a confirmed future one, and showing it under "coming up"
 * would overclaim something TMDB hasn't actually told us.
 */
export function findNextUpcoming(episodes: Episode[], today = new Date().toISOString().slice(0, 10)): Episode | null {
  const upcoming = episodes
    .filter((ep) => ep.airDate && ep.airDate > today)
    .sort((a, b) => (a.airDate as string).localeCompare(b.airDate as string));
  return upcoming[0] ?? null;
}
