import { useState } from "react";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Movies from "./pages/Movies";
import AddTitle from "./pages/AddTitle";
import Settings from "./pages/Settings";
import "./index.css";

type Tab = "home" | "shows" | "movies" | "discover" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  home: "Home",
  shows: "Shows",
  movies: "Movies",
  discover: "Discover",
  settings: "Settings",
};

function App() {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Reel</span>
        <nav>
          {(["home", "shows", "movies", "discover", "settings"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "nav-active" : ""} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === "home" && <Home />}
        {tab === "shows" && <Library />}
        {tab === "movies" && <Movies />}
        {tab === "discover" && <AddTitle />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}

export default App;
