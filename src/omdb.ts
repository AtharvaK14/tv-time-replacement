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
