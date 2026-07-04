import { db, type TitleMatch } from "../db";
import { searchTvShow, searchMovie, type TvSearchResult, type MovieSearchResult } from "../tmdb";
import { splitTitleYear } from "./parseTvTimeCsv";

export interface DisambiguationCandidate {
  tmdbId: number;
  label: string; // e.g. "The Office (2005)"
  posterPath: string | null;
}

/**
 * Supplied by the UI. Called only when a title has more than one plausible
 * TMDB match AND none of the automatic tie-breakers below resolve it.
 * Returns the chosen tmdbId, or null to skip this title entirely.
 */
export type ResolveAmbiguous = (
  rawTitle: string,
  kind: "show" | "movie",
  candidates: DisambiguationCandidate[]
) => Promise<number | null>;

// How much more popular the top candidate needs to be than the runner-up
// before we trust it automatically instead of asking. This is a judgment
// call, not a documented TMDB threshold, there's no "correct" number here.
// 3x was chosen because it comfortably separates "the show everyone means"
// from "a same-named show nobody's heard of" without being so aggressive
// that closely-matched candidates (e.g. two moderately popular shows with
// the same name) get auto-picked on a coin flip. Revisit if the import
// summary shows auto-picks that turned out wrong.
const POPULARITY_DOMINANCE_RATIO = 3;

function yearOf(dateStr: string | null): number | null {
  return dateStr ? Number(dateStr.slice(0, 4)) : null;
}

function normalize(title: string): string {
  return title.trim().toLowerCase();
}

interface ScoredCandidate extends DisambiguationCandidate {
  year: number | null;
  popularity: number;
  exactTitle: boolean;
}

async function resolveTitle(
  rawTitle: string,
  kind: "show" | "movie",
  resolveAmbiguous: ResolveAmbiguous
): Promise<number | null> {
  // 1. Have we already resolved this exact string before?
  const cached = await db.titleMatches.get(rawTitle);
  if (cached && cached.kind === kind) {
    return cached.tmdbId;
  }

  // 2. TV Time sometimes suffixes a year onto the title, e.g. "Titans (2018)".
  const { title: queryTitle, year: hintYear } = splitTitleYear(rawTitle);
  const normalizedQuery = normalize(queryTitle);

  // 3. Search TMDB.
  let candidates: ScoredCandidate[];
  if (kind === "show") {
    const results: TvSearchResult[] = await searchTvShow(queryTitle);
    candidates = results.map((r) => ({
      tmdbId: r.id,
      label: `${r.name} (${yearOf(r.first_air_date) ?? "?"})`,
      posterPath: r.poster_path,
      year: yearOf(r.first_air_date),
      popularity: r.popularity,
      exactTitle: normalize(r.name) === normalizedQuery,
    }));
  } else {
    const results: MovieSearchResult[] = await searchMovie(queryTitle);
    candidates = results.map((r) => ({
      tmdbId: r.id,
      label: `${r.title} (${yearOf(r.release_date) ?? "?"})`,
      posterPath: r.poster_path,
      year: yearOf(r.release_date),
      popularity: r.popularity,
      exactTitle: normalize(r.title) === normalizedQuery,
    }));
  }

  let chosenId: number | null;
  let matchedName: string | null;
  let matchMethod: NonNullable<TitleMatch["matchMethod"]>;

  if (candidates.length === 0) {
    chosenId = null;
    matchedName = null;
    matchMethod = "skipped";
  } else if (candidates.length === 1) {
    chosenId = candidates[0].tmdbId;
    matchedName = candidates[0].label;
    matchMethod = "single";
  } else if (hintYear !== null && candidates.filter((c) => c.year === hintYear).length === 1) {
    // TV Time's own year suffix uniquely picks one candidate, trust it.
    const match = candidates.find((c) => c.year === hintYear)!;
    chosenId = match.tmdbId;
    matchedName = match.label;
    matchMethod = "year-hint";
  } else if (candidates.filter((c) => c.exactTitle).length === 1) {
    // Exactly one candidate's title matches the query verbatim (case
    // insensitive). A same-titled unrelated show/movie is much less likely
    // to also be an exact string match, so this is a strong signal even
    // before looking at popularity.
    const match = candidates.find((c) => c.exactTitle)!;
    chosenId = match.tmdbId;
    matchedName = match.label;
    matchMethod = "exact-title";
  } else {
    // Popularity-dominance check: is the top-ranked result decisively more
    // popular than the runner-up? TMDB's search already ranks by its own
    // relevance, so we only compare within that order, not resort globally.
    const [first, second] = candidates;
    if (first.popularity >= second.popularity * POPULARITY_DOMINANCE_RATIO) {
      chosenId = first.tmdbId;
      matchedName = first.label;
      matchMethod = "popularity-dominant";
    } else {
      // Genuinely a toss-up: defer to the user.
      chosenId = await resolveAmbiguous(rawTitle, kind, candidates);
      matchedName = chosenId ? candidates.find((c) => c.tmdbId === chosenId)?.label ?? null : null;
      matchMethod = chosenId ? "user-picked" : "skipped";
    }
  }

  const record: TitleMatch = { rawTitle, kind, tmdbId: chosenId, matchedName, matchMethod };
  await db.titleMatches.put(record);

  return chosenId;
}

export async function resolveShowTitle(rawTitle: string, resolveAmbiguous: ResolveAmbiguous): Promise<number | null> {
  return resolveTitle(rawTitle, "show", resolveAmbiguous);
}

export async function resolveMovieTitle(rawTitle: string, resolveAmbiguous: ResolveAmbiguous): Promise<number | null> {
  return resolveTitle(rawTitle, "movie", resolveAmbiguous);
}
