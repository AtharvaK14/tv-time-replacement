import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, episodeKey, type Episode, type Show, type WatchedEpisode } from "../db";
import { ensureEpisodesCached, findNextUnwatched } from "../lib/episodeSync";
import { daysSince, STALE_DAYS_THRESHOLD } from "../lib/showStatus";

/**
 * Replicates Home.tsx's two inclusion gates EXACTLY, so the verdict printed
 * here is the truth about why a show is or isn't on the Home lists. If
 * Home's logic changes, this must change with it — that coupling is the
 * entire point of the tool (measuring the real pipeline, not a paraphrase
 * of it).
 *
 * Gate 1 (hasMoreToWatch + the shows query): followed && !archived, AND
 *   (tvTimeStatus === "continuing" OR (a next unwatched episode exists in
 *   the cache AND at least one episode was ever watched)).
 * Gate 2 (the tab split): rows that pass Gate 1 land on "Watch Next" only
 *   if lastWatchedAt is under STALE_DAYS_THRESHOLD days old (never-watched
 *   counts as 0 days); otherwise they land on "Haven't Watched For a
 *   While".
 */
function watchNextVerdict(
  show: Show,
  episodes: Episode[],
  watched: WatchedEpisode[]
): { lines: string[]; passesGate1: boolean; tab: "Watch Next" | "Haven't Watched For a While" | null } {
  const watchedKeys = new Set(watched.map((w) => w.key));
  const next = findNextUnwatched(episodes, watchedKeys);
  const today = new Date().toISOString().slice(0, 10);
  const releasedUnwatched = episodes.filter((e) => (!e.airDate || e.airDate <= today) && !watchedKeys.has(e.key));

  const clauseFollowed = show.isFollowed && !show.isArchived;
  const clauseStatus = show.tvTimeStatus === "continuing";
  const clauseLive = next !== null && watched.length > 0;
  const passesGate1 = clauseFollowed && (clauseStatus || clauseLive);

  const lines: string[] = [];
  lines.push(`isFollowed=${show.isFollowed}, isArchived=${show.isArchived}, tvTimeStatus=${show.tvTimeStatus ?? "(none: CSV import or manual add)"}`);
  const ds = daysSince(show.lastWatchedAt);
  lines.push(`lastWatchedAt=${show.lastWatchedAt ?? "(never)"}${ds !== null ? ` (${ds} days ago)` : ""}`);
  lines.push(`Cached episodes: ${episodes.length}, watched records: ${watched.length}, released-and-unwatched in cache: ${releasedUnwatched.length}`);
  lines.push(
    `Next unwatched per cache: ${next ? `S${next.seasonNumber}E${next.episodeNumber} "${next.name}" (air_date=${next.airDate ?? "unknown"})` : "none"}`
  );
  lines.push(`Gate 1 clauses: followed&&!archived=${clauseFollowed}; tvTimeStatus==="continuing"=${clauseStatus}; live(next found && watched>0)=${clauseLive}`);

  let tab: "Watch Next" | "Haven't Watched For a While" | null = null;
  if (!passesGate1) {
    lines.push("GATE 1: EXCLUDED — this show appears on NEITHER Home list.");
    if (!clauseFollowed) {
      lines.push("  Reason: not followed, or archived.");
    } else if (episodes.length === 0) {
      lines.push("  Reason: NOTHING is cached for this show (episode sync never completed for it) and its status isn't \"continuing\".");
    } else if (next === null) {
      lines.push("  Reason: every released episode in the cache is marked watched (caught up — or the cache is stale/incomplete vs TMDB's current data), and status isn't \"continuing\".");
    } else {
      lines.push("  Reason: zero watched records (never-started show) — the live clause requires watched>0, and status isn't \"continuing\".");
    }
  } else {
    const days = ds ?? 0;
    tab = days < STALE_DAYS_THRESHOLD ? "Watch Next" : "Haven't Watched For a While";
    lines.push(`GATE 1: PASSED — the show is on a Home list.`);
    lines.push(
      `GATE 2 (tab split): last watched ${ds === null ? "never (counts as 0 days)" : `${ds} days ago`} vs ${STALE_DAYS_THRESHOLD}-day threshold -> appears under "${tab}".`
    );
  }
  return { lines, passesGate1, tab };
}

