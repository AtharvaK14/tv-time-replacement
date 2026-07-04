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

// ---- Details ---------------------------------------------------------------

export interface TvShowDetails {
  id: number;
  name: string;
  status: string;
  poster_path: string | null;
  first_air_date: string | null;
  overview: string | null;
  number_of_seasons: number;
  seasons: { season_number: number; episode_count: number; name: string }[];
}

export async function getTvShowDetails(tmdbId: number): Promise<TvShowDetails> {
  return tmdbGet<TvShowDetails>(`/tv/${tmdbId}`);
}

export interface SeasonEpisode {
  episode_number: number;
  name: string;
  overview: string | null;
  air_date: string | null;
  vote_average: number;
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
}

export async function getMovieDetails(tmdbId: number): Promise<MovieDetails> {
  return tmdbGet<MovieDetails>(`/movie/${tmdbId}`);
}
