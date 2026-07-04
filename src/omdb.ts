const OMDB_BASE = "https://www.omdbapi.com/";

function getOmdbKey(): string | null {
  return localStorage.getItem("omdb_api_key");
}

export function hasOmdbKey(): boolean {
  return !!getOmdbKey();
}

export async function verifyOmdbKey(key: string): Promise<boolean> {
  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  url.searchParams.set("t", "Inception"); // any well-known title, just to validate the key
  const res = await fetch(url.toString());
  if (!res.ok) return false;
  const data = await res.json();
  return data.Response === "True";
}

export interface OmdbRatings {
  imdbRating: string | null; // e.g. "8.8"
  rottenTomatoes: string | null; // e.g. "87%", movies only per OMDb's own data, often absent for series
  plot: string | null;
}

/**
 * Looks up ratings by title and year. Returns null if OMDb has no key set,
 * has no match, or the request fails, callers should treat missing ratings
 * as "unavailable", not as an error to surface loudly.
 */
export async function getOmdbRatings(title: string, year: number | null): Promise<OmdbRatings | null> {
  const key = getOmdbKey();
  if (!key) return null;

  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  url.searchParams.set("t", title);
  if (year) url.searchParams.set("y", String(year));

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.Response !== "True") return null;

  const ratingsArray: { Source: string; Value: string }[] = data.Ratings ?? [];
  const imdb = ratingsArray.find((r) => r.Source === "Internet Movie Database")?.Value ?? data.imdbRating ?? null;
  const rt = ratingsArray.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;

  return {
    imdbRating: imdb && imdb !== "N/A" ? imdb : null,
    rottenTomatoes: rt ?? null,
    plot: data.Plot && data.Plot !== "N/A" ? data.Plot : null,
  };
}

export interface OmdbEpisodeRating {
  imdbRating: string | null;
  imdbId: string | null;
  plot: string | null;
}

/**
 * Per-episode IMDb rating via OMDb's documented Season+Episode query params
 * (?t=<show>&Season=X&Episode=Y), added per OMDb's own changelog. This is a
 * SEPARATE lookup from the show-level rating, IMDb rates each episode of a
 * series individually.
 *
 * NOTE: this has been implemented against OMDb's documented parameters but
 * not yet run against a live key in this environment. If it returns nulls
 * across the board, check the raw response shape first, don't assume the
 * params are wrong before verifying.
 */
export async function getOmdbEpisodeRating(
  showTitle: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<OmdbEpisodeRating | null> {
  const key = getOmdbKey();
  if (!key) return null;

  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  url.searchParams.set("t", showTitle);
  url.searchParams.set("Season", String(seasonNumber));
  url.searchParams.set("Episode", String(episodeNumber));

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json();
  if (data.Response !== "True") return null;

  return {
    imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
    imdbId: data.imdbID || null,
    plot: data.Plot && data.Plot !== "N/A" ? data.Plot : null,
  };
}
