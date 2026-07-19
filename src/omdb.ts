const OMDB_BASE = "https://www.omdbapi.com/";

// Exported so Settings and the backup/restore code reference the same
// storage key instead of re-typing the literal.
export const OMDB_API_KEY_STORAGE = "omdb_api_key";

function getOmdbKey(): string | null {
  return localStorage.getItem(OMDB_API_KEY_STORAGE);
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
  error: string | null;
}

/**
 * Looks up ratings by IMDb ID when available (exact, no ambiguity), falling
 * back to title+year search only when no ID is cached (e.g. a record added
 * before TMDB's external_ids were being fetched). Title-based fallback can
 * match the wrong same-named title, that's a known, real limitation, not a
 * silent risk, callers should prefer passing an imdbId whenever possible.
 */
export async function getOmdbRatings(
  identifier: { imdbId?: string | null; title: string; year: number | null }
): Promise<OmdbRatings | null> {
  const key = getOmdbKey();
  if (!key) return null;

  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  if (identifier.imdbId) {
    url.searchParams.set("i", identifier.imdbId);
  } else {
    url.searchParams.set("t", identifier.title);
    if (identifier.year) url.searchParams.set("y", String(identifier.year));
  }

  const res = await fetch(url.toString());
  if (!res.ok) return { imdbRating: null, rottenTomatoes: null, plot: null, error: `HTTP ${res.status}` };
  const data = await res.json();
  if (data.Response !== "True") {
    return { imdbRating: null, rottenTomatoes: null, plot: null, error: data.Error ?? "Unknown OMDb error" };
  }

  const ratingsArray: { Source: string; Value: string }[] = data.Ratings ?? [];
  const imdb = ratingsArray.find((r) => r.Source === "Internet Movie Database")?.Value ?? data.imdbRating ?? null;
  const rt = ratingsArray.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;

  return {
    imdbRating: imdb && imdb !== "N/A" ? imdb : null,
    rottenTomatoes: rt ?? null,
    plot: data.Plot && data.Plot !== "N/A" ? data.Plot : null,
    error: null,
  };
}

export interface OmdbEpisodeRating {
  imdbRating: string | null;
  imdbId: string | null;
  plot: string | null;
  error: string | null; // OMDb's own error message when Response=False, e.g. "Series not found!"
}

/**
 * Per-episode IMDb rating via OMDb's documented Season+Episode query params.
 * Prefers the show's IMDb ID (?i=<id>&Season=X&Episode=Y, confirmed working
 * per OMDb's own changelog, 11/16/15) over title matching, for the same
 * exact-match-vs-ambiguous-title reason as getOmdbRatings above.
 */
export async function getOmdbEpisodeRating(
  show: { imdbId?: string | null; title: string },
  seasonNumber: number,
  episodeNumber: number
): Promise<OmdbEpisodeRating | null> {
  const key = getOmdbKey();
  if (!key) return null;

  const url = new URL(OMDB_BASE);
  url.searchParams.set("apikey", key);
  if (show.imdbId) {
    url.searchParams.set("i", show.imdbId);
  } else {
    url.searchParams.set("t", show.title);
  }
  url.searchParams.set("Season", String(seasonNumber));
  url.searchParams.set("Episode", String(episodeNumber));

  const res = await fetch(url.toString());
  if (!res.ok) {
    return { imdbRating: null, imdbId: null, plot: null, error: `HTTP ${res.status}` };
  }
  const data = await res.json();
  if (data.Response !== "True") {
    return { imdbRating: null, imdbId: null, plot: null, error: data.Error ?? "Unknown OMDb error" };
  }

  return {
    imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
    imdbId: data.imdbID || null,
    plot: data.Plot && data.Plot !== "N/A" ? data.Plot : null,
    error: null,
  };
}
