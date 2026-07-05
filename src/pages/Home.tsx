import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "../db";
import { TMDB_IMAGE_BASE, getMovieGenres, type Genre } from "../tmdb";
import { ensureEpisodesCached, findNextUnwatched } from "../lib/episodeSync";
import { daysSince, STALE_DAYS_THRESHOLD } from "../lib/showStatus";
import DetailsPanel from "../components/DetailsPanel";

interface Row {
  showId: number;
  showName: string;
  posterPath: string | null;
  nextEpisode: Episode;
  lastWatchedAt: string | null;
}

function ShowsHome({ onOpenShow }: { onOpenShow: (tmdbId: number) => void }) {
  const shows = useLiveQuery(() => db.shows.filter((s) => s.isFollowed && !s.isArchived).toArray(), []);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!shows) return;
    let cancelled = false;

    async function build() {
      setSyncing(true);
      const result: Row[] = [];
      for (const show of shows!) {
        await ensureEpisodesCached(show.tmdbId);
        if (cancelled) return;

        const episodes = await db.episodes.where("showId").equals(show.tmdbId).toArray();
        const watched = await db.watchedEpisodes.where("showId").equals(show.tmdbId).toArray();
        const watchedKeys = new Set(watched.map((w) => w.key));
        const next = findNextUnwatched(episodes, watchedKeys);

        if (next && watched.length > 0) {
          result.push({
            showId: show.tmdbId,
            showName: show.name,
            posterPath: show.posterPath,
            nextEpisode: next,
            lastWatchedAt: show.lastWatchedAt,
          });
        }
      }
      if (!cancelled) {
        setRows(result);
        setSyncing(false);
      }
    }
    build();
    return () => {
      cancelled = true;
    };
  }, [shows]);

  async function markWatched(row: Row) {
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

  if (!shows) return <p className="muted">Loading...</p>;

  const watchNext = (rows ?? []).filter((r) => (daysSince(r.lastWatchedAt) ?? 0) < STALE_DAYS_THRESHOLD);
  const stale = (rows ?? []).filter((r) => (daysSince(r.lastWatchedAt) ?? 0) >= STALE_DAYS_THRESHOLD);

  return (
    <>
      <h2>Watch Next</h2>
      {syncing && <p className="muted small">Syncing episode data from TMDB...</p>}

      {watchNext.length === 0 && !syncing && (
        <p className="muted">
          Nothing queued up. If you're sure some shows should be here, check the Diagnostics tab, or try re-running
          the import (a past bug in episode detail clicks could have accidentally unmarked episodes, re-importing
          restores watch history straight from your CSV regardless of current state).
        </p>
      )}

      <div className="watch-next-list">
        {watchNext.map((row) => (
          <div key={row.showId} className="watch-next-row">
            {row.posterPath ? (
              <img
                src={`${TMDB_IMAGE_BASE}${row.posterPath}`}
                alt={row.showName}
                onClick={() => onOpenShow(row.showId)}
              />
            ) : (
              <div className="poster-placeholder wn-poster" onClick={() => onOpenShow(row.showId)} />
            )}
            <div className="wn-body">
              <p className="show-name" onClick={() => onOpenShow(row.showId)}>
                {row.showName}
              </p>
              <p className="muted small">
                S{row.nextEpisode.seasonNumber}E{row.nextEpisode.episodeNumber} &middot; {row.nextEpisode.name}
              </p>
            </div>
            <button onClick={() => markWatched(row)}>Mark watched</button>
          </div>
        ))}
      </div>

      {stale.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Haven't Watched For a While</h2>
          <p className="muted small">No activity in {STALE_DAYS_THRESHOLD}+ days, but there's more to watch.</p>
          <div className="watch-next-list">
            {stale.map((row) => (
              <div key={row.showId} className="watch-next-row">
                {row.posterPath ? (
                  <img
                    src={`${TMDB_IMAGE_BASE}${row.posterPath}`}
                    alt={row.showName}
                    onClick={() => onOpenShow(row.showId)}
                  />
                ) : (
                  <div className="poster-placeholder wn-poster" onClick={() => onOpenShow(row.showId)} />
                )}
                <div className="wn-body">
                  <p className="show-name" onClick={() => onOpenShow(row.showId)}>
                    {row.showName}
                  </p>
                  <p className="muted small">
                    S{row.nextEpisode.seasonNumber}E{row.nextEpisode.episodeNumber} &middot; {row.nextEpisode.name}
                  </p>
                  <p className="muted small">Last watched {daysSince(row.lastWatchedAt)} days ago</p>
                </div>
                <button onClick={() => markWatched(row)}>Mark watched</button>
              </div>
            ))}
          </div>
        </>
      )}
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
