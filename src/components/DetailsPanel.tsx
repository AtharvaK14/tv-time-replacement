import { useEffect, useState } from "react";
import { db, type Episode } from "../db";
import { getTvShowDetails, getMovieDetails, TMDB_IMAGE_BASE, TMDB_BACKDROP_BASE } from "../tmdb";
import { getOmdbRatings, hasOmdbKey, type OmdbRatings } from "../omdb";
import { averageRuntime } from "../lib/runtime";
import { getSeasonNumbers, ensureSeasonCached } from "../lib/episodeSync";
import { useDraggableSheet } from "../lib/useDraggableSheet";
import { useLockBodyScroll } from "../lib/useLockBodyScroll";
import { useIsMobile } from "../lib/useIsMobile";
import EpisodeDetailsPanel from "./EpisodeDetailsPanel";

interface Props {
  kind: "show" | "movie";
  tmdbId: number;
  onClose: () => void;
}

interface CoreDetails {
  name: string;
  posterPath: string | null;
  backdropPath: string | null; // horizontal image, used unblurred in the mobile hero when TMDB has one
  releaseDate: string | null;
  overview: string | null;
  status?: string; // shows only
  numberOfSeasons?: number; // shows only
  episodeRuntimeMinutes?: number | null; // shows only
  runtimeMinutes?: number | null; // movies only
  imdbId?: string | null;
  genres: string[];
}

/** Release year / genres / season count / status, shared by both the
 * desktop header (next to the poster) and the mobile header (below the
 * hero banner), so the two render paths never drift out of sync on what
 * they display. */
function MetaLine({ details }: { details: CoreDetails }) {
  return (
    <>
      {details.releaseDate ? details.releaseDate.slice(0, 4) : "Release date unknown"}
      {details.genres.length > 0 ? ` \u00b7 ${details.genres.join(", ")}` : ""}
      {details.numberOfSeasons
        ? ` \u00b7 ${details.numberOfSeasons} season${details.numberOfSeasons === 1 ? "" : "s"}`
        : ""}
      {details.status ? ` \u00b7 ${details.status}` : ""}
    </>
  );
}

