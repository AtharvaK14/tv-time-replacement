import { db } from "../db";
import { ensureEpisodesCached, findNextUnwatched } from "./episodeSync";

export type ShowWatchStatus = "not-started" | "currently-watching" | "up-to-date" | "unknown";

/**
 * Requires episodes to already be cached (call ensureEpisodesCached first
 * if you need this to be reliable rather than "unknown"). Deliberately
 * doesn't fetch here itself, callers decide whether the cost of a fetch is
 * worth it for their view (Home always syncs; a big Library grid might not
 * want to force a TMDB fetch per show just to compute a filter).
 */
export async function computeWatchStatus(tmdbId: number): Promise<ShowWatchStatus> {
  const episodes = await db.episodes.where("showId").equals(tmdbId).toArray();
  if (episodes.length === 0) return "unknown";
  const watched = await db.watchedEpisodes.where("showId").equals(tmdbId).toArray();
  if (watched.length === 0) return "not-started";
  const watchedKeys = new Set(watched.map((w) => w.key));
  const next = findNextUnwatched(episodes, watchedKeys);
  return next ? "currently-watching" : "up-to-date";
}

/** Same as computeWatchStatus, but forces an episode-list sync first so the result is reliable. */
export async function computeWatchStatusFresh(tmdbId: number): Promise<ShowWatchStatus> {
  await ensureEpisodesCached(tmdbId);
  return computeWatchStatus(tmdbId);
}
