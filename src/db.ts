import Dexie, { type Table } from "dexie";

// ---- Domain types -----------------------------------------------------

export interface Show {
  tmdbId: number;
  tvdbId?: number | null; // from the third-party TV Time export, used for exact ID matching
  name: string;
  posterPath: string | null;
  firstAirYear: number | null;
  status: string; // TMDB status: "Returning Series", "Ended", "Canceled", etc.
  addedAt: string; // ISO timestamp
  isFollowed: boolean; // from TV Time's user-series follow record, or true if added manually
  isArchived: boolean; // TV Time's archived flag; still has history, just not active
  lastWatchedAt: string | null; // ISO timestamp, max(watched episode timestamp) for this show
  episodeRuntimeMinutes?: number | null; // average from TMDB's episode_run_time, undefined until backfilled for pre-existing rows
  genreIds?: number[]; // TMDB genre IDs, for the genre filter
  imdbId?: string | null; // from TMDB's external_ids, used for accurate OMDb lookups instead of title matching
  // TV Time's OWN status for this show (not_started_yet / continuing / up_to_date / stopped / watch_later),
  // straight from the third-party export. This is authoritative and replaces
  // trying to reconstruct "is this show up to date" ourselves by diffing
  // watched episodes against TMDB's episode list, which depends on TMDB and
  // TV Time agreeing on season/episode numbering, something proven NOT
  // reliable enough to build Watch Next on. Undefined for shows added before
  // this field existed, or added manually rather than imported.
  tvTimeStatus?: "not_started_yet" | "continuing" | "up_to_date" | "stopped" | "watch_later";
}

export interface Episode {
  // Composite key as string: `${tmdbId}-${seasonNumber}-${episodeNumber}`
  key: string;
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  airDate: string | null;
  tmdbRating: number; // TMDB's own vote_average, 0-10, always free, distinct from IMDb's rating
  stillPath: string | null; // episode thumbnail image
  runtimeMinutes: number | null; // real per-episode runtime from TVmaze when available; TMDB/TVDB don't reliably track this at all, confirmed directly from their own staff
}

export interface WatchedEpisode {
  key: string; // same composite key as Episode
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string; // ISO timestamp of the first watch, from TV Time's earliest event for this episode
  watchCount: number; // total watch + rewatch events for this episode, for accurate time-watched stats
}

export interface Movie {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  watched: boolean;
  watchedAt: string | null;
  wantsToWatch: boolean; // from TV Time's 'follow'/'towatch' events, true even before watched
  runtimeMinutes?: number | null; // undefined until backfilled for pre-existing rows
  rewatchCount?: number; // additional watches beyond the first, from counted 'rewatch' events (verified more reliable than TV Time's own rewatch_count field)
  genreIds?: number[]; // TMDB genre IDs, for the genre filter
  imdbId?: string | null; // from TMDB's external_ids, used for accurate OMDb lookups instead of title matching
}

// Remembers how a raw TV Time title string was resolved, so re-running an
// import (or importing a second export later) never re-prompts for the same
// title twice. tmdbId of null means "user chose to skip this title".
export interface TitleMatch {
  rawTitle: string; // exact string from the TV Time CSV, this is the primary key
  kind: "show" | "movie";
  tmdbId: number | null;
  matchedName: string | null;
  // Optional because title matches cached before this field existed won't have it.
  matchMethod?: "single" | "year-hint" | "exact-title" | "popularity-dominant" | "user-picked" | "skipped" | "exact-id";
}

export interface Setting {
  key: string;
  value: string;
}

// ---- Database -----------------------------------------------------------