export default function Diagnostics() {
  const shows = useLiveQuery(() => db.shows.orderBy("name").toArray(), []);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDiagnostic(tmdbId: number) {
    setLoading(true);
    setReport(null);
    const show = await db.shows.get(tmdbId);
    const watched = await db.watchedEpisodes.where("showId").equals(tmdbId).toArray();
    // A diagnostics tool must still produce a report when TMDB is down or
    // the key is bad — that's precisely when you need it. Fall back to
    // whatever is already cached and say so, instead of dying silently.
    let syncWarning: string | null = null;
    try {
      await ensureEpisodesCached(tmdbId);
    } catch (e) {
      syncWarning = e instanceof Error ? e.message : String(e);
    }
    const cachedEpisodes = await db.episodes.where("showId").equals(tmdbId).toArray();

    const watchedKeySet = new Set(watched.map((w) => w.key));
    const cachedKeySet = new Set(cachedEpisodes.map((e) => e.key));

    // Watched records with no matching cached TMDB episode: either a season/
    // episode numbering mismatch between TV Time and TMDB, or TMDB simply
    // doesn't have that episode listed.
    const orphanedWatched = watched.filter((w) => !cachedKeySet.has(w.key));

    // Cached TMDB episodes with no matching watched record: either genuinely
    // unwatched, or a numbering mismatch hiding a real watch on the other side.
    const unwatchedPerApp = cachedEpisodes.filter((e) => !watchedKeySet.has(e.key));

    const lines: string[] = [];
    lines.push(`Show: ${show?.name} (tmdbId ${tmdbId})`);
    if (syncWarning) {
      lines.push(`WARNING: TMDB sync failed (${syncWarning}) — everything below uses the existing local cache only.`);
    }
    lines.push(`Watched records in IndexedDB: ${watched.length}`);
    lines.push(`Cached TMDB episodes: ${cachedEpisodes.length}`);
    lines.push(`Orphaned watched records (no matching TMDB episode key): ${orphanedWatched.length}`);
    if (orphanedWatched.length > 0) {
      lines.push(
        "  Sample orphaned keys: " +
          orphanedWatched
            .slice(0, 10)
            .map((w) => `S${w.seasonNumber}E${w.episodeNumber} (key=${w.key})`)
            .join(", ")
      );
    }
    lines.push(`TMDB episodes the app thinks are unwatched: ${unwatchedPerApp.length}`);
    if (unwatchedPerApp.length > 0) {
      lines.push(
        "  First 10 by season/episode order: " +
          [...unwatchedPerApp]
            .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
            .slice(0, 10)
            .map((e) => `S${e.seasonNumber}E${e.episodeNumber} (air_date=${e.airDate ?? "MISSING"})`)
            .join(", ")
      );
      const today = new Date().toISOString().slice(0, 10);
      const confirmedFuture = unwatchedPerApp.filter((e) => e.airDate && e.airDate > today);
      if (confirmedFuture.length > 0) {
        lines.push(
          `  Of those, ${confirmedFuture.length} have a CONFIRMED future air_date (after ${today}) and are ` +
            `correctly excluded from Watch Next as not yet available. Everything else (including missing air_date) ` +
            `is treated as available.`
        );
      }
    }
    // Direct spot check: does S1E1 exist on both sides, and do the keys match exactly?
    const expectedS1E1Key = episodeKey(tmdbId, 1, 1);
    lines.push("");
    lines.push(`S1E1 expected key: ${expectedS1E1Key}`);
    lines.push(`  In watched records: ${watchedKeySet.has(expectedS1E1Key)}`);
    lines.push(`  In cached TMDB episodes: ${cachedKeySet.has(expectedS1E1Key)}`);

    if (show) {
      lines.push("");
      lines.push("--- Home inclusion verdict (replicates Home.tsx exactly) ---");
      lines.push(...watchNextVerdict(show, cachedEpisodes, watched).lines);
    }

    setReport(lines.join("\n"));
    setLoading(false);
  }

  /**
   * One-paste overview of the whole library against Home's gates, WITHOUT
   * fetching anything (uses whatever is cached right now, exactly like
   * Home's rows computation does between sync writes). The per-show
   * diagnostic above force-syncs its one show first; this deliberately
   * doesn't, so "zero cached" counts reflect the app's true resting state.
   */
  async function runLibrarySummary() {
    setLoading(true);
    setReport(null);
    const [shows, episodes, watched] = await Promise.all([
      db.shows.toArray(),
      db.episodes.toArray(),
      db.watchedEpisodes.toArray(),
    ]);

    const episodesByShow = new Map<number, Episode[]>();
    for (const ep of episodes) {
      const list = episodesByShow.get(ep.showId);
      if (list) list.push(ep);
      else episodesByShow.set(ep.showId, [ep]);
    }
    const watchedByShow = new Map<number, WatchedEpisode[]>();
    for (const w of watched) {
      const list = watchedByShow.get(w.showId);
      if (list) list.push(w);
      else watchedByShow.set(w.showId, [w]);
    }

    const followed = shows.filter((s) => s.isFollowed && !s.isArchived);
    const statusCounts = new Map<string, number>();
    let inWatchNext = 0;
    let inStale = 0;
    const excludedNoCache: string[] = [];
    const excludedCaughtUp: string[] = [];
    const excludedNeverStarted: string[] = [];

    for (const s of followed) {
      const statusLabel = s.tvTimeStatus ?? "(none)";
      statusCounts.set(statusLabel, (statusCounts.get(statusLabel) ?? 0) + 1);

      const eps = episodesByShow.get(s.tmdbId) ?? [];
      const w = watchedByShow.get(s.tmdbId) ?? [];
      const { passesGate1, tab } = watchNextVerdict(s, eps, w);
      if (passesGate1) {
        if (tab === "Watch Next") inWatchNext++;
        else inStale++;
      } else if (eps.length === 0) {
        excludedNoCache.push(s.name);
      } else if (findNextUnwatched(eps, new Set(w.map((x) => x.key))) === null) {
        excludedCaughtUp.push(s.name);
      } else {
        excludedNeverStarted.push(s.name);
      }
    }

    const lines: string[] = [];
    lines.push(`Followed & not archived: ${followed.length} of ${shows.length} shows`);
    lines.push(`tvTimeStatus distribution: ${[...statusCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
    lines.push("");
    lines.push(`On "Watch Next" tab: ${inWatchNext}`);
    lines.push(`On "Haven't Watched For a While" tab: ${inStale}`);
    lines.push(`EXCLUDED, nothing cached (sync never completed for them): ${excludedNoCache.length}`);
    if (excludedNoCache.length > 0) lines.push(`  ${excludedNoCache.slice(0, 15).join(", ")}${excludedNoCache.length > 15 ? ", ..." : ""}`);
    lines.push(`EXCLUDED, cache fully watched (caught up, or stale cache): ${excludedCaughtUp.length}`);
    if (excludedCaughtUp.length > 0) lines.push(`  ${excludedCaughtUp.slice(0, 15).join(", ")}${excludedCaughtUp.length > 15 ? ", ..." : ""}`);
    lines.push(`EXCLUDED, never started (watched=0 blocks the live clause): ${excludedNeverStarted.length}`);
    if (excludedNeverStarted.length > 0) lines.push(`  ${excludedNeverStarted.slice(0, 15).join(", ")}${excludedNeverStarted.length > 15 ? ", ..." : ""}`);

    setReport(lines.join("\n"));
    setLoading(false);
  }

  return (
    <div className="panel">
      <h2>Diagnostics</h2>
      <p className="muted small">
        Pick a show to compare what's actually stored in your local database against what TMDB reports, to find
        real mismatches instead of guessing at them.
      </p>
      <div className="field-row">
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select a show...</option>
          {shows?.map((s) => (
            <option key={s.tmdbId} value={s.tmdbId}>
              {s.name}
            </option>
          ))}
        </select>
        <button disabled={!selectedId || loading} onClick={() => selectedId && runDiagnostic(selectedId)}>
          {loading ? "Checking..." : "Run diagnostic"}
        </button>
      </div>
      <div className="field-row">
        <button disabled={loading} onClick={runLibrarySummary}>
          Library-wide Watch Next summary
        </button>
        <span className="muted small">
          Counts every followed show against Home's inclusion rules, using only what's cached right now.
        </span>
      </div>
      {report && <pre className="diagnostic-report">{report}</pre>}
    </div>
  );
}
