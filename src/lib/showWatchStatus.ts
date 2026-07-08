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
 * Combines TV Time's own tvTimeStatus (a snapshot from whenever you last
 * imported) with a live comparison against watched episodes, rather than
 * trusting the imported field exclusively. tvTimeStatus goes stale the
 * moment you mark anything watched or unwatched directly in this app, so
 * always checking live data too means a show doesn't get permanently stuck
 * on whatever status it happened to have at import time.
 */
export async function computeWatchStatus(tmdbId: number): Promise<ShowWatchStatus> {
  const show = await db.shows.get(tmdbId);
  const episodes = await db.episodes.where("showId").equals(tmdbId).toArray();
  const watched = await db.watchedEpisodes.where("showId").equals(tmdbId).toArray();

  let liveStatus: ShowWatchStatus = "unknown";
  if (episodes.length > 0) {
    if (watched.length === 0) {
      liveStatus = "not-started";
    } else {
      const watchedKeys = new Set(watched.map((w) => w.key));
      const next = findNextUnwatched(episodes, watchedKeys);
      liveStatus = next ? "currently-watching" : "up-to-date";
    }
  }

  if (!show?.tvTimeStatus) return liveStatus;

  const imported = fromTvTimeStatus(show.tvTimeStatus);
  // If either signal says "currently watching," trust that, it means
  // there's real evidence of something to watch even if the other signal
  // (usually the stale imported one) disagrees.
  if (imported === "currently-watching" || liveStatus === "currently-watching") return "currently-watching";
  // Otherwise prefer the live signal when we actually have episode data to
  // base it on, falling back to the import snapshot only when we don't.
  return liveStatus !== "unknown" ? liveStatus : imported;
}

/** Same as computeWatchStatus, but forces an episode-list sync first so the TMDB-comparison fallback is reliable. */
export async function computeWatchStatusFresh(tmdbId: number): Promise<ShowWatchStatus> {
  await ensureEpisodesCached(tmdbId);
  return computeWatchStatus(tmdbId);
}
