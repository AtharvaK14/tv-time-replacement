import { db, type Show } from "../db";
import { ensureEpisodesCached, findNextUnwatched } from "./episodeSync";

export type ShowWatchStatus = "not-started" | "currently-watching" | "up-to-date" | "unknown";

function fromTvTimeStatus(status: NonNullable<Show["tvTimeStatus"]>): ShowWatchStatus {
  switch (status) {
    case "continuing":
      return "currently-watching";
    case "up_to_date":
      return "up-to-date";
    case "not_started_yet":
    case "watch_later":
      return "not-started";
    case "stopped":
      return "unknown"; // archived shows are filtered elsewhere; status here is moot
  }
}

/**
 * Requires episodes to already be cached (call ensureEpisodesCached first
 * if you need this to be reliable rather than "unknown"). Deliberately
 * doesn't fetch here itself, callers decide whether the cost of a fetch is
 * worth it for their view (Home always syncs; a big Library grid might not
 * want to force a TMDB fetch per show just to compute a filter).
 *
 * Prefers TV Time's own tvTimeStatus field when the show was imported via
 * the newer export format, that's authoritative and doesn't depend on
 * TV Time and TMDB agreeing on season/episode numbering. Falls back to
 * comparing watched episodes against TMDB's own episode list only for
 * shows imported the older way.
 */
export async function computeWatchStatus(tmdbId: number): Promise<ShowWatchStatus> {
  const show = await db.shows.get(tmdbId);
  if (show?.tvTimeStatus) return fromTvTimeStatus(show.tvTimeStatus);

  const episodes = await db.episodes.where("showId").equals(tmdbId).toArray();
  if (episodes.length === 0) return "unknown";
  const watched = await db.watchedEpisodes.where("showId").equals(tmdbId).toArray();
  if (watched.length === 0) return "not-started";
  const watchedKeys = new Set(watched.map((w) => w.key));
  const next = findNextUnwatched(episodes, watchedKeys);
  return next ? "currently-watching" : "up-to-date";
}

/** Same as computeWatchStatus, but forces an episode-list sync first so the TMDB-comparison fallback is reliable. */
export async function computeWatchStatusFresh(tmdbId: number): Promise<ShowWatchStatus> {
  await ensureEpisodesCached(tmdbId);
  return computeWatchStatus(tmdbId);
}