export default function DetailsPanel({ kind, tmdbId, onClose }: Props) {
  // This component is only ever mounted while its modal is open (callers
  // use `{openDetails !== null && <DetailsPanel .../>}`), so it's safe to
  // call these unconditionally, they mount/unmount together with the panel.
  // useLockBodyScroll applies on BOTH mobile and desktop, that bug wasn't
  // mobile-specific. useDraggableSheet's output is only wired into the
  // JSX on the mobile render path below, it's inert otherwise.
  useLockBodyScroll();
  const { sheetStyle, handleProps } = useDraggableSheet(onClose);
  const isMobile = useIsMobile();

  const [details, setDetails] = useState<CoreDetails | null>(null);
  const [ratings, setRatings] = useState<OmdbRatings | null | "loading">("loading");
  const [inLibrary, setInLibrary] = useState(false);
  const [added, setAdded] = useState(false);
  const [removeConfirming, setRemoveConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seasonNumbers, setSeasonNumbers] = useState<number[] | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [episodesInDb, setEpisodesInDb] = useState<Episode[]>([]);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [openEpisode, setOpenEpisode] = useState<Episode | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (kind === "show") {
          const d = await getTvShowDetails(tmdbId);
          if (cancelled) return;
          setDetails({
            name: d.name,
            posterPath: d.poster_path,
            backdropPath: d.backdrop_path,
            releaseDate: d.first_air_date,
            overview: d.overview,
            status: d.status,
            numberOfSeasons: d.number_of_seasons,
            episodeRuntimeMinutes: averageRuntime(d.episode_run_time),
            imdbId: d.external_ids?.imdb_id ?? null,
            genres: d.genres.map((g) => g.name),
          });
          const existing = await db.shows.get(tmdbId);
          setInLibrary(!!existing);
          const nums = await getSeasonNumbers(tmdbId);
          if (!cancelled) setSeasonNumbers(nums);
          if (existing) {
            await refreshWatchedAndEpisodes();
          }
          if (hasOmdbKey()) {
            const r = await getOmdbRatings({
              imdbId: d.external_ids?.imdb_id,
              title: d.name,
              year: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
            });
            if (!cancelled) setRatings(r);
          } else {
            setRatings(null);
          }
        } else {
          const d = await getMovieDetails(tmdbId);
          if (cancelled) return;
          setDetails({
            name: d.title,
            posterPath: d.poster_path,
            backdropPath: d.backdrop_path,
            releaseDate: d.release_date,
            overview: d.overview,
            runtimeMinutes: d.runtime,
            imdbId: d.external_ids?.imdb_id ?? null,
            genres: d.genres.map((g) => g.name),
          });
          const existing = await db.movies.get(tmdbId);
          setInLibrary(!!existing);
          if (hasOmdbKey()) {
            const r = await getOmdbRatings({
              imdbId: d.external_ids?.imdb_id,
              title: d.title,
              year: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
            });
            if (!cancelled) setRatings(r);
          } else {
            setRatings(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tmdbId]);

  async function refreshWatchedAndEpisodes() {
    const [eps, watched] = await Promise.all([
      db.episodes.where("showId").equals(tmdbId).toArray(),
      db.watchedEpisodes.where("showId").equals(tmdbId).toArray(),
    ]);
    setEpisodesInDb(eps);
    setWatchedKeys(new Set(watched.map((w) => w.key)));
  }

  async function toggleExpand(seasonNumber: number) {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }
    setExpandedSeason(seasonNumber);
    if (!episodesInDb.some((e) => e.seasonNumber === seasonNumber)) {
      setLoadingSeason(seasonNumber);
      await ensureSeasonCached(tmdbId, seasonNumber);
      await refreshWatchedAndEpisodes();
      setLoadingSeason(null);
    }
  }

  const [catchUpOffer, setCatchUpOffer] = useState<
    | { kind: "episodes"; episodes: Episode[]; count: number }
    | { kind: "seasons"; seasonNumbers: number[] }
    | null
  >(null);

  async function markEpisodesWatched(eps: Episode[]) {
    await db.watchedEpisodes.bulkPut(
      eps.map((ep) => ({
        key: ep.key,
        showId: ep.showId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        watchedAt: new Date().toISOString(),
        watchCount: 1,
      }))
    );
    await refreshWatchedAndEpisodes();
  }

  async function toggleEpisodeWatched(ep: Episode) {
    if (!inLibrary) return;
    if (watchedKeys.has(ep.key)) {
      await db.watchedEpisodes.delete(ep.key);
      setCatchUpOffer(null);
      return;
    }
    await markEpisodesWatched([ep]);

    const seasonEps = episodesBySeason.get(ep.seasonNumber) ?? [];
    const earlierUnwatched = seasonEps.filter((e) => e.episodeNumber < ep.episodeNumber && !watchedKeys.has(e.key));
    setCatchUpOffer(earlierUnwatched.length > 0 ? { kind: "episodes", episodes: earlierUnwatched, count: earlierUnwatched.length } : null);
  }

  async function toggleSeasonWatched(seasonEpisodes: Episode[], markWatched: boolean) {
    if (!inLibrary) return;
    if (markWatched) {
      await markEpisodesWatched(seasonEpisodes);
      const thisSeason = seasonEpisodes[0]?.seasonNumber;
      const earlierSeasons = seasonNumbers?.filter((n) => n < thisSeason) ?? [];
      setCatchUpOffer(earlierSeasons.length > 0 ? { kind: "seasons", seasonNumbers: earlierSeasons } : null);
    } else {
      await db.watchedEpisodes.bulkDelete(seasonEpisodes.map((ep) => ep.key));
      setCatchUpOffer(null);
    }
  }

  async function acceptCatchUp() {
    if (!catchUpOffer) return;
    if (catchUpOffer.kind === "episodes") {
      await markEpisodesWatched(catchUpOffer.episodes);
    } else {
      for (const seasonNumber of catchUpOffer.seasonNumbers) {
        await ensureSeasonCached(tmdbId, seasonNumber);
      }
      await refreshWatchedAndEpisodes();
      const freshEpisodes = await db.episodes.where("showId").equals(tmdbId).toArray();
      const toMark = freshEpisodes.filter((e) => catchUpOffer.seasonNumbers.includes(e.seasonNumber));
      await markEpisodesWatched(toMark);
    }
    setCatchUpOffer(null);
  }

  async function handleAdd() {
    if (!details) return;
    if (kind === "show") {
      await db.shows.put({
        tmdbId,
        name: details.name,
        posterPath: details.posterPath,
        firstAirYear: details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null,
        status: details.status ?? "",
        addedAt: new Date().toISOString(),
        isFollowed: true,
        isArchived: false,
        lastWatchedAt: null,
        episodeRuntimeMinutes: details.episodeRuntimeMinutes ?? null,
        imdbId: details.imdbId ?? null,
      });
      await refreshWatchedAndEpisodes();
    } else {
      await db.movies.put({
        tmdbId,
        title: details.name,
        posterPath: details.posterPath,
        releaseYear: details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null,
        watched: false,
        watchedAt: null,
        wantsToWatch: true,
        runtimeMinutes: details.runtimeMinutes ?? null,
        imdbId: details.imdbId ?? null,
      });
    }
    setInLibrary(true);
    setAdded(true);
  }

  async function handleRemove() {
    if (kind === "show") {
      await db.watchedEpisodes.where("showId").equals(tmdbId).delete();
      await db.episodes.where("showId").equals(tmdbId).delete();
      await db.shows.delete(tmdbId);
    } else {
      await db.movies.delete(tmdbId);
    }
    setInLibrary(false);
    setAdded(false);
    setRemoveConfirming(false);
  }

  const episodesBySeason = new Map<number, Episode[]>();
  for (const ep of episodesInDb) {
    const list = episodesBySeason.get(ep.seasonNumber);
    if (list) list.push(ep);
    else episodesBySeason.set(ep.seasonNumber, [ep]);
  }
  for (const list of episodesBySeason.values()) list.sort((a, b) => a.episodeNumber - b.episodeNumber);

  const showsSeasonBrowser = kind === "show" && seasonNumbers !== null;

  const ratingsRowContent = details && (
    <div className="ratings-row">
      {ratings === "loading" && hasOmdbKey() && <span className="muted small">Loading ratings...</span>}
      {ratings && ratings !== "loading" && (
        <>
          {ratings.imdbRating && <span className="rating-pill">IMDb {ratings.imdbRating}</span>}
          {ratings.rottenTomatoes && <span className="rating-pill">RT {ratings.rottenTomatoes}</span>}
          {!ratings.imdbRating && !ratings.rottenTomatoes && (
            <span className="muted small">
              {ratings.error ? `OMDb: ${ratings.error}` : "No ratings found for this title on OMDb."}
            </span>
          )}
        </>
      )}
      {!hasOmdbKey() && <span className="muted small">Add an OMDb key in Settings to see IMDb/RT ratings.</span>}
    </div>
  );

  const addRemoveContent = details && (
    <>
      {inLibrary ? (
        <>
          <p className="status-ok">
            {added ? `Added to your ${kind === "show" ? "Shows" : "Movies"}.` : `Already in your ${kind === "show" ? "Shows" : "Movies"}.`}
          </p>
          {!removeConfirming ? (
            <button className="danger-button" onClick={() => setRemoveConfirming(true)}>
              Remove from {kind === "show" ? "Shows" : "Movies"}
            </button>
          ) : (
            <div className="field-row">
              <span className="muted small">
                Also deletes {kind === "show" ? "its watch history" : "its watched status"}. No undo.
              </span>
              <button className="danger-button" onClick={handleRemove}>
                Confirm remove
              </button>
              <button onClick={() => setRemoveConfirming(false)}>Cancel</button>
            </div>
          )}
        </>
      ) : (
        <button onClick={handleAdd}>{kind === "show" ? "Add to Shows" : "Add to Movies"}</button>
      )}
    </>
  );

  const overviewContent = details && (
    <p className="overview">
      {details.overview || (ratings !== "loading" && ratings?.plot) || "No summary available."}
    </p>
  );

  // Mobile keeps the original single-column composition: ratings, then the
  // add/remove action, then overview. Desktop (below) recomposes the same
  // three pieces into its own header/sidebar/main-column layout instead of
  // duplicating this JSX.
  const bodyContent = details && (
    <>
      {ratingsRowContent}
      {addRemoveContent}
      {overviewContent}
    </>
  );

  const seasonBrowserBlock = showsSeasonBrowser && (
    <div className="season-browser">
      {!inLibrary && (
        <p className="muted small" style={{ marginBottom: 10 }}>
          Previewing seasons and episodes. Add this show to your Shows to start tracking what you've watched.
        </p>
      )}
      {catchUpOffer && (
        <div className="catch-up-offer">
          <span>
            {catchUpOffer.kind === "episodes"
              ? `Also mark the ${catchUpOffer.count} episode${catchUpOffer.count === 1 ? "" : "s"} before this one (in this season) as watched?`
              : `Also mark all ${catchUpOffer.seasonNumbers.length} earlier season${catchUpOffer.seasonNumbers.length === 1 ? "" : "s"} as fully watched?`}
          </span>
          <div className="field-row">
            <button onClick={acceptCatchUp}>Yes, catch up</button>
            <button onClick={() => setCatchUpOffer(null)}>No, just this one</button>
          </div>
        </div>
      )}
      {seasonNumbers!.map((seasonNumber) => {
        const isExpanded = expandedSeason === seasonNumber;
        const eps = episodesBySeason.get(seasonNumber) ?? [];
        const watchedCount = eps.filter((e) => watchedKeys.has(e.key)).length;
        const allWatched = eps.length > 0 && watchedCount === eps.length;

        return (
          <div key={seasonNumber} className="season-block">
            <div className="season-header season-toggle" onClick={() => toggleExpand(seasonNumber)}>
              <h3>
                <span className={`season-caret ${isExpanded ? "open" : ""}`}>&#9656;</span> Season{" "}
                {seasonNumber}
              </h3>
              <div className="season-header-right">
                {inLibrary && eps.length > 0 && (
                  <span className="muted small">
                    {watchedCount}/{eps.length}
                  </span>
                )}
                {inLibrary && isExpanded && eps.length > 0 && (
                  <button
                    className="link-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSeasonWatched(eps, !allWatched);
                    }}
                  >
                    {allWatched ? "Mark unwatched" : "Mark watched"}
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <>
                {loadingSeason === seasonNumber && <p className="muted small">Fetching episodes...</p>}
                <ul className="episode-list">
                  {eps.map((ep) => (
                    <li key={ep.key} className={`episode-row ${watchedKeys.has(ep.key) ? "watched" : ""}`}>
                      {ep.stillPath ? (
                        <img
                          src={`${TMDB_IMAGE_BASE}${ep.stillPath}`}
                          alt=""
                          className="episode-thumb"
                          onClick={() => setOpenEpisode(ep)}
                        />
                      ) : (
                        <div className="episode-thumb poster-placeholder" onClick={() => setOpenEpisode(ep)} />
                      )}
                      <div className="episode-row-body" onClick={() => setOpenEpisode(ep)}>
                        <span className="ep-number">
                          S{ep.seasonNumber} | E{ep.episodeNumber}
                        </span>
                        <span className="ep-name">{ep.name}</span>
                      </div>
                      {inLibrary && (
                        <button
                          className={`watch-toggle ${watchedKeys.has(ep.key) ? "on" : ""}`}
                          onClick={() => toggleEpisodeWatched(ep)}
                          aria-label={watchedKeys.has(ep.key) ? "Mark unwatched" : "Mark watched"}
                        >
                          &#10003;
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  const episodeDetailsModal = openEpisode && details && (
    <EpisodeDetailsPanel
      show={{ name: details.name, imdbId: details.imdbId }}
      episode={openEpisode}
      watched={watchedKeys.has(openEpisode.key)}
      canToggleWatched={inLibrary}
      onToggleWatched={async () => {
        await toggleEpisodeWatched(openEpisode);
        setOpenEpisode(null);
      }}
      onClose={() => setOpenEpisode(null)}
    />
  );

  if (isMobile) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className={`details-sheet ${showsSeasonBrowser ? "details-modal-wide" : ""}`}
          style={sheetStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sheet-drag-handle" {...handleProps}>
            <div className="sheet-drag-handle-bar" />
          </div>

          <button className="close-x hero-close-x" onClick={onClose} aria-label="Close">
            &times;
          </button>

          <div className="sheet-scroll-area">
            {error && <p className="status-error">{error}</p>}
            {!details && !error && <p className="muted">Loading...</p>}

            {details && (
              <>
                <div className={`details-hero ${details.backdropPath ? "centered" : ""}`}>
                  {details.backdropPath ? (
                    // Real horizontal image from TMDB, shown sharp, no blur needed.
                    <img
                      src={`${TMDB_BACKDROP_BASE}${details.backdropPath}`}
                      alt=""
                      className="details-hero-bg-sharp"
                    />
                  ) : (
                    // No backdrop for this title (uncommon but happens), fall back to
                    // the vertical poster, blurred since it's the wrong aspect ratio
                    // to show sharp as a wide banner.
                    details.posterPath && (
                      <div
                        className="details-hero-bg-blurred"
                        style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}${details.posterPath})` }}
                      />
                    )
                  )}
                  <div className="details-hero-scrim" />
                  <h2 className="details-hero-title">{details.name}</h2>
                </div>

                <p className="muted small details-meta-line">
                  <MetaLine details={details} />
                </p>

                <div className="details-body">{bodyContent}</div>

                {seasonBrowserBlock}
              </>
            )}
          </div>
        </div>

        {episodeDetailsModal}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal details-modal-desktop ${showsSeasonBrowser ? "details-modal-desktop-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {error && <p className="status-error">{error}</p>}
        {!details && !error && <p className="muted">Loading...</p>}

        {details && (
          <>
            <div className="desktop-hero">
              {details.backdropPath ? (
                <img
                  src={`${TMDB_BACKDROP_BASE}${details.backdropPath}`}
                  alt=""
                  className="details-hero-bg-sharp"
                />
              ) : (
                details.posterPath && (
                  <div
                    className="details-hero-bg-blurred"
                    style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}${details.posterPath})` }}
                  />
                )
              )}
              <div className="details-hero-scrim" />
              <button className="desktop-hero-close-x" onClick={onClose} aria-label="Close">
                &times;
              </button>
            </div>

            <div className="desktop-header-row">
              {details.posterPath ? (
                <img src={`${TMDB_IMAGE_BASE}${details.posterPath}`} alt={details.name} className="desktop-poster-card" />
              ) : (
                <div className="poster-placeholder desktop-poster-card" />
              )}
              <div className="desktop-header-text">
                <h2>{details.name}</h2>
                <p className="muted small">
                  <MetaLine details={details} />
                </p>
              </div>
            </div>

            <div className="desktop-two-col">
              <div className="desktop-overview-col">{overviewContent}</div>
              <div className="desktop-sidebar-col">
                {ratingsRowContent}
                {addRemoveContent}
              </div>
            </div>

            {seasonBrowserBlock}
          </>
        )}
      </div>

      {episodeDetailsModal}
    </div>
  );
}