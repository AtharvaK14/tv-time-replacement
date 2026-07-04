import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import { getSeasonNumbers, ensureSeasonCached } from "../lib/episodeSync";
import EpisodeDetailsPanel from "../components/EpisodeDetailsPanel";

export default function ShowDetail({ tmdbId, onBack }: { tmdbId: number; onBack: () => void }) {
  const show = useLiveQuery(() => db.shows.get(tmdbId), [tmdbId]);
  const watched = useLiveQuery(() => db.watchedEpisodes.where("showId").equals(tmdbId).toArray(), [tmdbId]);
  const episodesInDb = useLiveQuery(() => db.episodes.where("showId").equals(tmdbId).toArray(), [tmdbId]);

  const [seasonNumbers, setSeasonNumbers] = useState<number[] | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [openEpisode, setOpenEpisode] = useState<Episode | null>(null);

  // Just the season number list, cheap, doesn't pull every episode up front.
  useEffect(() => {
    let cancelled = false;
    getSeasonNumbers(tmdbId).then((nums) => {
      if (!cancelled) setSeasonNumbers(nums);
    });
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  if (!show) return <p className="muted">Loading...</p>;

  const watchedKeys = new Set((watched ?? []).map((w) => w.key));
  const episodesBySeason = new Map<number, Episode[]>();
  for (const ep of episodesInDb ?? []) {
    const list = episodesBySeason.get(ep.seasonNumber);
    if (list) list.push(ep);
    else episodesBySeason.set(ep.seasonNumber, [ep]);
  }
  for (const list of episodesBySeason.values()) list.sort((a, b) => a.episodeNumber - b.episodeNumber);

  async function toggleExpand(seasonNumber: number) {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null);
      return;
    }
    setExpandedSeason(seasonNumber);
    if (!episodesBySeason.has(seasonNumber)) {
      setLoadingSeason(seasonNumber);
      await ensureSeasonCached(tmdbId, seasonNumber);
      setLoadingSeason(null);
    }
  }

  async function toggleEpisode(ep: Episode) {
    if (watchedKeys.has(ep.key)) {
      await db.watchedEpisodes.delete(ep.key);
    } else {
      await db.watchedEpisodes.put({
        key: ep.key,
        showId: ep.showId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        watchedAt: new Date().toISOString(),
      });
    }
  }

  async function toggleSeason(seasonEpisodes: Episode[], markWatched: boolean) {
    if (markWatched) {
      await db.watchedEpisodes.bulkPut(
        seasonEpisodes.map((ep) => ({
          key: ep.key,
          showId: ep.showId,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          watchedAt: new Date().toISOString(),
        }))
      );
    } else {
      await db.watchedEpisodes.bulkDelete(seasonEpisodes.map((ep) => ep.key));
    }
  }

  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}>
        &larr; Shows
      </button>
      <div className="show-header">
        {show.posterPath && <img src={`${TMDB_IMAGE_BASE}${show.posterPath}`} alt={show.name} />}
        <div>
          <h2>{show.name}</h2>
          <p className="muted">
            {show.status} &middot; {watched?.length ?? 0} episodes watched
          </p>
        </div>
      </div>

      {!seasonNumbers && <p className="muted small">Loading season list...</p>}

      {seasonNumbers?.map((seasonNumber) => {
        const isExpanded = expandedSeason === seasonNumber;
        const eps = episodesBySeason.get(seasonNumber) ?? [];
        const allWatched = eps.length > 0 && eps.every((e) => watchedKeys.has(e.key));

        return (
          <div key={seasonNumber} className="season-block">
            <div className="season-header season-toggle" onClick={() => toggleExpand(seasonNumber)}>
              <h3>
                <span className={`season-caret ${isExpanded ? "open" : ""}`}>&#9656;</span> Season {seasonNumber}
              </h3>
              {isExpanded && eps.length > 0 && (
                <button
                  className="link-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSeason(eps, !allWatched);
                  }}
                >
                  {allWatched ? "Mark season unwatched" : "Mark season watched"}
                </button>
              )}
            </div>

            {isExpanded && (
              <>
                {loadingSeason === seasonNumber && <p className="muted small">Fetching episodes...</p>}
                <ul className="episode-list">
                  {eps.map((ep) => (
                    <li key={ep.key} className={watchedKeys.has(ep.key) ? "watched" : ""}>
                      <label>
                        <input
                          type="checkbox"
                          checked={watchedKeys.has(ep.key)}
                          onChange={() => toggleEpisode(ep)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="ep-number">E{ep.episodeNumber}</span>
                        <span className="ep-name" onClick={() => setOpenEpisode(ep)}>
                          {ep.name}
                        </span>
                        {ep.airDate && <span className="muted small">{ep.airDate}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}

      {openEpisode && (
        <EpisodeDetailsPanel
          showName={show.name}
          episode={openEpisode}
          watched={watchedKeys.has(openEpisode.key)}
          onToggleWatched={() => toggleEpisode(openEpisode)}
          onClose={() => setOpenEpisode(null)}
        />
      )}
    </div>
  );
}
