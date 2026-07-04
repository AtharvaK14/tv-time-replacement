import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import { ensureEpisodesCached } from "../lib/episodeSync";

export default function ShowDetail({ tmdbId, onBack }: { tmdbId: number; onBack: () => void }) {
  const show = useLiveQuery(() => db.shows.get(tmdbId), [tmdbId]);
  const watched = useLiveQuery(
    () => db.watchedEpisodes.where("showId").equals(tmdbId).toArray(),
    [tmdbId]
  );
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const episodesInDb = useLiveQuery(
    () => db.episodes.where("showId").equals(tmdbId).toArray(),
    [tmdbId]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingEpisodes(true);
      await ensureEpisodesCached(tmdbId);
      if (!cancelled) setLoadingEpisodes(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  if (!show) return <p className="muted">Loading...</p>;

  const watchedKeys = new Set((watched ?? []).map((w) => w.key));

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

  const bySeason = new Map<number, Episode[]>();
  for (const ep of episodesInDb ?? []) {
    const list = bySeason.get(ep.seasonNumber);
    if (list) list.push(ep);
    else bySeason.set(ep.seasonNumber, [ep]);
  }
  for (const list of bySeason.values()) list.sort((a, b) => a.episodeNumber - b.episodeNumber);

  return (
    <div className="panel">
      <button className="back-link" onClick={onBack}>
        &larr; Library
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

      {loadingEpisodes && <p className="muted small">Fetching episode list from TMDB...</p>}

      {[...bySeason.keys()]
        .sort((a, b) => a - b)
        .map((seasonNumber) => {
          const eps = bySeason.get(seasonNumber)!;
          const allWatched = eps.every((e) => watchedKeys.has(e.key));
          return (
            <div key={seasonNumber} className="season-block">
              <div className="season-header">
                <h3>Season {seasonNumber}</h3>
                <button className="link-button" onClick={() => toggleSeason(eps, !allWatched)}>
                  {allWatched ? "Mark season unwatched" : "Mark season watched"}
                </button>
              </div>
              <ul className="episode-list">
                {eps.map((ep) => (
                  <li key={ep.key} className={watchedKeys.has(ep.key) ? "watched" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={watchedKeys.has(ep.key)}
                        onChange={() => toggleEpisode(ep)}
                      />
                      <span className="ep-number">E{ep.episodeNumber}</span>
                      <span className="ep-name">{ep.name}</span>
                      {ep.airDate && <span className="muted small">{ep.airDate}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </div>
  );
}
