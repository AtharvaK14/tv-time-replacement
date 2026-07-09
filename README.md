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

## This round: two confirmed TMDB endpoint bugs, a CSS scoping bug, nav restructure, and the stats question resolved (not by a new CSV)

**"Upcoming movies" showing already-released movies was a real, well-documented TMDB behavior**, not a guess. Confirmed via multiple independent TMDB bug reports matching your exact symptom: without a `region` parameter, `/movie/upcoming` treats a film as upcoming if it hasn't released *anywhere in the world* yet, so something already out in the US but not yet released in, say, Japan still qualifies. Fixed with `region=US`.

**"Popular TV shows" pulling in decades-old or irrelevant shows was also real, confirmed from TMDB's own documentation.** "Popularity" on TMDB is explicitly a lifetime aggregate score, not a "right now" signal, that's their own stated distinction from "Trending," which uses short (daily/weekly) windows specifically to surface current relevance. Switched both TV and movie suggestions to `/trending/{type}/week`, and relabeled the sections so they say what they now actually show.

**The Home toggle not highlighting was a CSS scoping bug, not a missing feature.** The JS logic was already correct; the CSS rule providing the highlight was accidentally scoped to `.app-header nav` only, so the same class name did nothing when reused on the Home page's Shows/Movies toggle. Fixed with a general-purpose rule.

**Nav restructure done as asked:** Import and Diagnostics now live as collapsible sections inside Settings, "Add" is now "Discover," and "Add to Library" now says "Add to Shows" or "Add to Movies" depending on what it is, since there's no single "Library" concept anymore. Genre now displays alongside year and season count, pulled from the same TMDB call already being made, no extra cost.

**Season browsing now works for shows not yet in your library too**, per your request, it's read-only (no watched-toggle) until you add the show, since a watch record needs something to attach to.

**Movies' watched checkbox is now an animated pill at the bottom of the tile**, greys out or highlights on click with a small pop animation, replacing the checkbox.

**On the stats question, checked your new file rather than assuming it would help**: `stats-prod-cache.csv` is exactly what its name says, a cache. It only covers an 11-month window (Aug 2025 to Jul 2026), not your full history, so it can't answer "how much have I watched total" even in principle. More importantly, I cross-checked it against my own method for that same window: my raw "first watch" event count for movies in that window is 120, TV Time's own cached count for the same window is also 120. That's real agreement, not a coincidence, and it validates the event-counting approach rather than pointing to a new bug. **The much more likely explanation for "still incorrect" is that the rewatch-counting fix from last round needs a re-import to apply** to episodes already in your database (I flagged this requirement at the time). Before I chase a new hypothesis: have you re-imported since that fix shipped? If yes and it's still off, tell me a specific show or movie where the number looks wrong and I'll trace that one specifically instead of guessing at another systemic cause.

## This round: a real root-cause fix for Watch Next, and a full import rebuild around better data

**Found and fixed the actual Watch Next bug, confirmed by re-reading the code, not another theory.** The Home screen's "what should I watch next" list only recomputed when the list of followed shows changed, not when you marked an episode watched or unwatched. Marking an episode watched writes to a different table (`watchedEpisodes`), which the old code's `useEffect` didn't depend on, so the screen quietly went stale the moment you touched anything and only refreshed if you navigated away and back to a point where the shows list itself happened to change. This is exactly consistent with what you reported (modifying episodes and seeing no change). Fixed by rebuilding the computation as a genuine Dexie live query that reads from `shows`, `episodes`, and `watchedEpisodes` together, so it automatically recomputes whenever any of them change, no manual dependency tracking to get wrong.

**Rebuilt the import pipeline around the new export you found**, and this is a real upgrade, not a preference:
- **Movies now match 922/922 by exact IMDb ID** (verified against your actual file), zero fuzzy title search, zero disambiguation prompts needed for movies at all going forward.
- **Shows match by exact TVDB ID** (193/193 have one, confirmed against your file; TMDB's `/find` endpoint with `external_source=tvdb_id` is officially documented and widely used, including by Kodi's own TMDB scraper for exactly this purpose). Falls back to fuzzy title search only if a show has no ID or the ID lookup comes up empty.
- **TV Time's own per-show status** (`continuing` / `up_to_date` / `not_started_yet` / `stopped` / `watch_later`) is now used directly for "does this show have more to watch," instead of me reconstructing that by comparing your watched episodes against TMDB's episode list. That reconstruction was fragile because it silently depended on TV Time and TMDB agreeing on season/episode numbering, which isn't guaranteed. TV Time's own field doesn't have that problem, it's authoritative. Verified directly: Arrow's status in your new export is `up_to_date`, matching what raw event-counting predicted weeks ago (170 of ~171 episodes watched), confirming the bug was in my reconstruction logic, not your data.
- **Per-episode `watched_count` (including rewatches) comes directly from the export now**, no more reconstructing it by counting raw event rows, which is simpler and removes an entire category of potential counting bugs.

**Your old CSV export still works** as a fallback (Settings → Import → the dropdown), for anyone without access to this third-party tool, but the JSON path is now the default and recommended option, and is what you should use going forward.

