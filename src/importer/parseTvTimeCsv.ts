import Papa from "papaparse";

// Schema verified directly against a real user's TV Time GDPR export by
// loading and profiling the CSVs in a Python shell, not assumed from any
// third-party script or documentation. See README "What I verified" section.
//
// tracking-prod-records.csv is a mixed event log. Two columns matter:
//   type: "watch" | "follow" | "towatch" | "rewatch" | "rewatch_count" | ...
//   entity_type: "movie" | "episode"
// Movies live ONLY in this file. Its episode rows (entity_type=episode,
// type=watch) were verified to be a 100% redundant subset of
// tracking-prod-records-v2.csv, so we deliberately ignore episode rows here
// to avoid double-processing the same watch event through two code paths.
//
// tracking-prod-records-v2.csv is also a mixed log, discriminated by a
// prefix on the `key` column:
//   key starts with "watch-episode-"   -> a first-watch of one episode
//   key starts with "rewatch-episode-" -> a rewatch of a previously-watched episode
//   key starts with "user-series-"     -> per-show follow/archive status
// This file was verified to be the complete, authoritative episode history
// (watched_on_episode.csv and the older tracking-prod-records.csv episode
// rows are both fully contained within it, zero new data in either).

export interface RawMovieRow {
  movie_name: string;
  created_at: string;
  type: string;
  entity_type: string;
  alpha_range_key: string;
}

/**
 * A small number of movie rows (verified: 4 out of 810 in a real export)
 * have a blank movie_name but still carry a slugified title in
 * alpha_range_key, e.g. "watch-alpha-no-hard-feelings" -> "No Hard Feelings".
 * Recovering this is better than silently dropping otherwise-valid watch
 * history. The result is approximate (case and punctuation are lossy) but
 * good enough for a TMDB search query.
 */
function titleFromAlphaKey(alphaKey: string): string | null {
  const match = alphaKey.match(/^(?:watch|follow|towatch)-alpha-(.+)$/);
  if (!match) return null;
  return match[1]
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function effectiveMovieName(row: RawMovieRow): string | null {
  if (row.movie_name?.trim()) return row.movie_name.trim();
  return titleFromAlphaKey(row.alpha_range_key ?? "");
}

export interface RawEpisodeEventRow {
  series_name: string;
  season_number: string;
  episode_number: string;
  created_at: string;
  key: string;
}

export interface RawShowFollowRow {
  series_name: string;
  is_followed: string; // "true" | "false"
  is_archived: string; // "true" | "false"
  key: string;
}

function parseCsv<T>(text: string): T[] {
  const result = Papa.parse<T>(text, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0) {
    console.warn("CSV parse warnings:", result.errors);
  }
  return result.data;
}

/** Movie watch events (entity_type=movie, type=watch) from tracking-prod-records.csv. */
export function parseWatchedMovies(text: string): RawMovieRow[] {
  const rows = parseCsv<RawMovieRow>(text);
  return rows
    .filter((r) => r.entity_type === "movie" && r.type === "watch")
    .map((r) => ({ ...r, movie_name: effectiveMovieName(r) ?? "" }))
    .filter((r) => r.movie_name.trim());
}

/** Movies added to a want-to-watch list (follow or towatch, entity_type=movie) but not necessarily watched. */
export function parseWantToWatchMovies(text: string): RawMovieRow[] {
  const rows = parseCsv<RawMovieRow>(text);
  return rows
    .filter((r) => r.entity_type === "movie" && (r.type === "follow" || r.type === "towatch"))
    .map((r) => ({ ...r, movie_name: effectiveMovieName(r) ?? "" }))
    .filter((r) => r.movie_name.trim());
}

/** Episode watch/rewatch events from tracking-prod-records-v2.csv. */
export function parseEpisodeEvents(text: string): RawEpisodeEventRow[] {
  const rows = parseCsv<RawEpisodeEventRow>(text);
  return rows.filter(
    (r) =>
      (r.key?.startsWith("watch-episode-") || r.key?.startsWith("rewatch-episode-")) &&
      r.series_name?.trim() &&
      r.season_number !== "" &&
      r.episode_number !== ""
  );
}

/** Per-show follow/archive status, also embedded in tracking-prod-records-v2.csv. */
export function parseShowFollowStatus(text: string): RawShowFollowRow[] {
  const rows = parseCsv<RawShowFollowRow>(text);
  return rows.filter((r) => r.key?.startsWith("user-series-"));
}

export function groupEpisodeEventsByShow(rows: RawEpisodeEventRow[]): Map<string, RawEpisodeEventRow[]> {
  const map = new Map<string, RawEpisodeEventRow[]>();
  for (const row of rows) {
    const key = row.series_name.trim();
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

export function groupMoviesByTitle(rows: RawMovieRow[]): Map<string, RawMovieRow> {
  const map = new Map<string, RawMovieRow>();
  for (const row of rows) {
    const key = row.movie_name.trim();
    const existing = map.get(key);
    if (!existing || (row.created_at && row.created_at < existing.created_at)) {
      map.set(key, row);
    }
  }
  return map;
}

/**
 * TV Time sometimes suffixes a disambiguating year onto series_name, e.g.
 * "Titans (2018)". Strip it for the search query (TMDB searches plain
 * titles better) but keep the year to auto-resolve ambiguous results.
 */
export function splitTitleYear(rawTitle: string): { title: string; year: number | null } {
  const match = rawTitle.match(/^(.*)\s\((\d{4})\)$/);
  if (match) {
    return { title: match[1].trim(), year: Number(match[2]) };
  }
  return { title: rawTitle, year: null };
}
