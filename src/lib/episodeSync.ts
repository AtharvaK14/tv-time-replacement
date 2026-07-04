import { db, episodeKey, type Episode } from "../db";
import { getTvShowDetails, getSeasonDetails } from "../tmdb";

/**
 * Makes sure every season's episode list for a show is cached locally.
 * Skips seasons we already have, so repeated calls are cheap. Returns the
 * list of season numbers TMDB reports for the show (excluding Specials).
 */
export async function ensureEpisodesCached(tmdbId: number): Promise<number[]> {
  const details = await getTvShowDetails(tmdbId);
  const seasonNumbers = details.seasons.map((s) => s.season_number).filter((n) => n > 0);

  const existing = await db.episodes.where("showId").equals(tmdbId).toArray();
  const haveSeasons = new Set(existing.map((e) => e.seasonNumber));
  const missing = seasonNumbers.filter((s) => !haveSeasons.has(s));

  for (const seasonNumber of missing) {
    const season = await getSeasonDetails(tmdbId, seasonNumber);
    const records: Episode[] = season.episodes.map((ep) => ({
      key: episodeKey(tmdbId, seasonNumber, ep.episode_number),
      showId: tmdbId,
      seasonNumber,
      episodeNumber: ep.episode_number,
      name: ep.name,
      airDate: ep.air_date,
    }));
    await db.episodes.bulkPut(records);
  }

  return seasonNumbers;
}

/** The next aired, unwatched episode for a show, in season/episode order. Null if none (up to date, or nothing cached yet). */
export function findNextUnwatched(
  episodes: Episode[],
  watchedKeys: Set<string>
): Episode | null {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...episodes].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  for (const ep of sorted) {
    const aired = ep.airDate ? ep.airDate <= today : false;
    if (aired && !watchedKeys.has(ep.key)) return ep;
  }
  return null;
}
