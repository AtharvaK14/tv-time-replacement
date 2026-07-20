import { useState, useEffect, type ComponentType } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Movies from "./pages/Movies";
import AddTitle from "./pages/AddTitle";
import Settings from "./pages/Settings";
import BackupNudge from "./components/BackupNudge";
import FirstRunWizard from "./components/FirstRunWizard";
import { hasApiKey } from "./tmdb";
import { APP_NAME } from "./appInfo";
import {
  initStoragePersistence,
  shouldShowBackupNudge,
  snoozeBackupNudge,
  BACKUP_COMPLETED_EVENT,
  type PersistStatus,
} from "./lib/persistence";
import { HomeIcon, ShowsIcon, MoviesIcon, DiscoverIcon, SettingsIcon, type IconProps } from "./components/icons";
import "./index.css";

type Tab = "home" | "shows" | "movies" | "discover" | "settings";

const TAB_ORDER: Tab[] = ["home", "shows", "movies", "discover", "settings"];

const TAB_LABELS: Record<Tab, string> = {
  home: "Home",
  shows: "Shows",
  movies: "Movies",
  discover: "Discover",
  settings: "Settings",
};

const TAB_ICONS: Record<Tab, ComponentType<IconProps>> = {
  home: HomeIcon,
  shows: ShowsIcon,
  movies: MoviesIcon,
  discover: DiscoverIcon,
  settings: SettingsIcon,
};

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [moviesInitialFilter, setMoviesInitialFilter] = useState<"wantToWatch" | null>(null);

  // Phase 0 durability: ask the browser/WebView for persistent storage once
  // per launch, and re-evaluate the backup nudge whenever a backup or
  // restore completes (the banner should clear immediately, not on reload).
  // First-run onboarding: shown only when the user has never completed or
  // skipped it AND there's no TMDB key. The hasApiKey() check grandfathers
  // in existing installs from before the wizard existed — they configured
  // keys through Settings and must never see onboarding.
  const [showOnboarding, setShowOnboarding] = useState(
    () => localStorage.getItem("onboarding_completed") !== "true" && !hasApiKey()
  );

  const [persistStatus, setPersistStatus] = useState<PersistStatus | null>(null);
  const [, forceNudgeRecheck] = useState(0);

  useEffect(() => {
    initStoragePersistence().then(setPersistStatus);
    const onBackupCompleted = () => forceNudgeRecheck((t) => t + 1);
    window.addEventListener(BACKUP_COMPLETED_EVENT, onBackupCompleted);
    return () => window.removeEventListener(BACKUP_COMPLETED_EVENT, onBackupCompleted);
  }, []);

  // Only nudge when there's actually a library to lose.
  const hasLibraryData = useLiveQuery(
    async () => (await db.shows.count()) > 0 || (await db.movies.count()) > 0,
    []
  );

  // Recomputed every render on purpose (it's a couple of localStorage
  // reads): its inputs change outside React, so the force-recheck state
  // above triggers the re-render when a backup completes or is snoozed.
  const nudge = shouldShowBackupNudge(persistStatus, hasLibraryData ?? false);

  function dismissNudge() {
    snoozeBackupNudge();
    forceNudgeRecheck((t) => t + 1);
  }

  function viewAllWantToWatchMovies() {
    setMoviesInitialFilter("wantToWatch");
    setTab("movies");
  }

  return (
    <>
      {showOnboarding && <FirstRunWizard onComplete={() => setShowOnboarding(false)} />}

      <nav className="side-rail">
        <span className="side-rail-mark" aria-hidden="true">R</span>
        {TAB_ORDER.map((t) => {
          const Icon = TAB_ICONS[t];
          return (
            <button
              key={t}
              className={`side-rail-item ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
              aria-label={TAB_LABELS[t]}
              aria-current={tab === t ? "page" : undefined}
            >
              <Icon size={22} />
            </button>
          );
        })}
      </nav>

      <div className="app-shell">
        <header className="app-header">
          <span className="brand">{APP_NAME}</span>
        </header>

        {nudge.show && nudge.reason && (
          <BackupNudge reason={nudge.reason} onBackUp={() => setTab("settings")} onDismiss={dismissNudge} />
        )}

        <main>
          {tab === "home" && <Home onViewAllMovies={viewAllWantToWatchMovies} />}
          {tab === "shows" && <Library />}
          {tab === "movies" && (
            <Movies initialFilter={moviesInitialFilter} onInitialFilterConsumed={() => setMoviesInitialFilter(null)} />
          )}
          {tab === "discover" && <AddTitle />}
          {tab === "settings" && <Settings />}
        </main>

        {/* display:none above 640px via CSS, this is the mobile-only nav. */}
        <nav className="bottom-nav">
          {TAB_ORDER.map((t) => {
            const Icon = TAB_ICONS[t];
            return (
              <button
                key={t}
                className={`bottom-nav-item ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                <Icon size={22} />
                <span>{TAB_LABELS[t]}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

export default App;