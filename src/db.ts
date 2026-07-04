import Dexie, { type Table } from "dexie";

// ---- Domain types -----------------------------------------------------

export interface Show {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  firstAirYear: number | null;
  status: string; // TMDB status: "Returning Series", "Ended", "Canceled", etc.
  addedAt: string; // ISO timestamp
  isFollowed: boolean; // from TV Time's user-series follow record, or true if added manually
  isArchived: boolean; // TV Time's archived flag; still has history, just not active
  lastWatchedAt: string | null; // ISO timestamp, max(watched episode timestamp) for this show
}

export interface Episode {
  // Composite key as string: `${tmdbId}-${seasonNumber}-${episodeNumber}`
  key: string;
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  airDate: string | null;
}

export interface WatchedEpisode {
  key: string; // same composite key as Episode
  showId: number;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: string; // ISO timestamp, from TV Time's created_at when imported
}

export interface Movie {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  watched: boolean;
  watchedAt: string | null;
  wantsToWatch: boolean; // from TV Time's 'follow'/'towatch' events, true even before watched
}

// Remembers how a raw TV Time title string was resolved, so re-running an
// import (or importing a second export later) never re-prompts for the same
// title twice. tmdbId of null means "user chose to skip this title".
export interface TitleMatch {
  rawTitle: string; // exact string from the TV Time CSV, this is the primary key
  kind: "show" | "movie";
  tmdbId: number | null;
  matchedName: string | null;
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
  }
}

export const db = new TrackerDB();

export function episodeKey(showId: number, season: number, episode: number): string {
  return `${showId}-${season}-${episode}`;
}
