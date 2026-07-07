const TVMAZE_BASE = "https://api.tvmaze.com";

// Schema verified against a real example episode payload and TVmaze's own
// documentation (they explicitly state HATEOAS/HAL compliance, hence the
// _embedded wrapper). Not tested against a live call in this environment,
// api.tvmaze.com isn't reachable from this sandbox, so this is built
// directly from their documented behavior, the same transparency standard
// applied to every other unverified integration in this project.

interface TvmazeShow {
  id: number;
}

interface TvmazeEpisode {
  season: number;
  number: number | null; // null for specials
  runtime: number | null; // minutes, null if TVmaze doesn't have it for this episode either
}

interface TvmazeShowWithEpisodes extends TvmazeShow {
  _embedded?: { episodes: TvmazeEpisode[] };
}

/** TVmaze's own internal show ID for a given TVDB ID, or null if not found. */
async function lookupShowByTvdbId(tvdbId: number): Promise<number | null> {
  const res = await fetch(`${TVMAZE_BASE}/lookup/shows?thetvdb=${tvdbId}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data: TvmazeShow = await res.json();
  return data.id ?? null;
}

/**
 * Real per-episode runtimes for a show, keyed by "season-number" to match
 * this app's own episode key format. Empty map (not a throw) on any
 * failure, since this is a best-effort accuracy improvement, not a hard
 * dependency, a show TVmaze doesn't have shouldn't break anything.
 */
export async function getTvmazeRuntimesByTvdbId(tvdbId: number): Promise<Map<string, number>> {
  const empty = new Map<string, number>();
  try {
    const tvmazeId = await lookupShowByTvdbId(tvdbId);
    if (tvmazeId === null) return empty;

    const res = await fetch(`${TVMAZE_BASE}/shows/${tvmazeId}?embed=episodes`);
    if (!res.ok) return empty;
    const data: TvmazeShowWithEpisodes = await res.json();
    const episodes = data._embedded?.episodes ?? [];

    const map = new Map<string, number>();
    for (const ep of episodes) {
      if (ep.number === null || ep.runtime === null) continue; // specials or missing data
      map.set(`${ep.season}-${ep.number}`, ep.runtime);
    }
    return map;
  } catch {
    return empty;
  }
}
