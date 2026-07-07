const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function getApiKey(): string {
  const key = localStorage.getItem("tmdb_api_key");
  if (!key) {
    throw new Error("TMDB API key is not set. Add it on the Settings page.");
  }
  return key;
}

export function hasApiKey(): boolean {
  return !!localStorage.getItem("tmdb_api_key");
}

async function tmdbGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", getApiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    if (res.status === 401) throw new Error("TMDB rejected the API key. Check it on the Settings page.");
    throw new Error(`TMDB request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function verifyApiKey(key: string): Promise<boolean> {
  const url = new URL(TMDB_BASE + "/authentication");
  url.searchParams.set("api_key", key);
  const res = await fetch(url.toString());
  return res.ok;
}

// ---- Search ---------------------------------------------------------------

export interface TvSearchResult {
  id: number;
  name: string;
  first_air_date: string | null;
  poster_path: string | null;
  popularity: number;
}

export interface MovieSearchResult {
  id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  popularity: number;
}

export async function searchTvShow(query: string): Promise<TvSearchResult[]> {
  const data = await tmdbGet<{ results: TvSearchResult[] }>("/search/tv", { query });
  return data.results;
}

export async function searchMovie(query: string): Promise<MovieSearchResult[]> {
  const data = await tmdbGet<{ results: MovieSearchResult[] }>("/search/movie", { query });
  return data.results;
}

// ---- Details ----------------------------------------------------------------
// Both detail endpoints use append_to_response=external_ids to get imdb_id in
// the SAME call, confirmed against TMDB's own docs, rather than a second
// request. This is what makes accurate (ID-based, not title-based) OMDb
// lookups possible without doubling API calls.

export interface TvShowDetails {
  id: number;
  name: string;
  status: string;
  poster_path: string | null;
  first_air_date: string | null;
  overview: string | null;
  number_of_seasons: number;
  episode_run_time: number[]; // TMDB's array of common episode runtimes in minutes, often just one value, sometimes empty
  genres: { id: number; name: string }[];
  seasons: { season_number: number; episode_count: number; name: string }[];
  external_ids?: { imdb_id: string | null };
}

export async function getTvShowDetails(tmdbId: number): Promise<TvShowDetails> {
  return tmdbGet<TvShowDetails>(`/tv/${tmdbId}`, { append_to_response: "external_ids" });
}

export interface SeasonEpisode {
  episode_number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  vote_average: number;
  still_path: string | null;
}

export interface SeasonDetails {
  season_number: number;
  episodes: SeasonEpisode[];
}

export async function getSeasonDetails(tmdbId: number, seasonNumber: number): Promise<SeasonDetails> {
  return tmdbGet<SeasonDetails>(`/tv/${tmdbId}/season/${seasonNumber}`);
}

export interface MovieDetails {
  id: number;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  overview: string | null;
  runtime: number | null; // minutes
  genres: { id: number; name: string }[];
  external_ids?: { imdb_id: string | null };
}

export async function getMovieDetails(tmdbId: number): Promise<MovieDetails> {
  return tmdbGet<MovieDetails>(`/movie/${tmdbId}`, { append_to_response: "external_ids" });
}

// ---- Genres -----------------------------------------------------------------

export interface Genre {
  id: number;
  name: string;
}

export async function getTvGenres(): Promise<Genre[]> {
  const data = await tmdbGet<{ genres: Genre[] }>("/genre/tv/list");
  return data.genres;
}

export async function getMovieGenres(): Promise<Genre[]> {
  const data = await tmdbGet<{ genres: Genre[] }>("/genre/movie/list");
  return data.genres;
}

// ---- Discovery (Add page suggestions) ----------------------------------------

export async function getPopularTvShows(): Promise<TvSearchResult[]> {
  // TMDB's own docs: "popularity" is a lifetime aggregate score, not a
  // "right now" signal, that's what caused decades-old or niche shows to
  // show up under a "right now" label. "Trending" is TMDB's actual concept
  // for that, confirmed via their popularity-and-trending documentation.
  const data = await tmdbGet<{ results: TvSearchResult[] }>("/trending/tv/week");
  return data.results;
}

export async function getPopularMovies(): Promise<MovieSearchResult[]> {
  const data = await tmdbGet<{ results: MovieSearchResult[] }>("/trending/movie/week");
  return data.results;
}

export async function getUpcomingMovies(): Promise<MovieSearchResult[]> {
  // Without a region, TMDB's /movie/upcoming treats a film as "upcoming" if
  // it hasn't released ANYWHERE in the world yet, so something already out
  // in the US but not yet in, say, Japan still qualifies. Confirmed via
  // multiple real TMDB bug reports matching this exact symptom (movies a
  // month past their US release still showing as upcoming). region=US
  // filters to US release dates specifically.
  const data = await tmdbGet<{ results: MovieSearchResult[] }>("/movie/upcoming", { region: "US" });
  return data.results;
}

/**
 * TMDB's closest equivalent to Rotten Tomatoes' "Movies at Home" (recent
 * digital/home releases). TMDB doesn't have a dedicated "at home" endpoint,
 * this uses /discover/movie filtered to release type 4 (Digital, confirmed
 * via TMDB's own release_dates documentation) within the last ~45 days,
 * sorted newest first. It's a real equivalent built from documented TMDB
 * filters, not the same curation RT does, worth treating as an approximation.
 */
export async function getRecentlyAvailableAtHome(): Promise<MovieSearchResult[]> {
  const today = new Date();
  const past = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const data = await tmdbGet<{ results: MovieSearchResult[] }>("/discover/movie", {
    region: "US",
    with_release_type: "4",
    "release_date.gte": fmt(past),
    "release_date.lte": fmt(today),
    sort_by: "release_date.desc",
  });
  return data.results;
}

export interface DiscoverFilters {
  genreId?: number;
  minRating?: number;
}

export async function discoverMovies(filters: DiscoverFilters): Promise<MovieSearchResult[]> {
  const params: Record<string, string> = { sort_by: "popularity.desc" };
  if (filters.genreId) params.with_genres = String(filters.genreId);
  if (filters.minRating) params["vote_average.gte"] = String(filters.minRating);
  const data = await tmdbGet<{ results: MovieSearchResult[] }>("/discover/movie", params);
  return data.results;
}

// ---- Exact ID-based lookup, verified against TMDB's own community docs -----
// Confirmed working for external_source values "imdb_id" and "tvdb_id",
// covering both movie_results and tv_results. This is an exact ID join, not
// a fuzzy title search, and is used as the PRIMARY matching path whenever
// the TV Time export gives us an IMDb or TVDB ID, only falling back to the
// fuzzy title matcher when no ID is available or the ID lookup comes up empty.

export interface FindResults {
  movie_results: MovieSearchResult[];
  tv_results: TvSearchResult[];
}

export async function findByExternalId(
  externalId: string,
  source: "imdb_id" | "tvdb_id"
): Promise<FindResults> {
  return tmdbGet<FindResults>(`/find/${externalId}`, { external_source: source });
}
