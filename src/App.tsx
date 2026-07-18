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

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Reel</span>
        {/* Hidden below 640px via CSS, the bottom-nav takes over there.
            Settings is icon-only at every width (that's the "more space"
            fix), the other four keep their text labels here since desktop/
            tablet widths actually have room for them. */}
        <nav className="top-nav">
          {TAB_ORDER.map((t) => {
            const Icon = TAB_ICONS[t];
            const isSettings = t === "settings";
            return (
              <button
                key={t}
                className={tab === t ? "nav-active" : ""}
                onClick={() => setTab(t)}
                aria-label={isSettings ? "Settings" : undefined}
              >
                {isSettings ? <Icon size={20} /> : TAB_LABELS[t]}
              </button>
            );
          })}
        </nav>
      </header>

      <main>
        {tab === "home" && <Home />}
        {tab === "shows" && <Library />}
        {tab === "movies" && <Movies />}
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
  );
}

export default App;