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
 * TMDB match. Returns the chosen tmdbId, or null if the user chooses to skip
 * this title entirely (e.g. it's not really a show/movie, or TMDB doesn't
 * have it).
 */
export type ResolveAmbiguous = (
  rawTitle: string,
  kind: "show" | "movie",
  candidates: DisambiguationCandidate[]
) => Promise<number | null>;

function yearOf(dateStr: string | null): number | null {
  return dateStr ? Number(dateStr.slice(0, 4)) : null;
}

async function resolveTitle(
  rawTitle: string,
  kind: "show" | "movie",
  resolveAmbiguous: ResolveAmbiguous
): Promise<number | null> {
  // 1. Have we already resolved this exact string before? (This run, or a
  //    previous import session, since titleMatches persists in IndexedDB.)
  const cached = await db.titleMatches.get(rawTitle);
  if (cached && cached.kind === kind) {
    return cached.tmdbId;
  }

  // 2. TV Time sometimes suffixes a year onto the title, e.g. "Titans (2018)".
  //    Strip it for the search query, but keep it to auto-resolve ambiguity.
  const { title: queryTitle, year: hintYear } = splitTitleYear(rawTitle);

  // 3. Search TMDB.
  let candidates: (DisambiguationCandidate & { year: number | null })[];
  if (kind === "show") {
    const results: TvSearchResult[] = await searchTvShow(queryTitle);
    candidates = results.map((r) => {
      const year = yearOf(r.first_air_date);
      return { tmdbId: r.id, label: `${r.name} (${year ?? "?"})`, posterPath: r.poster_path, year };
    });
  } else {
    const results: MovieSearchResult[] = await searchMovie(queryTitle);
    candidates = results.map((r) => {
      const year = yearOf(r.release_date);
      return { tmdbId: r.id, label: `${r.title} (${year ?? "?"})`, posterPath: r.poster_path, year };
    });
  }

  let chosenId: number | null;
  let matchedName: string | null;

  if (candidates.length === 0) {
    chosenId = null;
    matchedName = null;
  } else if (candidates.length === 1) {
    // Not ambiguous, no need to interrupt the user for a single hit.
    chosenId = candidates[0].tmdbId;
    matchedName = candidates[0].label;
  } else if (hintYear !== null && candidates.filter((c) => c.year === hintYear).length === 1) {
    // TV Time's own year suffix uniquely picks one candidate. Trust it
    // rather than interrupting the user for something TV Time already told us.
    const match = candidates.find((c) => c.year === hintYear)!;
    chosenId = match.tmdbId;
    matchedName = match.label;
  } else {
    // Genuinely ambiguous: defer to the user, per the semi-automatic mode.
    chosenId = await resolveAmbiguous(rawTitle, kind, candidates);
    matchedName = chosenId ? candidates.find((c) => c.tmdbId === chosenId)?.label ?? null : null;
  }

  // 4. Cache the decision so this exact title never prompts again.
  const record: TitleMatch = { rawTitle, kind, tmdbId: chosenId, matchedName };
  await db.titleMatches.put(record);

  return chosenId;
}

export async function resolveShowTitle(rawTitle: string, resolveAmbiguous: ResolveAmbiguous): Promise<number | null> {
  return resolveTitle(rawTitle, "show", resolveAmbiguous);
}

export async function resolveMovieTitle(rawTitle: string, resolveAmbiguous: ResolveAmbiguous): Promise<number | null> {
  return resolveTitle(rawTitle, "movie", resolveAmbiguous);
}
