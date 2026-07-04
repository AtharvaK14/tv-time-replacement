import { useState } from "react";
import { runImport, type ImportProgress, type ImportResult } from "../importer/runImport";
import type { DisambiguationCandidate, ResolveAmbiguous } from "../importer/matcher";
import { TMDB_IMAGE_BASE, hasApiKey } from "../tmdb";

interface PendingChoice {
  rawTitle: string;
  kind: "show" | "movie";
  candidates: DisambiguationCandidate[];
  resolve: (id: number | null) => void;
}

export default function ImportWizard() {
  const [recordsFile, setRecordsFile] = useState<File | null>(null);
  const [recordsV2File, setRecordsV2File] = useState<File | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolves ambiguous titles by pausing on `pending` state until the user
  // clicks a candidate (or "skip") in the modal below.
  const resolveAmbiguous: ResolveAmbiguous = (rawTitle, kind, candidates) => {
    return new Promise<number | null>((resolve) => {
      setPending({ rawTitle, kind, candidates, resolve });
    });
  };

  function choose(id: number | null) {
    if (!pending) return;
    pending.resolve(id);
    setPending(null);
  }

  async function handleRun() {
    setError(null);
    if (!hasApiKey()) {
      setError("Add your TMDB API key on the Settings page first.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const recordsCsvText = recordsFile ? await recordsFile.text() : undefined;
      const recordsV2CsvText = recordsV2File ? await recordsV2File.text() : undefined;
      if (!recordsCsvText && !recordsV2CsvText) {
        setError("Choose at least one CSV file.");
        setRunning(false);
        return;
      }
      const res = await runImport({ recordsCsvText, recordsV2CsvText }, resolveAmbiguous, setProgress);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel">
      <h2>Import from TV Time</h2>
      <p className="muted">
        From your TV Time GDPR export zip, upload the two files by their exact names below. Uploading the wrong
        one into the wrong slot is the single most common mistake here, TV Time names them almost identically.
      </p>

      <div className="field-row">
        <label className="file-label">
          <code>tracking-prod-records.csv</code> (movies)
          <input type="file" accept=".csv" onChange={(e) => setRecordsFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="field-row">
        <label className="file-label">
          <code>tracking-prod-records-v2.csv</code> (episode history + follow status)
          <input type="file" accept=".csv" onChange={(e) => setRecordsV2File(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <button onClick={handleRun} disabled={running || (!recordsFile && !recordsV2File)}>
        {running ? "Importing..." : "Start import"}
      </button>

      {error && <p className="status-error">{error}</p>}

      {progress && progress.phase !== "done" && (
        <div className="progress-block">
          <p>
            {progress.phase === "shows" ? "Matching shows" : "Matching movies"}: {progress.current} / {progress.total}
          </p>
          <p className="muted small">Looking up: {progress.currentTitle}</p>
        </div>
      )}

      {result && (
        <div className="result-block">
          <h3>Import complete</h3>
          <p>
            Shows matched: {result.showsMatched} &middot; Episodes imported: {result.episodesImported} &middot;
            Movies matched: {result.moviesMatched}
          </p>

          <details open>
            <summary>How matches were resolved</summary>
            <ul className="match-method-list">
              {result.matchMethodCounts.single > 0 && (
                <li>{result.matchMethodCounts.single} had only one TMDB result, unambiguous</li>
              )}
              {result.matchMethodCounts["year-hint"] > 0 && (
                <li>{result.matchMethodCounts["year-hint"]} resolved by TV Time's own year suffix</li>
              )}
              {result.matchMethodCounts["exact-title"] > 0 && (
                <li>{result.matchMethodCounts["exact-title"]} resolved by exact title match</li>
              )}
              {result.matchMethodCounts["popularity-dominant"] > 0 && (
                <li>
                  <strong>{result.matchMethodCounts["popularity-dominant"]} auto-picked</strong> because one
                  candidate was decisively more popular, worth a quick spot check
                </li>
              )}
              {result.matchMethodCounts["user-picked"] > 0 && (
                <li>{result.matchMethodCounts["user-picked"]} you picked manually</li>
              )}
              {result.matchMethodCounts.skipped > 0 && <li>{result.matchMethodCounts.skipped} skipped, no confident match</li>}
            </ul>
          </details>

          {result.showsSkipped.length > 0 && (
            <details>
              <summary>{result.showsSkipped.length} show title(s) skipped</summary>
              <ul>
                {result.showsSkipped.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </details>
          )}
          {result.moviesSkipped.length > 0 && (
            <details>
              <summary>{result.moviesSkipped.length} movie title(s) skipped</summary>
              <ul>
                {result.moviesSkipped.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {pending && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Which "{pending.rawTitle}"?</h3>
            <p className="muted small">TV Time doesn't record which one, so pick the right match.</p>
            <div className="candidate-list">
              {pending.candidates.map((c) => (
                <button key={c.tmdbId} className="candidate" onClick={() => choose(c.tmdbId)}>
                  {c.posterPath && <img src={`${TMDB_IMAGE_BASE}${c.posterPath}`} alt="" />}
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <button className="skip" onClick={() => choose(null)}>
              Skip this title
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
