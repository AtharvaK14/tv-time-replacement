// Schema verified directly by inspecting the user's real uploaded files
// (tvtime-movies-*.json, tvtime-series-*.json), not assumed. This export
// (from a third-party tool, "TV Time Out by Refract") is a major upgrade
// over TV Time's own raw GDPR CSV export: it carries explicit IMDb/TVDB
// IDs, explicit per-episode is_watched/watched_count/rewatch_count, and
// TV Time's own authoritative per-show status, instead of a flat event log
// that has to be reverse-engineered.
//
// Known limitations, per the exporter tool's own documented notice (read
// directly from the bundled HTML summary, not assumed): watches from before
// 2017 may be missing from this export even though they exist in the raw
// GDPR CSVs, some shows can carry orphaned watch records for episodes never
// actually watched, and continuing shows can show phantom unwatched
// episodes if TV Time pre-created placeholder episodes before they aired.

export interface TvTimeMovieExport {
  id: { tvdb: number | null; imdb: string | null };
  uuid: string;
  created_at: string;
  title: string;
  year: number | null;
  watched_at: string | null;
  is_watched: boolean;
  is_favorite: boolean;
  rewatch_count: number;
}

export interface TvTimeEpisodeExport {
  id: { tvdb: number | null; imdb: string | null };
  number: number;
  name: string;
  special: boolean;
  is_watched: boolean;
  watched_at: string | null;
  rewatch_count: number;
  watched_count: number;
}

export interface TvTimeSeasonExport {
  number: number;
  is_specials: boolean;
  episodes: TvTimeEpisodeExport[];
}

export type TvTimeShowStatus = "not_started_yet" | "continuing" | "up_to_date" | "stopped" | "watch_later";

export interface TvTimeShowExport {
  uuid: string;
  id: { tvdb: number | null; imdb: string | null };
  created_at: string;
  title: string;
  status: TvTimeShowStatus;
  is_favorite: boolean;
  _noEpisodeData: boolean;
  seasons: TvTimeSeasonExport[];
}

export function parseMoviesJson(text: string): TvTimeMovieExport[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Expected the movies export to be a JSON array.");
  return data;
}

export function parseSeriesJson(text: string): TvTimeShowExport[] {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Expected the series export to be a JSON array.");
  return data;
}
