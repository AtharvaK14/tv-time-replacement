# Reel — a personal, local-first TV/movie tracker

Replaces TV Time (shutting down July 15, 2026). Episode-level tracking,
local storage only (IndexedDB via Dexie), TMDB for metadata, OMDb for
IMDb/Rotten Tomatoes ratings.

## Running it

```
npm install
npm run dev
```

Go to **Settings** first:
- TMDB API key (required): https://www.themoviedb.org/settings/api, v3 auth
- OMDb API key (optional, for ratings): https://www.omdbapi.com/apikey.aspx

## Importing your TV Time export

Upload these two files from your GDPR export by their exact names, the app
labels the upload slots with these filenames specifically because they're
easy to confuse:

- `tracking-prod-records.csv` → movies (watched + want-to-watch)
- `tracking-prod-records-v2.csv` → episode history + show follow status

Ambiguous title matches (e.g. multiple shows with the same name) pause the
import and ask you to pick, then remember your choice permanently.

## What I verified against your real export, and how

I didn't take the schema on faith a second time. I loaded all five of your
uploaded CSVs in a Python shell and profiled them directly before writing
any parsing code. Findings:

- **`tracking-prod-records.csv` is a mixed event log**, not a movies-only
  file. A `type` column (`watch`, `follow`, `towatch`, `rewatch`, ...) crossed
  with an `entity_type` column (`movie` or `episode`) tells you what each row
  means. Movies only ever appear here, verified: 810 real movie-watch events
  in your data.
- **`tracking-prod-records-v2.csv` is the complete, authoritative episode
  history**, not the simple format a third-party importer assumed. I proved
  this by set-difference: every episode in `watched_on_episode.csv` (702
  episodes) and in the older `tracking-prod-records.csv` episode rows (1,593
  episodes) is a 100% redundant subset of what's in v2. Zero new information
  in either. So only v2 is used for episode import, the other two are
  ignored on purpose, not by oversight.
- **v2 also embeds per-show follow/archive status** in the same file, under
  a different row-key prefix (`user-series-...` vs `watch-episode-...` /
  `rewatch-episode-...`). 194 shows tracked, 173 actively followed, 13 have
  history but were later unfollowed or archived (shown as "Stopped" in the
  Shows list).
- **I did not trust either pre-computed episode-count field.** Both
  `user_tv_show_data.csv`'s `nb_episodes_seen` and v2's own `ep_watch_count`
  looked plausible individually but disagreed with each other on roughly
  half the shows I spot-checked (e.g. Suits: 134 vs 180). I counted actual
  distinct watched (season, episode) pairs from the raw event rows as a
  tiebreaker and confirmed the event rows are ground truth, both aggregate
  fields can go stale. The app always derives counts from raw events, never
  from either summary field.
- **4 of your 810 movie-watch rows had a blank `movie_name`.** Dropping them
  would have been the easy path. Instead: TV Time still encodes a slugified
  title in `alpha_range_key` on those rows (e.g. `watch-alpha-no-hard-feelings`
  → "No Hard Feelings"). The importer recovers the title from that field when
  `movie_name` is empty. Verified all 4 recovered titles are real, searchable
  movie names (Flow, No Hard Feelings, Mission Impossible Rogue Nation,
  Kathal A Jackfruit Mystery) before shipping this.
- **Ran the actual TypeScript parsing code against your real files** (not
  just type-checked it) via a throwaway `tsx` script, and cross-checked every
  count against the independent Python analysis before removing the script.

## IMDb / Rotten Tomatoes ratings: real constraint, not a shortcut

There is no free official public API for either. IMDb's data licensing is a
paid enterprise product. OMDb (verified directly on their site) is the
legitimate free path: 1,000 requests/day, CC BY-NC 4.0 non-commercial
license, matches your personal-use scope. One real limitation, not yet
empirically confirmed against a live key: Rotten Tomatoes scores through
OMDb appear to be movie-only, not available for TV series. Try it once you
have a key and this note should get corrected either way.

## Ambiguous title matching: hybrid, not all-or-nothing

Blocking on every ambiguous title turned out to be genuinely tedious in
practice (confirmed by actually using it, not predicted). The fix isn't
"auto-pick everything" (risks silent wrong matches) or "keep blocking
everything" (the tedium that prompted this). Matches now resolve, in order:

1. Only one TMDB result exists, no ambiguity to begin with.
2. TV Time's own year suffix (`Show (2018)`) uniquely picks one candidate.
3. Exactly one candidate's title matches the query verbatim, a same-named
   unrelated show is unlikely to also be an exact string match.
