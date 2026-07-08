import { useEffect, useMemo, useState } from "react";
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
 * (authoritative at import time), OR if live data in this app says so.
 * Deliberately an OR, not "trust tvTimeStatus exclusively": tvTimeStatus is
 * a snapshot from whenever you last imported, it goes stale the moment you
 * mark anything watched or unwatched directly in this app afterward. Only
 * trusting the imported field meant a show imported as "not_started_yet" or
 * "up_to_date" could never appear here again no matter what you did in the
 * app, which was the actual bug behind episodes you'd just marked watched
 * not showing their follow-up here.
 */
function hasMoreToWatch(show: Show, computedNext: Episode | null, watchedCount: number): boolean {
  const liveSignal = computedNext !== null && watchedCount > 0;
  return show.tvTimeStatus === "continuing" || liveSignal;
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
  // Deliberately simple, single-table, whole-table live queries. Each one is
  // independently and unambiguously reactive to writes on its own table.
  // Combining them in a plain synchronous useMemo below (no async, no
  // Dexie calls inside the memo) removes any uncertainty about how a
  // multi-step async query loop interacts with Dexie's change tracking,
  // which is the more failure-prone pattern the previous version used.
  const allEpisodes = useLiveQuery(() => db.episodes.toArray(), []);
  const allWatched = useLiveQuery(() => db.watchedEpisodes.toArray(), []);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"next" | "stale">("next");

  // Network side effect: make sure TMDB episode lists are cached for every
  // followed show. Writes to db.episodes, which allEpisodes above reacts to,
  // so newly-synced seasons flow into the computation below automatically
  // as they arrive, not just once at the end.
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

  const rows = useMemo<Row[]>(() => {
    if (!shows || !allEpisodes || !allWatched) return [];

    const episodesByShow = new Map<number, Episode[]>();
    for (const ep of allEpisodes) {
      const list = episodesByShow.get(ep.showId);
      if (list) list.push(ep);
      else episodesByShow.set(ep.showId, [ep]);
    }
    const watchedByShow = new Map<number, Set<string>>();
    const watchedCountByShow = new Map<number, number>();
    for (const w of allWatched) {
      const set = watchedByShow.get(w.showId);
      if (set) set.add(w.key);
      else watchedByShow.set(w.showId, new Set([w.key]));
      watchedCountByShow.set(w.showId, (watchedCountByShow.get(w.showId) ?? 0) + 1);
    }

    const result: Row[] = [];
    for (const show of shows) {
      const episodes = episodesByShow.get(show.tmdbId) ?? [];
      const watchedKeys = watchedByShow.get(show.tmdbId) ?? new Set<string>();
      const watchedCount = watchedCountByShow.get(show.tmdbId) ?? 0;
      const next = findNextUnwatched(episodes, watchedKeys);

      if (hasMoreToWatch(show, next, watchedCount)) {
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
  }, [shows, allEpisodes, allWatched]);

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

  if (!shows || !allEpisodes || !allWatched) return <p className="muted">Loading...</p>;

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
