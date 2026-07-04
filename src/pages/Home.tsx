import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Episode } from "../db";
import { TMDB_IMAGE_BASE } from "../tmdb";
import { ensureEpisodesCached, findNextUnwatched } from "../lib/episodeSync";
import { daysSince, STALE_DAYS_THRESHOLD } from "../lib/showStatus";

interface Row {
  showId: number;
  showName: string;
  posterPath: string | null;
  nextEpisode: Episode;
  lastWatchedAt: string | null;
}

export default function Home({ onOpenShow }: { onOpenShow: (tmdbId: number) => void }) {
  const shows = useLiveQuery(
    () => db.shows.filter((s) => s.isFollowed && !s.isArchived).toArray(),
    []
  );
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

        // Only surface shows that have actually been started (at least one
        // watched episode). Shows with zero watched episodes belong in
        // "Haven't Started", a separate view, not on the Watch Next home screen.
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
    });
    await db.shows.update(row.showId, { lastWatchedAt: new Date().toISOString() });
  }

  if (!shows) return <p className="muted">Loading...</p>;

  const watchNext = (rows ?? []).filter((r) => (daysSince(r.lastWatchedAt) ?? 0) < STALE_DAYS_THRESHOLD);
  const stale = (rows ?? []).filter((r) => (daysSince(r.lastWatchedAt) ?? 0) >= STALE_DAYS_THRESHOLD);

  return (
    <div className="panel">
      <h2>Watch Next</h2>
      {syncing && <p className="muted small">Syncing episode data from TMDB...</p>}

      {watchNext.length === 0 && !syncing && <p className="muted">Nothing queued up. Mark some episodes watched to get started.</p>}

      <div className="watch-next-list">
        {watchNext.map((row) => (
          <div key={row.showId} className="watch-next-row">
            {row.posterPath ? (
              <img src={`${TMDB_IMAGE_BASE}${row.posterPath}`} alt={row.showName} onClick={() => onOpenShow(row.showId)} />
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
                  <img src={`${TMDB_IMAGE_BASE}${row.posterPath}`} alt={row.showName} onClick={() => onOpenShow(row.showId)} />
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
    </div>
  );
}