**Known limitation, from the export tool's own documentation, not discovered by me**: its own bundled summary states pre-2017 watches may be missing from this export even though they exist in TV Time's raw CSVs, and continuing shows can occasionally show a phantom unwatched episode if TV Time pre-created a placeholder for an episode that hasn't aired yet. Worth knowing if a very old show or a currently-airing one looks slightly off after this import.

**Still unverified, because I can't run it live**: the TVDB-based show matching has never executed against your real API key. The parsing was tested directly against your actual uploaded files (confirmed exact matches: 922 movies, 193 shows, 7,086 total watched episodes matching the export tool's own summary count exactly), but the live TMDB lookups have not. Re-import and tell me what the match breakdown looks like, and specifically whether Watch Next now shows anything.

## This round: three real bugs found from your exact numbers, and why a clean reset is the right call right now

You gave me exact target numbers (TV Time's real values) against what the app showed, that's what made these findings possible instead of more guessing.

**"Episodes watched" was displaying the wrong number.** Both a distinct-episode count and a rewatch-inclusive total were already computed, the display was wired to the wrong one. Per your own research (confirmed correct): TV Time's "Episodes Watched" counts distinct episodes only, rewatches only add to time watched. Fixed to show the distinct count.

**TV time undercounting (should be ~8mo, showed ~2mo) is very likely a "null never retries" bug.** When TMDB has no episode-runtime data for a show (confirmed straight from TMDB's own staff on their forum: they don't track true per-episode runtime, and the show-level average can be genuinely empty for some shows), my code stored `null` and the retry logic only ever rechecked `undefined`, not `null`. Once a show hit this, it contributed zero minutes forever with no way to self-correct. Fixed two ways: the retry check now catches both, and a documented fallback (40 min/episode, a judgment call, tunable in `lib/runtime.ts`) is used when TMDB genuinely has nothing, instead of silently contributing zero. Same fix applied to movies (fallback 110 min, `lib/stats.ts`).

**Your diagnostic instinct about stale data was correct, and here's specifically why:** every schema change so far has deliberately preserved existing data rather than wiping it, the right call for real watch history, but it means the null-forever bug above could never self-heal for shows already affected, and old wrong TMDB matches cached from before the ID-based matcher existed are also just sitting there. Added a **Reset Data** section in Settings (collapsed by default) that clears shows/movies/episodes/watch-history/match-cache without touching your API keys, so you don't need to dig through browser DevTools to get a clean slate during development.

**Settings restructured per your request**: API keys are now in a collapsed section, not shown by default. Import is the first thing you see (expanded), since that's the thing you actually do repeatedly.

**Still unverified**: the exact resulting TV time total after these fixes, since I can't run a live import here. Reset, re-import with the new JSON format, and tell me the new number, that's the only way to confirm this actually lands on ~8mo4d16h rather than just "closer than before."

## This round: Home restructured to match TV Time's real interaction model, not my assumption of it

The stacked "Watch Next" + "Haven't Watched For a While" sections were my own design guess, not verified against TV Time's actual UI. Confirmed directly against a real screenshot: these are two separate, mutually-exclusive pill tabs, you view one list at a time, not both stacked together. Rebuilt that way.

Added the two badges visible in the real screenshot that weren't built yet:
- **The "+N" count** (e.g. "S01|E04 +4"), how many more aired-unwatched episodes exist beyond the immediate next one, computed from the same cached episode/watched data already on hand.
- **The PREMIERE tag**, shown when the next episode is episode 1 of a season.

**On accurate episode runtimes**: checked three real sources rather than assuming none exist. TMDB and TheTVDB both explicitly do not support per-episode runtime, confirmed directly from each one's own staff on their respective forums, that's a genuine data gap, not a shortcut on my end. TVmaze is different: their own team confirmed per-episode runtime is in their API, it's free, keyless, and supports lookup by the same TVDB ID your export already provides, no new fuzzy matching needed, and one call per show (`?embed=episodes`) returns the full episode list with real runtimes rather than needing one call per episode. This is a real fix for the runtime-accuracy question, not a guess, but it's a genuine new dependency, not built yet, pending your go-ahead since it's real scope, not a one-line change.

## This round: TVmaze integration for real per-episode runtimes

Built against a real confirmed example payload and TVmaze's own documented HAL convention, not assumed. `src/tvmaze.ts` looks up a show by the TVDB ID your export already provides (`/lookup/shows?thetvdb=`), then fetches its full episode list with real runtimes in one call (`/shows/{id}?embed=episodes`), no per-episode calls needed. Never throws, a show TVmaze doesn't have just falls back to the show-level average, same as before.

**Wired into the existing episode-caching flow**, not a separate system: whenever a season gets cached (from Home's sync, or opening a show's season accordion), TVmaze's runtimes for that show are fetched once (cached in memory for the session, not re-fetched per season) and merged in per episode. TV time stats now use the real per-episode number when available, falling back to the show average otherwise, and the Shows page tells you the actual split (e.g. "6,200 of 7,122 watched episodes use TVmaze's real runtime").

**Honest gap**: I could not test this against a live call, `api.tvmaze.com` isn't reachable from my sandbox, same limitation as every other external API in this project. It's built directly from their own confirmed documentation and a real example response, not guessed, but "compiles and matches the docs" and "works against your real library" are different claims, only the second one is confirmed by you actually using it.

## This round: the actual Watch Next bug (probably), found by re-reading the code again, plus a real CSS fix

**Found a genuine logic bug via direct code inspection**: once a show had `tvTimeStatus` from import, my code trusted it *exclusively* and never checked live data again. TV Time's own status is a snapshot from whenever you last imported, it goes stale the instant you mark anything watched or unwatched directly in the app afterward. So a show imported as `not_started_yet` or `up_to_date` could never appear in Watch Next again, no matter what you did in the app, since the stale imported field always won. This matches your exact report: marking an episode watched didn't surface the next one. Fixed by treating tvTimeStatus and live watched-data as two signals that get OR'd together, not one exclusively overriding the other. Applied the identical fix to the "Currently Watching" filter on the Shows page, which had the same bug.

**Also rebuilt the underlying reactivity with a more defensively correct pattern**, independent of the bug above: the previous version ran an async loop with sequential Dexie queries inside a single `useLiveQuery`, which I could not be fully confident behaves identically to a simple query for change-tracking purposes. Replaced with three separate, single-table live queries (about as simple as Dexie queries get) combined via a plain synchronous `useMemo`, removing that uncertainty entirely rather than reasoning about it further.

**I want to be straight about the track record here**: this is the third attempt at Watch Next specifically. The first two were real, defensible fixes for real bugs I found, and this one is too, but I can't promise it's the last one without you testing it. If it's still wrong after this, the useful next step is opening Diagnostics on the specific show you're testing with and sending me that output directly, rather than another description of the symptom, since that gives me something concrete to check instead of re-reading the same code a fourth time hoping to spot something new.

**The "Mark Watched" button layout was a one-line CSS fix, confirmed by inspection**: `.show-card-body` had no `flex: 1`, so when the grid stretched a shorter card to match a taller row-mate, the leftover space sat between the title and button instead of the body growing to fill it. Fixed.

## This round: found via your actual Diagnostics output, not another guess

Your Spider-Noir diagnostic was genuinely useful: it proved the data layer is completely correct, 6 watched, 8 cached, 0 orphaned, S1E7/S1E8 correctly identified as unwatched. So the bug wasn't in the data at all, it was in a condition Diagnostics doesn't check but Watch Next does: an episode also has to have an "aired" date at or before today.

The actual problem: a **missing** air date was being treated as "hasn't aired," when it almost certainly just means TMDB hasn't populated that field yet, common for recently added episodes of a newer show like Spider-Noir. Flipped the default: a missing air date is now treated as available to watch, only a **confirmed future date** excludes an episode now. Applied to both the Watch Next computation and the "+N" count.

Also added this specific check directly into Diagnostics, so if this exact class of bug shows up again on a different show, the report will say so explicitly instead of needing another round of manual detective work.

I can't fully confirm this resolves Spider-Noir specifically without you testing it, if S1E7/S1E8 turn out to have a genuine confirmed future date rather than a missing one, that's a different, legitimate case (an episode that really hasn't released yet), and Diagnostics will now tell us that directly if so.

## This round: found the actual Watch Next bug via re-reading the sync code, plus a batch of requested features

**The real bug this time: no error handling in the episode-sync loop.** `ensureEpisodesCached` had no try/catch, and Home's sync ran it sequentially for every followed show in one loop. If even one show threw (a TMDB rate limit, a network hiccup, a show TMDB has incomplete data for), the whole loop stopped right there, silently, and every show queued after it in the array never got synced in that session. For a couple of manually-added shows this would rarely trigger. For ~190 imported at once, one bad show could quietly take out most of the list. Fixed: each show now gets its own try/catch, failures are collected instead of aborting the batch, and Home now tells you directly if any shows failed to sync instead of just silently showing nothing for them.

**Layout and UI fixes:**
- Widened the main content area and enlarged grid tiles, less wasted space on wider screens.
- API keys are now masked (password-style dots) with a Show/Hide toggle, not plain text by default.
- Added Remove from Shows/Movies in the details panel, symmetric with Add, with a confirmation step since it deletes watch history for that title.

**Shows section:**
- Restyled the season browser (clearer separation between seasons, bigger episode thumbnails).
- Added "catch up" offers: marking an episode watched now offers to also mark earlier unwatched episodes in that season; marking a whole season watched offers to also mark all earlier seasons watched. Neither is forced, both show as a dismissible offer after the normal action, so single-episode marking still behaves exactly as before when there's nothing earlier to catch up on.

**Still open, need your input**: you asked to "modify the filter we have right now" in Shows, but didn't say which way, more options, fewer, different layout, something else. Rather than guess at this one, tell me specifically what's wrong with it and I'll fix that directly.









