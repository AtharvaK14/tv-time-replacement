import { useState } from "react";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Movies from "./pages/Movies";
import ShowDetail from "./pages/ShowDetail";
import ImportWizard from "./pages/ImportWizard";
import AddTitle from "./pages/AddTitle";
import Settings from "./pages/Settings";
import "./index.css";

type Tab = "home" | "shows" | "movies" | "import" | "add" | "settings";

const TAB_LABELS: Record<Tab, string> = {
  home: "Home",
  shows: "Shows",
  movies: "Movies",
  add: "Add",
  import: "Import",
  settings: "Settings",
};

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [openShowId, setOpenShowId] = useState<number | null>(null);

  function openShow(id: number) {
    setOpenShowId(id);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Reel</span>
        <nav>
          {(["home", "shows", "movies", "add", "import", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t && openShowId === null ? "nav-active" : ""}
              onClick={() => {
                setTab(t);
                setOpenShowId(null);
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {openShowId !== null ? (
          <ShowDetail tmdbId={openShowId} onBack={() => setOpenShowId(null)} />
        ) : (
          <>
            {tab === "home" && <Home onOpenShow={openShow} />}
            {tab === "shows" && <Library onOpenShow={openShow} />}
            {tab === "movies" && <Movies />}
            {tab === "add" && <AddTitle />}
            {tab === "import" && <ImportWizard />}
            {tab === "settings" && <Settings />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
