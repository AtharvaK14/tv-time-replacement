import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode, type Show } from "../db";
import { TMDB_IMAGE_BASE, getMovieGenres, type Genre } from "../tmdb";
import { ensureEpisodesCached, findNextUnwatched, countAdditionalUnwatched } from "../lib/episodeSync";
import { daysSince, STALE_DAYS_THRESHOLD } from "../lib/showStatus";
import DetailsPanel from "../components/DetailsPanel";

interface Row {
  showId: number;
  showName: string;
  posterPath: string | null;
  nextEpisode: Episode | null; // null when TV Time confirms there's more to watch but we couldn't line it up against TMDB's episode list (numbering mismatch)
  additionalCount: number; // the "+N" badge
  lastWatchedAt: string | null;
}

/**
 * A show belongs in "has more to watch" if TV Time's own status says so
 * (authoritative, from the new import format), or if we don't have that
 * status yet (older import) and our own TMDB-episode-list comparison finds
 * an unwatched aired episode.
 */
function hasMoreToWatch(show: Show, computedNext: Episode | null, watchedCount: number): boolean {
  if (show.tvTimeStatus) return show.tvTimeStatus === "continuing";
  return computedNext !== null && watchedCount > 0;
}

function EpisodeRow({ row, onOpenShow, onMarkWatched }: { row: Row; onOpenShow: (id: number) => void; onMarkWatched: (row: Row) => void }) {
  const isPremiere = row.nextEpisode?.episodeNumber === 1;
  return (
    <div className="watch-next-row">
      {row.posterPath ? (
        <img src={`${TMDB_IMAGE_BASE}${row.posterPath}`} alt={row.showName} onClick={() => onOpenShow(row.showId)} />
      ) : (
        <div className="poster-placeholder wn-poster" onClick={() => onOpenShow(row.showId)} />
      )}
      <div className="wn-body">
        <span className="show-pill" onClick={() => onOpenShow(row.showId)}>
          {row.showName} &rsaquo;
        </span>
        {row.nextEpisode ? (
          <>
            <p className="wn-episode-line">
              S{String(row.nextEpisode.seasonNumber).padStart(2, "0")} | E
              {String(row.nextEpisode.episodeNumber).padStart(2, "0")}
              {row.additionalCount > 0 && <span className="muted"> +{row.additionalCount}</span>}
            </p>
            <p className="muted small">{row.nextEpisode.name}</p>
            {isPremiere && <span className="premiere-tag">PREMIERE</span>}
          </>
        ) : (
          <p className="muted small">More to watch (couldn't match the exact next episode against TMDB)</p>
        )}
      </div>
      <button
        className="watch-toggle-circle"
        onClick={() => onMarkWatched(row)}
        aria-label="Mark watched"
        disabled={!row.nextEpisode}
      >
        &#10003;
      </button>
    </div>
  );
}

function ShowsHome({ onOpenShow }: { onOpenShow: (tmdbId: number) => void }) {
  const shows = useLiveQuery(() => db.shows.filter((s) => s.isFollowed && !s.isArchived).toArray(), []);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"next" | "stale">("next");

  // Step 1: make sure TMDB episode lists are cached for every followed show.
  useEffect(() => {
    if (!shows) return;
    let cancelled = false;
    async function sync() {
      setSyncing(true);
      for (const show of shows!) {
        if (cancelled) return;
        await ensureEpisodesCached(show.tmdbId);
      }
      if (!cancelled) setSyncing(false);
    }
    sync();
    return () => {
      cancelled = true;
    };
  }, [shows]);

  // Step 2: a real Dexie live query, recomputes automatically on ANY change
  // to shows, episodes, or watchedEpisodes, not just when the shows list
  // itself changes.
  const rows = useLiveQuery(async (): Promise<Row[]> => {
    if (!shows) return [];
    const result: Row[] = [];
    for (const show of shows) {
      const episodes = await db.episodes.where("showId").equals(show.tmdbId).toArray();
      const watched = await db.watchedEpisodes.where("showId").equals(show.tmdbId).toArray();
      const watchedKeys = new Set(watched.map((w) => w.key));
      const next = findNextUnwatched(episodes, watchedKeys);

      if (hasMoreToWatch(show, next, watched.length)) {
        result.push({
          showId: show.tmdbId,
          showName: show.name,
          posterPath: show.posterPath,
          nextEpisode: next,
          additionalCount: countAdditionalUnwatched(episodes, watchedKeys),
          lastWatchedAt: show.lastWatchedAt,
        });
      }
    }
    return result;
  }, [shows]);

  async function markWatched(row: Row) {
    if (!row.nextEpisode) return;
    await db.watchedEpisodes.put({
      key: row.nextEpisode.key,
      showId: row.showId,
      seasonNumber: row.nextEpisode.seasonNumber,
      episodeNumber: row.nextEpisode.episodeNumber,
      watchedAt: new Date().toISOString(),
      watchCount: 1,
    });
    await db.shows.update(row.showId, { lastWatchedAt: new Date().toISOString() });
  }

  if (!shows || !rows) return <p className="muted">Loading...</p>;

  const watchNext = rows.filter((r) => (daysSince(r.lastWatchedAt) ?? 0) < STALE_DAYS_THRESHOLD);
  const stale = rows.filter((r) => (daysSince(r.lastWatchedAt) ?? 0) >= STALE_DAYS_THRESHOLD);
  const activeList = tab === "next" ? watchNext : stale;

  return (
    <>
      <div className="pill-tabs">
        <button className={`pill-tab ${tab === "next" ? "active" : ""}`} onClick={() => setTab("next")}>
          Watch Next
        </button>
        <button className={`pill-tab ${tab === "stale" ? "active" : ""}`} onClick={() => setTab("stale")}>
          Haven't Watched For a While
        </button>
      </div>

      {syncing && <p className="muted small">Syncing episode data from TMDB...</p>}

      {activeList.length === 0 && !syncing && (
        <p className="muted">
          {tab === "next"
            ? "Nothing queued up. If you're sure some shows should be here, check Diagnostics in Settings, or re-import using the newer TV Time export format."
            : "Nothing here, everything with more to watch has been touched recently."}
        </p>
      )}

      <div className="watch-next-list">
        {activeList.map((row) => (
          <EpisodeRow key={row.showId} row={row} onOpenShow={onOpenShow} onMarkWatched={markWatched} />
        ))}
      </div>
    </>
  );
}

function MoviesHome() {
  const wantToWatch = useLiveQuery(() => db.movies.filter((m) => !m.watched && m.wantsToWatch).toArray(), []);
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const [genreFilter, setGenreFilter] = useState<number | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);

  useEffect(() => {
    getMovieGenres().then(setGenres).catch(() => setGenres([]));
  }, []);

  if (!wantToWatch) return <p className="muted">Loading...</p>;

  async function markWatched(tmdbId: number) {
    await db.movies.update(tmdbId, { watched: true, watchedAt: new Date().toISOString() });
  }

  const visible = genreFilter === null ? wantToWatch : wantToWatch.filter((m) => m.genreIds?.includes(genreFilter));

  return (
    <>
      <h2>Movies to Watch</h2>

      {wantToWatch.length > 0 && (
        <div className="field-row">
          <select
            value={genreFilter ?? ""}
            onChange={(e) => setGenreFilter(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {visible.length === 0 && <p className="muted">Nothing on your movie watchlist right now.</p>}
      <div className="watch-next-list">
        {visible.map((m) => (
          <div key={m.tmdbId} className="watch-next-row">
            {m.posterPath ? (
              <img src={`${TMDB_IMAGE_BASE}${m.posterPath}`} alt={m.title} onClick={() => setOpenDetails(m.tmdbId)} />
            ) : (
              <div className="poster-placeholder wn-poster" onClick={() => setOpenDetails(m.tmdbId)} />
            )}
            <div className="wn-body">
              <p className="show-name" onClick={() => setOpenDetails(m.tmdbId)}>
                {m.title} {m.releaseYear ? `(${m.releaseYear})` : ""}
              </p>
            </div>
            <button onClick={() => markWatched(m.tmdbId)}>Mark watched</button>
          </div>
        ))}
      </div>
      {openDetails !== null && <DetailsPanel kind="movie" tmdbId={openDetails} onClose={() => setOpenDetails(null)} />}
    </>
  );
}

export default function Home() {
  const [view, setView] = useState<"shows" | "movies">("shows");
  const [openShow, setOpenShow] = useState<number | null>(null);

  return (
    <div className="panel">
      <div className="home-toggle">
        <button className={view === "shows" ? "nav-active" : ""} onClick={() => setView("shows")}>
          TV Shows
        </button>
        <button className={view === "movies" ? "nav-active" : ""} onClick={() => setView("movies")}>
          Movies
        </button>
      </div>

      {view === "shows" ? <ShowsHome onOpenShow={setOpenShow} /> : <MoviesHome />}

      {openShow !== null && <DetailsPanel kind="show" tmdbId={openShow} onClose={() => setOpenShow(null)} />}
    </div>
  );
}