4. The top-ranked candidate (in TMDB's own relevance order, not re-sorted)
   is at least 3x more popular than the runner-up, decisive enough to trust.
5. Otherwise, genuinely a toss-up, still blocks and asks.

The 3x threshold (`POPULARITY_DOMINANCE_RATIO` in `matcher.ts`) is a
judgment call, not a documented TMDB standard, there's no "correct" number
here. The import summary breaks down how many titles resolved by which
method, including a flagged count of popularity-based auto-picks, so
they're visible and spot-checkable rather than silently trusted.

## Episode-level details (added after live testing confirmed OMDb works)

Clicking an episode name now opens a details panel with:
- Overview and TMDB's own rating (`vote_average`), both confirmed present in
  TMDB's real season-details response schema, not assumed.
- IMDb rating via OMDb's documented `Season`+`Episode` query parameters
  (`?t=<show>&Season=X&Episode=Y`), added to OMDb's API per their own
  changelog. **This has not been run against a live key in this environment.**
  If it comes back empty across the board once you try it, check the raw
  OMDb response shape first before assuming the parameters are wrong.

Show pages are now a collapsible season accordion instead of everything
expanded at once, matching the "pick a show, then a season, then see its
episodes" structure you asked for. Episode lists for a season are only
fetched from TMDB when you actually expand that season, not all at once,
which also cuts down on unnecessary API calls for shows you don't revisit.

## What I could NOT verify in this environment

- **No live TMDB or OMDb calls were made.** I have no API keys or browser
  here. Parsing, matching logic, and the full build were verified; the
  network calls to actually resolve your 174 shows and ~800 movies to TMDB
  IDs have not been run end to end. Expect the first real import to surface
  a handful of edge cases (foreign titles, anime absolute-vs-season episode
  numbering, shows TMDB doesn't have) that no amount of static analysis
  catches.
- **The "Haven't Watched For a While" threshold (30 days) is a judgment
  call**, not something TV Time publishes. Defined in
  `src/lib/showStatus.ts`, change `STALE_DAYS_THRESHOLD` if it feels wrong
  once you've used it for a week.

## Known limitations (by design)

- No cross-device sync, everything lives in this browser's IndexedDB.
- No push notifications for new episodes (browser PWA limitation on
  Android). Capacitor is the no-rewrite path to a native Android shell if
  this becomes a real gap.
- TV Time's UI navigation pattern (Watch Next / Haven't Watched For a While
  on the home screen, tab-based Shows/Movies/Add/Import/Settings) is
  replicated. Its actual visual design, icons, and branding are not, those
  are TV Time's trademarked assets and copying them isn't something I'll do
  even for a personal tool. The app has its own visual identity instead.

## Project structure

```
src/
  db.ts                       Dexie schema (IndexedDB), source of truth
  tmdb.ts                     TMDB API client
  omdb.ts                     OMDb API client (IMDb/RT ratings)
  lib/
    episodeSync.ts            Shared TMDB episode-list caching (Home + ShowDetail)
    showStatus.ts             Recency helpers, staleness threshold
  importer/
    parseTvTimeCsv.ts         CSV parsing, verified against real export schema
    matcher.ts                Title -> TMDB ID resolution + caching
    runImport.ts              Orchestrates parse -> match -> write
  components/
    DetailsPanel.tsx          Plot/ratings/add-to-library modal
  pages/
    Home.tsx                  Watch Next + Haven't Watched For a While
    Library.tsx               Shows grid (renamed "Shows" in nav)
    ShowDetail.tsx             Season/episode checklist
    Movies.tsx                Movie list with watched toggle
    AddTitle.tsx               Search TMDB, opens DetailsPanel to add
    ImportWizard.tsx            TV Time CSV import with disambiguation UI
    Settings.tsx                TMDB + OMDb API keys
    Stats.tsx                   Time-watched totals, self-healing runtime backfill
    Diagnostics.tsx              Stored-data vs TMDB comparison for bug reports
```

## This round: UI additions, a real CSS bug fix, and one bug still needs your diagnostic run

**Fixed, verified by code review:**
- Poster stretching in the details panel was a real CSS bug, not a sizing
  preference: `.details-layout` was `display: flex` with no `align-items`
  set, which defaults to `stretch`, vertically distorting the poster to
  match its taller text sibling. Fixed with `align-items: flex-start` plus
  an explicit `aspect-ratio` on the poster as a defensive backstop.
- Season count now shows between release year and status in the details
  panel, from TMDB's `number_of_seasons` field (already being fetched,
  wasn't being displayed).

**Added:**
- Search, sort, and filter on both Shows and Movies pages.
- A Shows/Movies toggle on Home. Movies' equivalent of "Watch Next" is your
  want-to-watch list (movies aren't episodic, so "haven't watched in a
  while" doesn't apply the same way).
- A Stats page (TV time, episodes watched, movie time, movies watched).
  **TV time is an estimate**, not exact: watched-episode-count times TMDB's
  average episode runtime for that show, because getting the actual runtime
  of every individual episode watched would mean one extra API call per
  episode, not per show. Movie time uses each movie's real runtime, that
  number is exact. Said plainly in the Stats page itself, not just here.
  Shows/movies added before this feature existed get their runtime
  backfilled automatically the first time you open Stats (one-time cost).
- A Diagnostics page. Pick a show, see exactly what's stored in your local
  database versus what TMDB reports, side by side.

**NOT fixed yet, because I can't verify it from here:**

- **The Watch Next / Haven't Watched For a While bug you reported.** I
  checked one specific hypothesis (whether TV Time's bulk "mark season
  watched" actions produce rows without real episode numbers) against your
  actual CSV data and ruled it out: Arrow alone has 170 distinct
  individually-numbered watched episodes out of ~171 total in the raw
  export, the source data is fine. That means the bug is somewhere in the
  live import run or the TMDB matching, something I can't observe without
  your browser's actual IndexedDB contents. Use the new Diagnostics page on
  Arrow specifically and send me the output, that will show directly
  whether it's a numbering mismatch, a wrong TMDB match, or something else,
  instead of another round of guessing.
- **The episode-level IMDb rating issue.** I don't know the actual failure
  mode you're seeing (blank, wrong number, error). The panel now shows
  OMDb's own error message when the lookup fails (e.g. "Series not found!")
  instead of a generic blank, so whatever you see next should point at the
  real cause directly.

## This round: a real root-cause bug fix, ID-based ratings, rewatch-aware stats, and a UI restructure

**The most important fix: clicking an episode to view details was also toggling its watched state.** Confirmed by reading the actual markup, not guessed: the checkbox and the clickable episode name were both inside the same `<label>` element. Clicking *anywhere* inside a `<label>` wrapping a checkbox forwards that click to the checkbox by native browser behavior, `stopPropagation()` on the checkbox itself can't stop this, because it's the label's own default action, not a bubbled event. This means every exploratory click on an episode name was silently flipping its watched state.

**This is very likely a major cause of the Home bug you kept seeing** (already-watched shows appearing in Haven't Watched, currently-watching shows not appearing). Fixing the code stops it happening *going forward*, it does not undo damage already sitting in your IndexedDB from before. **Re-run the import after updating**, it overwrites watch history by primary key straight from your CSV regardless of current state, which will restore anything the bug already corrupted. If shows still look wrong after that, use the Diagnostics tab and send me the output, that's real signal, not another guess.

**Ratings were being looked up by title, which can match the wrong same-named title.** Fixed by using TMDB's `external_ids` (confirmed in their own docs, fetched in the same call as the existing details request, no extra API cost) to get the real IMDb ID, then querying OMDb by `i=<id>` instead of by title. Verified this parameter works from OMDb's own changelog (`i=` plus `Season`/`Episode` added 11/16/15). This should fix the wrong-rating reports, but I can't confirm that without your live key, tell me if it's still wrong for a specific title and I'll look at that one directly.

**TV time was undercounting because rewatches were being discarded.** Checked this against your real data rather than assuming: 28.6% of all episode watch events in your export are rewatches, not a rounding error. The importer used to keep only the earliest watch event per episode and discard the rest, meaning rewatches contributed nothing to total time watched. Now every watch event is counted (`watchCount` per episode), while still using the earliest date for "when did I first watch this." **This also needs a re-import to take effect** for episodes you already have; existing rows default to assuming 1 watch until re-imported. Same fix applied to movies, using counted `rewatch` events rather than TV Time's own `rewatch_count` field, which was checked and found unreliable (44% mismatch against actual counted events in your data, always under-reporting).

**UI restructure:**
- Season/episode browsing now lives inside the same details panel modal used everywhere else, not a separate page. Episode rows show TMDB's thumbnail image. The watched-toggle is a separate, explicit button, deliberately not sharing a label with anything clickable, by construction this time, not a patch.
- Stats moved into the Shows and Movies pages themselves (Months/Days/Hours format, matching TV Time's own display), the standalone Stats tab is gone.
- Added a "Currently Watching" filter and a genre filter to Shows. Currently Watching relies on episode data already being cached locally (from Home's sync or having opened a show), it deliberately doesn't force a TMDB fetch per show just to support a filter, that's a real scoping tradeoff, not an oversight, stated here so it isn't a surprise.
- Added genre filter to Movies and to the Home movie watchlist. Sorting movies by rating isn't implemented, ratings come from OMDb live and aren't cached per movie, sorting by something not actually stored would be fake, so it currently falls back to title order, flagged in the code rather than silently wrong.
- Add page now shows Popular shows, Popular movies, Upcoming movies, and a "Recently available at home" section when the search box is empty. That last one is TMDB's closest real equivalent to Rotten Tomatoes' page (recent US digital releases via TMDB's own release-type data), it's a genuine approximation using documented TMDB filters, not the same curation RT does, said plainly in the UI too.