class TrackerDB extends Dexie {
  shows!: Table<Show, number>;
  episodes!: Table<Episode, string>;
  watchedEpisodes!: Table<WatchedEpisode, string>;
  movies!: Table<Movie, number>;
  titleMatches!: Table<TitleMatch, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super("tv-tracker");
    this.version(1).stores({
      shows: "tmdbId, name",
      episodes: "key, showId, [showId+seasonNumber]",
      watchedEpisodes: "key, showId, watchedAt",
      movies: "tmdbId, title, watched",
      titleMatches: "rawTitle, kind",
      settings: "key",
    });
    // v2: added isFollowed/isArchived/lastWatchedAt (shows) and wantsToWatch
    // (movies) once we verified TV Time's real export schema against actual
    // user data. Purely additive, existing rows just get undefined for the
    // new fields until re-imported or edited.
    this.version(2).stores({
      shows: "tmdbId, name, isFollowed, lastWatchedAt",
      episodes: "key, showId, [showId+seasonNumber]",
      watchedEpisodes: "key, showId, watchedAt",
      movies: "tmdbId, title, watched, wantsToWatch",
      titleMatches: "rawTitle, kind",
      settings: "key",
    });
    // v3: added overview + tmdbRating to Episode for the episode-level
    // details panel. Existing cached episode rows predate these fields and
    // would otherwise sit there permanently with them undefined, since the
    // cache-check logic only tests "do we have this season at all", not
    // "does it have the current fields". Clearing forces a clean refetch.
    this.version(3)
      .stores({
        shows: "tmdbId, name, isFollowed, lastWatchedAt",
        episodes: "key, showId, [showId+seasonNumber]",
        watchedEpisodes: "key, showId, watchedAt",
        movies: "tmdbId, title, watched, wantsToWatch",
        titleMatches: "rawTitle, kind",
        settings: "key",
      })
      .upgrade((tx) => tx.table("episodes").clear());
    // v4: added episodeRuntimeMinutes (shows) and runtimeMinutes (movies) for
    // the Stats page's time-watched totals. No index changes, so Dexie
    // doesn't strictly require a version bump here, but bumping anyway for
    // a consistent audit trail. Existing rows get undefined until Stats.tsx
    // backfills them on first visit.
    this.version(4).stores({
      shows: "tmdbId, name, isFollowed, lastWatchedAt",
      episodes: "key, showId, [showId+seasonNumber]",
      watchedEpisodes: "key, showId, watchedAt",
      movies: "tmdbId, title, watched, wantsToWatch",
      titleMatches: "rawTitle, kind",
      settings: "key",
    });
    // v5: added stillPath (Episode), watchCount (WatchedEpisode), and
    // rewatchCount/genreIds/imdbId (Show, Movie).
    //
    // IMPORTANT: only the `episodes` table is cleared here. It's a pure TMDB
    // cache, always safely re-fetchable, losing it costs an API call, not
    // data. watchedEpisodes and movies are NEVER cleared in any migration,
    // they hold your actual watch history and manual edits, there is no
    // TMDB call that could reconstruct that if it were lost.
    //
    // Consequence: existing WatchedEpisode/Movie rows will have
    // watchCount/rewatchCount as undefined until you either edit them
    // individually or re-run the CSV import (which overwrites by primary
    // key with freshly counted values, safe and idempotent, already true
    // of every import run since titleMatches caching was added). Until
    // then, code reading these fields must treat undefined as "assume 1
    // watch", not as zero or an error.
    this.version(5).stores({
      shows: "tmdbId, name, isFollowed, lastWatchedAt",
      episodes: "key, showId, [showId+seasonNumber]",
      watchedEpisodes: "key, showId, watchedAt",
      movies: "tmdbId, title, watched, wantsToWatch",
      titleMatches: "rawTitle, kind",
      settings: "key",
    }).upgrade((tx) => tx.table("episodes").clear());
    // v6: added tvdbId and tvTimeStatus to Show, for the new import path
    // that uses a third-party TV Time data export with clean IDs and TV
    // Time's own authoritative per-show status, instead of reconstructing
    // status from raw event logs. Purely additive, no clearing needed,
    // existing shows just get undefined for these fields until re-imported
    // from the new export format.
    this.version(6).stores({
      shows: "tmdbId, name, isFollowed, lastWatchedAt, tvdbId",
      episodes: "key, showId, [showId+seasonNumber]",
      watchedEpisodes: "key, showId, watchedAt",
      movies: "tmdbId, title, watched, wantsToWatch",
      titleMatches: "rawTitle, kind",
      settings: "key",
    });
    // v7: added runtimeMinutes to Episode (real per-episode runtime from
    // TVmaze, when available). Same pattern as before: only the episodes
    // cache is cleared (pure TMDB/TVmaze cache, always safely re-fetchable),
    // watchedEpisodes and movies are never touched.
    this.version(7)
      .stores({
        shows: "tmdbId, name, isFollowed, lastWatchedAt, tvdbId",
        episodes: "key, showId, [showId+seasonNumber]",
        watchedEpisodes: "key, showId, watchedAt",
        movies: "tmdbId, title, watched, wantsToWatch",
        titleMatches: "rawTitle, kind",
        settings: "key",
      })
      .upgrade((tx) => tx.table("episodes").clear());
  }
}

export const db = new TrackerDB();

export function episodeKey(showId: number, season: number, episode: number): string {
  return `${showId}-${season}-${episode}`;
}
