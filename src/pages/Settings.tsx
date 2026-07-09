import { useState, useEffect } from "react";
import { verifyApiKey } from "../tmdb";
import { verifyOmdbKey } from "../omdb";
import { db } from "../db";
import ImportWizard from "./ImportWizard";
import Diagnostics from "./Diagnostics";

type KeyStatus = "idle" | "checking" | "valid" | "invalid";

function ApiKeys() {
  const [tmdbKey, setTmdbKey] = useState("");
  const [tmdbStatus, setTmdbStatus] = useState<KeyStatus>("idle");
  const [tmdbVisible, setTmdbVisible] = useState(false);
  const [omdbKey, setOmdbKey] = useState("");
  const [omdbStatus, setOmdbStatus] = useState<KeyStatus>("idle");
  const [omdbVisible, setOmdbVisible] = useState(false);

  useEffect(() => {
    const savedTmdb = localStorage.getItem("tmdb_api_key");
    if (savedTmdb) {
      setTmdbKey(savedTmdb);
      setTmdbStatus("valid");
    }
    const savedOmdb = localStorage.getItem("omdb_api_key");
    if (savedOmdb) {
      setOmdbKey(savedOmdb);
      setOmdbStatus("valid");
    }
  }, []);

  async function saveTmdb() {
    setTmdbStatus("checking");
    const ok = await verifyApiKey(tmdbKey.trim());
    if (ok) {
      localStorage.setItem("tmdb_api_key", tmdbKey.trim());
      setTmdbStatus("valid");
    } else {
      setTmdbStatus("invalid");
    }
  }

  async function saveOmdb() {
    setOmdbStatus("checking");
    const ok = await verifyOmdbKey(omdbKey.trim());
    if (ok) {
      localStorage.setItem("omdb_api_key", omdbKey.trim());
      setOmdbStatus("valid");
    } else {
      setOmdbStatus("invalid");
    }
  }

  return (
    <div className="panel">
      <div className="settings-block">
        <h3>TMDB (required)</h3>
        <p className="muted small">
          Powers show/movie search, posters, plots, and episode lists. Free key at{" "}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
            themoviedb.org/settings/api
          </a>{" "}
          under non-commercial terms.
        </p>
        <div className="field-row">
          <input
            type={tmdbVisible ? "text" : "password"}
            value={tmdbKey}
            onChange={(e) => setTmdbKey(e.target.value)}
            placeholder="TMDB API key (v3)"
            autoComplete="off"
          />
          <button onClick={() => setTmdbVisible((v) => !v)} aria-label={tmdbVisible ? "Hide key" : "Show key"}>
            {tmdbVisible ? "Hide" : "Show"}
          </button>
          <button onClick={saveTmdb} disabled={!tmdbKey.trim() || tmdbStatus === "checking"}>
            {tmdbStatus === "checking" ? "Checking..." : "Save"}
          </button>
        </div>
        {tmdbStatus === "valid" && <p className="status-ok">Key verified and saved.</p>}
        {tmdbStatus === "invalid" && <p className="status-error">TMDB rejected this key.</p>}
      </div>

      <div className="settings-block">
        <h3>OMDb (optional, for IMDb / Rotten Tomatoes ratings)</h3>
        <p className="muted small">
          There is no free official IMDb or Rotten Tomatoes API. OMDb is the legitimate free aggregator, 1,000
          requests/day, non-commercial license. Get a key at{" "}
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">
            omdbapi.com/apikey.aspx
          </a>
          . Rotten Tomatoes scores are typically only available for movies, not TV shows, that's an OMDb data
          limitation, not a bug here.
        </p>
        <div className="field-row">
          <input
            type={omdbVisible ? "text" : "password"}
            value={omdbKey}
            onChange={(e) => setOmdbKey(e.target.value)}
            placeholder="OMDb API key"
            autoComplete="off"
          />
          <button onClick={() => setOmdbVisible((v) => !v)} aria-label={omdbVisible ? "Hide key" : "Show key"}>
            {omdbVisible ? "Hide" : "Show"}
          </button>
          <button onClick={saveOmdb} disabled={!omdbKey.trim() || omdbStatus === "checking"}>
            {omdbStatus === "checking" ? "Checking..." : "Save"}
          </button>
        </div>
        {omdbStatus === "valid" && <p className="status-ok">Key verified and saved.</p>}
        {omdbStatus === "invalid" && <p className="status-error">OMDb rejected this key.</p>}
      </div>

      <hr />
      <p className="muted small">
        Required attribution, per TMDB's terms: this product uses the TMDB API but is not endorsed or certified by
        TMDB. OMDb content is CC BY-NC 4.0, non-commercial use only, same as this app.
      </p>
    </div>
  );
}

function ResetData() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  async function handleReset() {
    await Promise.all([
      db.shows.clear(),
      db.episodes.clear(),
      db.watchedEpisodes.clear(),
      db.movies.clear(),
      db.titleMatches.clear(),
    ]);
    setConfirming(false);
    setDone(true);
  }

  return (
    <div className="panel">
      <p className="muted small">
        Clears all shows, movies, episodes, and watch history from this browser. Your TMDB/OMDb API keys are not
        affected, they're stored separately and won't need re-entering. Useful for a clean re-import after schema
        or import-logic changes, rather than leaving stale or partially-backfilled data around indefinitely.
      </p>
      {!confirming && !done && (
        <button className="danger-button" onClick={() => setConfirming(true)}>
          Reset all show/movie data
        </button>
      )}
      {confirming && (
        <div className="settings-block">
          <p className="status-error">
            This permanently deletes everything in Shows, Movies, and watch history from this browser. There is no
            undo. Re-import afterward to rebuild it.
          </p>
          <div className="field-row">
            <button className="danger-button" onClick={handleReset}>
              Yes, delete everything
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {done && <p className="status-ok">Cleared. Go to Import above to rebuild your library.</p>}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="panel">
      <h2>Settings</h2>

      <details open>
        <summary><h3 style={{ display: "inline" }}>Import from TV Time</h3></summary>
        <div style={{ marginTop: 14 }}>
          <ImportWizard />
        </div>
      </details>

      <details>
        <summary><h3 style={{ display: "inline" }}>API Keys</h3></summary>
        <div style={{ marginTop: 14 }}>
          <ApiKeys />
        </div>
      </details>

      <details>
        <summary><h3 style={{ display: "inline" }}>Diagnostics</h3></summary>
        <div style={{ marginTop: 14 }}>
          <Diagnostics />
        </div>
      </details>

      <details>
        <summary><h3 style={{ display: "inline", color: "var(--danger)" }}>Reset Data</h3></summary>
        <div style={{ marginTop: 14 }}>
          <ResetData />
        </div>
      </details>
    </div>
  );
}
