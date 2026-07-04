import { useState } from "react";
import { searchTvShow, searchMovie, TMDB_IMAGE_BASE, type TvSearchResult, type MovieSearchResult } from "../tmdb";
import DetailsPanel from "../components/DetailsPanel";

export default function AddTitle() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"show" | "movie">("show");
  const [showResults, setShowResults] = useState<TvSearchResult[]>([]);
  const [movieResults, setMovieResults] = useState<MovieSearchResult[]>([]);
  const [openDetails, setOpenDetails] = useState<{ kind: "show" | "movie"; tmdbId: number } | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    if (kind === "show") {
      setShowResults(await searchTvShow(query.trim()));
    } else {
      setMovieResults(await searchMovie(query.trim()));
    }
  }

  return (
    <div className="panel">
      <h2>Add a show or movie</h2>
      <div className="field-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as "show" | "movie")}>
          <option value="show">TV show</option>
          <option value="movie">Movie</option>
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search TMDB..."
        />
        <button onClick={handleSearch}>Search</button>
      </div>

      <p className="muted small">Tap a result to see details and add it to your library.</p>

      <div className="show-grid">
        {kind === "show" &&
          showResults.map((r) => (
            <button key={r.id} className="show-card" onClick={() => setOpenDetails({ kind: "show", tmdbId: r.id })}>
              {r.poster_path ? (
                <img src={`${TMDB_IMAGE_BASE}${r.poster_path}`} alt={r.name} />
              ) : (
                <div className="poster-placeholder" />
              )}
              <div className="show-card-body">
                <p className="show-name">{r.name}</p>
                <p className="muted small">{r.first_air_date?.slice(0, 4) ?? "?"}</p>
              </div>
            </button>
          ))}
        {kind === "movie" &&
          movieResults.map((r) => (
            <button key={r.id} className="show-card" onClick={() => setOpenDetails({ kind: "movie", tmdbId: r.id })}>
              {r.poster_path ? (
                <img src={`${TMDB_IMAGE_BASE}${r.poster_path}`} alt={r.title} />
              ) : (
                <div className="poster-placeholder" />
              )}
              <div className="show-card-body">
                <p className="show-name">{r.title}</p>
                <p className="muted small">{r.release_date?.slice(0, 4) ?? "?"}</p>
              </div>
            </button>
          ))}
      </div>

      {openDetails && (
        <DetailsPanel kind={openDetails.kind} tmdbId={openDetails.tmdbId} onClose={() => setOpenDetails(null)} />
      )}
    </div>
  );
}
