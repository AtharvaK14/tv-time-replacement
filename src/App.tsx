import { useState, type ComponentType } from "react";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Movies from "./pages/Movies";
import AddTitle from "./pages/AddTitle";
import Settings from "./pages/Settings";
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

  function viewAllWantToWatchMovies() {
    setMoviesInitialFilter("wantToWatch");
    setTab("movies");
  }

  return (
    <>
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
          <span className="brand">WatchTime</span>
        </header>

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