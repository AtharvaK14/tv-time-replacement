import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, episodeKey } from "../db";
import { ensureEpisodesCached } from "../lib/episodeSync";

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
    await ensureEpisodesCached(tmdbId);
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
      {report && <pre className="diagnostic-report">{report}</pre>}
    </div>
  );
}
