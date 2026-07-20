import { APP_NAME } from "../appInfo";

// PLACEHOLDER: swap in the real hosted privacy-policy URL before store
// submission. The policy text itself is written and hosted separately
// (out of scope for code); example.com is IANA's reserved placeholder
// domain, so this link goes nowhere real on purpose until replaced.
const PRIVACY_POLICY_URL = "https://example.com/privacy-policy";

/**
 * About / Credits screen (Play Store prep, Phase 2). Carries the
 * attribution required to keep TMDB API access, plus OMDb and TVmaze
 * credits and a privacy-policy link. Reachable from Settings.
 *
 * The TMDB notice text below MUST stay verbatim — it is the exact wording
 * TMDB's API Terms of Use require. Do not paraphrase it.
 */
export default function About() {
  return (
    <div className="panel">
      <div className="settings-block">
        <p className="muted small">
          {APP_NAME} is a local-first TV and movie tracker: your library and API keys live only on this device,
          with no accounts and no server. It connects directly to the services below, under your own keys, to fetch
          metadata and ratings.
        </p>
      </div>

      {/* --- TMDB: attribution required by TMDB's API Terms of Use --- */}
      <div className="settings-block about-source">
        {/* PLACEHOLDER: replace with the official TMDB logo asset, unmodified in
            color and orientation, from https://www.themoviedb.org/about/logos-attribution
            Do NOT restyle or recolor it — that would violate TMDB's brand terms. */}
        <div className="about-logo-placeholder" role="img" aria-label="TMDB logo placeholder">
          TMDB logo
          <span className="about-logo-note">placeholder — add official asset</span>
        </div>
        <p className="about-notice">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p className="muted small">
          Show and movie metadata, posters, and episode data from{" "}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            The Movie Database (TMDB)
          </a>
          .
        </p>
      </div>

      {/* --- OMDb --- */}
      <div className="settings-block about-source">
        <p className="muted small">
          IMDb and Rotten Tomatoes ratings via the{" "}
          <a href="https://www.omdbapi.com" target="_blank" rel="noreferrer">
            OMDb API
          </a>{" "}
          (CC BY-NC 4.0, non-commercial use). IMDb and Rotten Tomatoes are trademarks of their respective owners;
          this app is not affiliated with, endorsed by, or certified by them.
        </p>
      </div>

      {/* --- TVmaze --- */}
      <div className="settings-block about-source">
        <p className="muted small">
          Per-episode runtimes from{" "}
          <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">
            TVmaze
          </a>
          , used under their{" "}
          <a href="https://www.tvmaze.com/api" target="_blank" rel="noreferrer">
            API terms
          </a>
          . This app is not affiliated with or endorsed by TVmaze.
        </p>
      </div>

      <hr />

      <div className="settings-block">
        <h3>Privacy</h3>
        <p className="muted small">
          No accounts, no analytics, no tracking servers. Nothing in your library leaves this device except the
          direct requests to the metadata services above, made with your own keys.
        </p>
        <p>
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
            Privacy policy
          </a>{" "}
          <span className="muted small">(placeholder link — replace before release)</span>
        </p>
      </div>
    </div>
  );
}
