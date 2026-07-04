import { useState, useEffect } from "react";
import { verifyApiKey } from "../tmdb";
import { verifyOmdbKey } from "../omdb";

type KeyStatus = "idle" | "checking" | "valid" | "invalid";

export default function Settings() {
  const [tmdbKey, setTmdbKey] = useState("");
  const [tmdbStatus, setTmdbStatus] = useState<KeyStatus>("idle");
  const [omdbKey, setOmdbKey] = useState("");
  const [omdbStatus, setOmdbStatus] = useState<KeyStatus>("idle");

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
      <h2>Settings</h2>

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
          <input type="text" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} placeholder="TMDB API key (v3)" />
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
          <input type="text" value={omdbKey} onChange={(e) => setOmdbKey(e.target.value)} placeholder="OMDb API key" />
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
