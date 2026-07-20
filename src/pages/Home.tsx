import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import { ensureEpisodesCached, findNextUnwatched, countAdditionalUnwatched, findNextUpcoming } from "../lib/episodeSync";
import { daysSince, getStaleDaysThreshold } from "../lib/showStatus";
import { markNextEpisodeWatched, lastProgressionAt } from "../lib/watchEvents";
import { useIsMobile } from "../lib/useIsMobile";
import DetailsPanel from "../components/DetailsPanel";

type Category = "watch-next" | "stale" | "not-started";

interface Row {
  showId: number;
  showName: string;
  posterPath: string | null;
  nextEpisode: Episode | null; // for not-started: the first episode to start with; for in-progress: the next unseen one. Null when nothing is cached yet.
  additionalCount: number; // the "+N" badge
  lastProgressedAt: string | null; // most recent first-watch of an unseen episode; drives the split AND the sort
  addedAt: string; // for ordering the "Haven't Yet Started" list (recently added first)
  category: Category;
}

/**
 * The three mutually-exclusive Home categories, driven purely by real watch
 * data (not the imported tvTimeStatus snapshot, which goes stale the moment
 * you watch anything in-app):
 *
 * - "not-started": zero watch activity ever. A show added to the library
 *   but never begun. Its own section so a long watchlist doesn't crowd out
 *   shows you're actually mid-way through.
 * - "watch-next": at least one episode watched AND a next UNSEEN released
 *   episode exists AND the last PROGRESSION is within the threshold. In
 *   progress and active.
 * - "stale": same as watch-next but the last progression is older than the
 *   threshold. Started, then genuinely dropped for a while.
 * - null (not shown): watched at least one episode but no next unseen
 *   episode remains, i.e. caught up / finished. Rewatching an old episode
 *   updates history/time/recency but must NEVER resurface the show here:
 *   "next" is always the next UNSEEN episode in original progression, never
 *   "the episode after a rewatch". A finished series simply stays off all
 *   three lists.
 *
 * CRITICAL: the split uses last PROGRESSION (the most recent first-watch of
 * a previously-unseen episode), NOT last activity. Rewatching already-seen
 * episodes of a stalled show must not drag it back into Watch Next — only
 * watching the next NEW episode counts as resuming. lastProgressedAt is
 * max(WatchedEpisode.watchedAt), which a rewatch never changes.
 *
 * The tvTimeStatus === "continuing" clause was deliberately dropped: it
 * could force a finished show (all cached episodes watched, next === null)
 * back onto Watch Next via a stale imported flag, which is exactly the
 * rewatch-resurfacing this spec forbids.
 */
