import { useEffect, useState } from "react";
import {
  searchTvShow,
  searchMovie,
  getPopularTvShows,
  getPopularMovies,
  getUpcomingMovies,
  getRecentlyAvailableAtHome,
  TMDB_IMAGE_BASE,
  hasApiKey,
  type TvSearchResult,
  type MovieSearchResult,
} from "../tmdb";
import DetailsPanel from "../components/DetailsPanel";

function ShowRow({ items, onOpen }: { items: TvSearchResult[]; onOpen: (id: number) => void }) {
  return (
    <div className="show-grid">
      {items.map((r) => (
        <button key={r.id} className="show-card" onClick={() => onOpen(r.id)}>
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
    </div>
  );
}

function MovieRow({ items, onOpen }: { items: MovieSearchResult[]; onOpen: (id: number) => void }) {
  return (
    <div className="show-grid">
      {items.map((r) => (
        <button key={r.id} className="show-card" onClick={() => onOpen(r.id)}>
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
  );
}

export default function AddTitle() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"show" | "movie">("show");
  const [showResults, setShowResults] = useState<TvSearchResult[]>([]);
  const [movieResults, setMovieResults] = useState<MovieSearchResult[]>([]);
  const [openDetails, setOpenDetails] = useState<{ kind: "show" | "movie"; tmdbId: number } | null>(null);

  const [popularShows, setPopularShows] = useState<TvSearchResult[] | null>(null);
  const [popularMovies, setPopularMovies] = useState<MovieSearchResult[] | null>(null);
  const [upcomingMovies, setUpcomingMovies] = useState<MovieSearchResult[] | null>(null);
  const [atHomeMovies, setAtHomeMovies] = useState<MovieSearchResult[] | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const hasSearched = query.trim().length > 0 && (showResults.length > 0 || movieResults.length > 0);

  useEffect(() => {
    if (!hasApiKey()) return;
    let cancelled = false;
    async function loadDiscovery() {
      try {
        const [pop_s, pop_m, up_m, home_m] = await Promise.all([
          getPopularTvShows(),
          getPopularMovies(),
          getUpcomingMovies(),
          getRecentlyAvailableAtHome(),
        ]);
        if (cancelled) return;
        setPopularShows(pop_s);
        setPopularMovies(pop_m);
        setUpcomingMovies(up_m);
        setAtHomeMovies(home_m);
      } catch (e) {
        if (!cancelled) setDiscoverError(e instanceof Error ? e.message : String(e));
      }
    }
    loadDiscovery();
    return () => {
      cancelled = true;
    };
  }, []);

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

      {!hasApiKey() && <p className="status-error">Add your TMDB API key on the Settings page to search or browse.</p>}

      {hasSearched ? (
        <>
          <p className="muted small">Tap a result to see details and add it to your library.</p>
          {kind === "show" && (
            <ShowRow items={showResults} onOpen={(id) => setOpenDetails({ kind: "show", tmdbId: id })} />
          )}
          {kind === "movie" && (
            <MovieRow items={movieResults} onOpen={(id) => setOpenDetails({ kind: "movie", tmdbId: id })} />
          )}
        </>
      ) : (
        hasApiKey() && (
          <div className="discover-sections">
            {discoverError && <p className="status-error">Couldn't load suggestions: {discoverError}</p>}

            <h3>Popular TV shows right now</h3>
            {!popularShows ? (
              <p className="muted small">Loading...</p>
            ) : (
              <ShowRow items={popularShows.slice(0, 10)} onOpen={(id) => setOpenDetails({ kind: "show", tmdbId: id })} />
            )}

            <h3 style={{ marginTop: 20 }}>Popular movies right now</h3>
            {!popularMovies ? (
              <p className="muted small">Loading...</p>
            ) : (
              <MovieRow
                items={popularMovies.slice(0, 10)}
                onOpen={(id) => setOpenDetails({ kind: "movie", tmdbId: id })}
              />
            )}

            <h3 style={{ marginTop: 20 }}>Upcoming movies</h3>
            {!upcomingMovies ? (
              <p className="muted small">Loading...</p>
            ) : (
              <MovieRow
                items={upcomingMovies.slice(0, 10)}
                onOpen={(id) => setOpenDetails({ kind: "movie", tmdbId: id })}
              />
            )}

            <h3 style={{ marginTop: 20 }}>Recently available at home</h3>
            <p className="muted small">
              TMDB's closest match to Rotten Tomatoes' "movies at home" list: recent US digital releases. Not the
              same curation, an approximation built from TMDB's own release-type data.
            </p>
            {!atHomeMovies ? (
              <p className="muted small">Loading...</p>
            ) : atHomeMovies.length === 0 ? (
              <p className="muted small">Nothing found in the last 45 days.</p>
            ) : (
              <MovieRow
                items={atHomeMovies.slice(0, 10)}
                onOpen={(id) => setOpenDetails({ kind: "movie", tmdbId: id })}
              />
            )}
          </div>
        )
      )}

      {openDetails && (
        <DetailsPanel kind={openDetails.kind} tmdbId={openDetails.tmdbId} onClose={() => setOpenDetails(null)} />
      )}
    </div>
  );
}
