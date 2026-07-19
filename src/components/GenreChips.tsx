import { useState } from "react";
import type { Genre } from "../tmdb";

const VISIBLE_COUNT = 4;

// TMDB's genre list order is roughly alphabetical/ID order, not a
// popularity ranking, there's no TMDB-provided "popularity" field on
// genres themselves. This is a judgment call (not a TMDB-confirmed
// ranking) about which genres are most commonly relevant for a personal
// TV/movie library, used only to decide which chips show up front versus
// behind "+N". Genres not in this list keep their original relative
// order, appended after the ones that matched.
const COMMON_GENRE_PRIORITY = [
  "Drama",
  "Comedy",
  "Action",
  "Action & Adventure",
  "Sci-Fi & Fantasy",
  "Science Fiction",
  "Crime",
  "Animation",
  "Horror",
  "Documentary",
];

function sortByCommonFirst(genres: Genre[]): Genre[] {
  return [...genres].sort((a, b) => {
    const ai = COMMON_GENRE_PRIORITY.indexOf(a.name);
    const bi = COMMON_GENRE_PRIORITY.indexOf(b.name);
    const aRank = ai === -1 ? COMMON_GENRE_PRIORITY.length : ai;
    const bRank = bi === -1 ? COMMON_GENRE_PRIORITY.length : bi;
    return aRank - bRank;
  });
}

export default function GenreChips({
  genres,
  value,
  onChange,
}: {
  genres: Genre[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const sorted = sortByCommonFirst(genres);
  const visible = sorted.slice(0, VISIBLE_COUNT);
  const rest = sorted.slice(VISIBLE_COUNT);
  const selectedRestGenre = value !== null ? rest.find((g) => g.id === value) : undefined;

  return (
    <>
      <div className="genre-chips">
        <button type="button" className={`opt ${value === null ? "active" : ""}`} onClick={() => onChange(null)}>
          All
        </button>
        {visible.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`opt ${value === g.id ? "active" : ""}`}
            onClick={() => onChange(g.id)}
          >
            {g.name}
          </button>
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            className={`opt ${selectedRestGenre ? "active" : ""}`}
            onClick={() => setPopoverOpen(true)}
          >
            {selectedRestGenre ? selectedRestGenre.name : `+${rest.length}`}
          </button>
        )}
      </div>

      {popoverOpen && (
        <div className="modal-backdrop" onClick={() => setPopoverOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>All genres</h3>
            <div className="genre-chips">
              <button
                type="button"
                className={`opt ${value === null ? "active" : ""}`}
                onClick={() => {
                  onChange(null);
                  setPopoverOpen(false);
                }}
              >
                All
              </button>
              {sorted.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`opt ${value === g.id ? "active" : ""}`}
                  onClick={() => {
                    onChange(g.id);
                    setPopoverOpen(false);
                  }}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