function categorize(next: Episode | null, watchedCount: number, lastProgressedAt: string | null, threshold: number): Category | null {
  if (watchedCount === 0) return "not-started";
  if (next === null) return null; // caught up / finished; rewatches don't bring it back
  return (daysSince(lastProgressedAt) ?? 0) < threshold ? "watch-next" : "stale";
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
            <p className="muted small wn-episode-name">{row.nextEpisode.name}</p>
            {isPremiere && <span className="premiere-tag">PREMIERE</span>}
          </>
        ) : (
          <p className="muted small">
            {row.category === "not-started"
              ? "Not started yet"
              : "More to watch (couldn't match the exact next episode against TMDB)"}
          </p>
        )}
      </div>
      <button
        className="watch-toggle-circle"
        onClick={() => onMarkWatched(row)}
        aria-label={row.category === "not-started" ? "Start watching" : "Mark watched"}
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
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [tab, setTab] = useState<"next" | "stale" | "not-started">("next");

  // Network side effect: make sure TMDB episode lists are cached for every
  // followed show. Writes to db.episodes, which allEpisodes above reacts to,
  // so newly-synced seasons flow into the computation below automatically
  // as they arrive, not just once at the end.
  //
  // Each show is wrapped in its own try/catch: ensureEpisodesCached had no
  // error handling before, so a single failure (a TMDB rate limit, a
  // network hiccup, a show TMDB has no data for) threw inside the loop and
  // silently stopped every show queued after it from ever being synced in
  // that session. For a small library that's rarely noticeable, for ~190
  // shows imported at once it meant most of the list could go permanently
  // unsynced from one bad show. Failures are now collected and surfaced
  // instead of aborting the whole batch.
  useEffect(() => {
    if (!shows) return;
    let cancelled = false;
    async function sync() {
      setSyncing(true);
      setSyncErrors([]);
      const failures: string[] = [];
      for (const show of shows!) {
        if (cancelled) return;
        try {
          await ensureEpisodesCached(show.tmdbId);
        } catch (e) {
          failures.push(`${show.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!cancelled) {
        setSyncing(false);
        setSyncErrors(failures);
      }
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
    const watchedByShow = new Map<number, typeof allWatched>();
    for (const w of allWatched) {
      const list = watchedByShow.get(w.showId);
      if (list) list.push(w);
      else watchedByShow.set(w.showId, [w]);
    }

    const staleThreshold = getStaleDaysThreshold();
    const result: Row[] = [];
    for (const show of shows) {
      const episodes = episodesByShow.get(show.tmdbId) ?? [];
      const watched = watchedByShow.get(show.tmdbId) ?? [];
      const watchedKeys = new Set(watched.map((w) => w.key));
      // next = the first UNSEEN released episode in original progression.
      // For a never-started show this is the first episode (the one to
      // begin with); for an in-progress show it's the genuine next up.
      // Rewatches never enter this: watched episodes stay in watchedKeys,
      // so "next" only ever moves forward through unseen episodes.
      const next = findNextUnwatched(episodes, watchedKeys);
      // Split by last PROGRESSION, not last activity: a rewatch never
      // changes watchedAt, so rewatching a stalled show leaves this stuck
      // in the past and the show stays under "Haven't Watched For a While".
      const lastProgressedAt = lastProgressionAt(watched);
      const category = categorize(next, watchedKeys.size, lastProgressedAt, staleThreshold);
      if (category === null) continue; // caught up / finished

      result.push({
        showId: show.tmdbId,
        showName: show.name,
        posterPath: show.posterPath,
        nextEpisode: next,
        additionalCount: next ? countAdditionalUnwatched(episodes, watchedKeys) : 0,
        lastProgressedAt,
        addedAt: show.addedAt,
        category,
      });
    }
    return result;
  }, [shows, allEpisodes, allWatched]);

  async function markWatched(row: Row) {
    if (!row.nextEpisode) return;
    // Marks the next UNSEEN episode watched (starts a not-started show, or
    // advances an in-progress one). Never a rewatch: Watch Next only ever
    // points at unseen episodes now, so this always creates a fresh record.
    await markNextEpisodeWatched(row.showId, row.nextEpisode);
  }

  if (!shows || !allEpisodes || !allWatched) return <p className="muted">Loading...</p>;

  // Three MUTUALLY EXCLUSIVE lists (see categorize() above). Watch Next and
  // the stale list sort by most recent PROGRESSION (rewatches don't reorder
  // them); Haven't Yet Started sorts by most recently added to the library.
  const byRecency = (a: Row, b: Row) => (b.lastProgressedAt ?? "").localeCompare(a.lastProgressedAt ?? "");
  const watchNext = rows.filter((r) => r.category === "watch-next").sort(byRecency);
  const stale = rows.filter((r) => r.category === "stale").sort(byRecency);
  const notStarted = rows.filter((r) => r.category === "not-started").sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
  const activeList = tab === "next" ? watchNext : tab === "stale" ? stale : notStarted;

  return (
    <>
      <div className="pill-tabs">
        <button className={`pill-tab ${tab === "next" ? "active" : ""}`} onClick={() => setTab("next")}>
          Watch Next{watchNext.length > 0 ? ` (${watchNext.length})` : ""}
        </button>
        <button className={`pill-tab ${tab === "stale" ? "active" : ""}`} onClick={() => setTab("stale")}>
          Haven't Watched For a While{stale.length > 0 ? ` (${stale.length})` : ""}
        </button>
        <button
          className={`pill-tab ${tab === "not-started" ? "active" : ""}`}
          onClick={() => setTab("not-started")}
        >
          Haven't Yet Started{notStarted.length > 0 ? ` (${notStarted.length})` : ""}
        </button>
      </div>

      {syncing && <p className="muted small">Syncing episode data from TMDB...</p>}

      {!syncing && syncErrors.length > 0 && (
        <details className="status-error" style={{ marginBottom: 10 }}>
          <summary>{syncErrors.length} show(s) failed to sync from TMDB, they may be missing from the lists below</summary>
          <ul>
            {syncErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </details>
      )}

      {activeList.length === 0 && !syncing && (
        <p className="muted">
          {tab === "next"
            ? "Nothing queued up. If you're sure some shows should be here, check Diagnostics in Settings, or re-import using the newer TV Time export format."
            : tab === "stale"
              ? "Nothing here, everything you've started has been watched recently."
              : "Nothing here, every show in your library has been started."}
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

function formatUpcomingDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface UpcomingEpisodeRow {
  showId: number;
  showName: string;
  posterPath: string | null;
  episode: Episode;
}

/**
 * Upcoming episodes (confirmed future air_date, across followed shows) and
 * movies releasing this calendar month (from Movie.releaseDate, backfilled
 * by useShowStats/useMovieStats for libraries that predate that field).
 * Deliberately reuses data already loaded elsewhere on Home rather than
 * issuing new network requests, this only reads db.episodes, which
 * ShowsHome's sync effect already keeps populated for every followed show.
 */
function ComingUp({ onOpenShow }: { onOpenShow: (tmdbId: number) => void }) {
  const shows = useLiveQuery(() => db.shows.filter((s) => s.isFollowed && !s.isArchived).toArray(), []);
  const allEpisodes = useLiveQuery(() => db.episodes.toArray(), []);
  const movies = useLiveQuery(() => db.movies.toArray(), []);
  const [openMovie, setOpenMovie] = useState<number | null>(null);

  const upcomingEpisodes = useMemo<UpcomingEpisodeRow[]>(() => {
    if (!shows || !allEpisodes) return [];
    const episodesByShow = new Map<number, Episode[]>();
    for (const ep of allEpisodes) {
      const list = episodesByShow.get(ep.showId);
      if (list) list.push(ep);
      else episodesByShow.set(ep.showId, [ep]);
    }
    const rows: UpcomingEpisodeRow[] = [];
    for (const show of shows) {
      const next = findNextUpcoming(episodesByShow.get(show.tmdbId) ?? []);
      if (next) rows.push({ showId: show.tmdbId, showName: show.name, posterPath: show.posterPath, episode: next });
    }
    rows.sort((a, b) => (a.episode.airDate as string).localeCompare(b.episode.airDate as string));
    return rows.slice(0, 6);
  }, [shows, allEpisodes]);

  const releasingThisMonth = useMemo(() => {
    if (!movies) return [];
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEndExclusive = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
    return movies
      .filter((m) => m.releaseDate && m.releaseDate >= monthStart && m.releaseDate < monthEndExclusive)
      .sort((a, b) => (a.releaseDate as string).localeCompare(b.releaseDate as string))
      .slice(0, 6);
  }, [movies]);

  if (!shows || !allEpisodes || !movies) return null;
  if (upcomingEpisodes.length === 0 && releasingThisMonth.length === 0) return null;

  return (
    <>
      <h3 className="section-title">Coming up</h3>
      <div className="coming-up-cols">
        <div className="coming-up-col">
          <p className="muted small coming-up-col-label">Upcoming episodes</p>
          {upcomingEpisodes.length === 0 && <p className="muted small">Nothing confirmed yet.</p>}
          {upcomingEpisodes.map((row) => (
            <div
              key={row.showId}
              className="up-row"
              role="button"
              tabIndex={0}
              onClick={() => onOpenShow(row.showId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenShow(row.showId);
                }
              }}
            >
              {row.posterPath ? (
                <img src={`${TMDB_IMAGE_BASE}${row.posterPath}`} alt="" className="up-row-poster" />
              ) : (
                <div className="poster-placeholder up-row-poster" />
              )}
              <div className="up-row-body">
                <p className="show-name">{row.showName}</p>
                <p className="muted small">
                  S{String(row.episode.seasonNumber).padStart(2, "0")} | E
                  {String(row.episode.episodeNumber).padStart(2, "0")}
                </p>
              </div>
              <span className="up-row-date">{formatUpcomingDate(row.episode.airDate)}</span>
            </div>
          ))}
        </div>
        <div className="coming-up-col">
          <p className="muted small coming-up-col-label">Releasing this month</p>
          {releasingThisMonth.length === 0 && <p className="muted small">Nothing this month.</p>}
          {releasingThisMonth.map((m) => (
            <div
              key={m.tmdbId}
              className="up-row"
              role="button"
              tabIndex={0}
              onClick={() => setOpenMovie(m.tmdbId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenMovie(m.tmdbId);
                }
              }}
            >
              {m.posterPath ? (
                <img src={`${TMDB_IMAGE_BASE}${m.posterPath}`} alt="" className="up-row-poster" />
              ) : (
                <div className="poster-placeholder up-row-poster" />
              )}
              <div className="up-row-body">
                <p className="show-name">{m.title}</p>
                <p className="muted small">{m.wantsToWatch ? "Want to watch" : "\u00a0"}</p>
              </div>
              <span className="up-row-date">{formatUpcomingDate(m.releaseDate ?? null)}</span>
            </div>
          ))}
        </div>
      </div>
      {openMovie !== null && <DetailsPanel kind="movie" tmdbId={openMovie} onClose={() => setOpenMovie(null)} />}
    </>
  );
}

const MTW_CARD_WIDTH = 120;
const MTW_GAP = 14;
// Mobile doesn't measure: it shows a capped, horizontally scrollable strip
// of up to 5 movies, with the view-all tile as the 6th card.
const MTW_MOBILE_MAX = 5;

function MoviesHome({ onViewAll }: { onViewAll: () => void }) {
  const wantToWatch = useLiveQuery(() => db.movies.filter((m) => !m.watched && m.wantsToWatch).toArray(), []);
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [fitCount, setFitCount] = useState(5); // sensible default before the first real measurement

  // Most recently added first, the same comparator as the Movies page's
  // "Recently added" sort: movies from before addedAt existed have it
  // undefined and deliberately sort as oldest.
  const sorted = useMemo(
    () =>
      wantToWatch ? [...wantToWatch].sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? "")) : undefined,
    [wantToWatch]
  );

  // Real dynamic fit: measure the rail's actual rendered width (which
  // itself depends on the app shell, the side rail, and the viewport, not
  // just the viewport alone) and compute how many fixed-width cards
  // physically fit, no scrollbar needed. Recomputes on any resize via
  // ResizeObserver.
  //
  // The dependency below is the fix for the rail never filling wide
  // screens: the rail div only exists in the DOM once the query has
  // resolved AND is non-empty. With [] deps this effect ran exactly once,
  // on mount, against a still-null ref, so the observer never attached
  // and fitCount sat at its default forever regardless of window width.
  const railRendered = (sorted?.length ?? 0) > 0;
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    function recompute() {
      const width = el!.clientWidth;
      const count = Math.max(1, Math.floor((width + MTW_GAP) / (MTW_CARD_WIDTH + MTW_GAP)));
      setFitCount(count);
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [railRendered]);

  if (!sorted) return <p className="muted">Loading...</p>;

  async function markWatched(tmdbId: number) {
    await db.movies.update(tmdbId, { watched: true, watchedAt: new Date().toISOString() });
  }

  const hasMore = sorted.length > (isMobile ? MTW_MOBILE_MAX : fitCount);
  // Desktop: if there's overflow, the last fitting slot becomes the "View
  // all" tile instead of a movie card, so movies + tile together still
  // exactly fill the measured width. Mobile: fixed cap of 5 movies, the
  // view-all tile rides along as a 6th card in the scrollable strip.
  const visible = isMobile
    ? sorted.slice(0, MTW_MOBILE_MAX)
    : sorted.slice(0, hasMore ? Math.max(1, fitCount - 1) : fitCount);

  return (
    <>
      <h3 className="section-title">Movies to Watch</h3>

      {sorted.length === 0 ? (
        <p className="muted">Nothing on your movie watchlist right now.</p>
      ) : (
        <div className="mtw-rail" ref={railRef}>
          {visible.map((m) => (
            <div key={m.tmdbId} className="mtw-card">
              {m.posterPath ? (
                <img
                  className="mtw-poster"
                  src={`${TMDB_IMAGE_BASE}${m.posterPath}`}
                  alt={m.title}
                  onClick={() => setOpenDetails(m.tmdbId)}
                />
              ) : (
                <div className="poster-placeholder mtw-poster" onClick={() => setOpenDetails(m.tmdbId)} />
              )}
              {/* Single-line ellipsis title (see .mtw-name), so the button
                  below sits at the same height on every card; the full
                  title is still available as a hover tooltip. */}
              <p className="show-name mtw-name" title={m.title} onClick={() => setOpenDetails(m.tmdbId)}>
                {m.title}
              </p>
              <button onClick={() => markWatched(m.tmdbId)}>Mark watched</button>
            </div>
          ))}
          {hasMore && (
            <div className="mtw-card">
              <button type="button" className="mtw-view-all-tile" onClick={onViewAll} aria-label="View all movies to watch">
                <span className="mtw-view-all-count">+{sorted.length - visible.length}</span>
                <span>View all</span>
                <span aria-hidden="true">&rsaquo;</span>
              </button>
            </div>
          )}
        </div>
      )}
      {openDetails !== null && <DetailsPanel kind="movie" tmdbId={openDetails} onClose={() => setOpenDetails(null)} />}
    </>
  );
}

export default function Home({ onViewAllMovies }: { onViewAllMovies: () => void }) {
  const [openShow, setOpenShow] = useState<number | null>(null);

  return (
    <div className="panel">
      <ShowsHome onOpenShow={setOpenShow} />

      <MoviesHome onViewAll={onViewAllMovies} />

      <ComingUp onOpenShow={setOpenShow} />

      {openShow !== null && <DetailsPanel kind="show" tmdbId={openShow} onClose={() => setOpenShow(null)} />}
    </div>
  );
}
