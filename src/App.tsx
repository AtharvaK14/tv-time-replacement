import { useState } from "react";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Movies from "./pages/Movies";
import ImportWizard from "./pages/ImportWizard";
import AddTitle from "./pages/AddTitle";
import Settings from "./pages/Settings";
import Diagnostics from "./pages/Diagnostics";
import "./index.css";

type Tab = "home" | "shows" | "movies" | "import" | "add" | "settings" | "diagnostics";

const TAB_LABELS: Record<Tab, string> = {
  home: "Home",
  shows: "Shows",
  movies: "Movies",
  add: "Add",
  import: "Import",
  settings: "Settings",
  diagnostics: "Diagnostics",
};

function App() {
  const [tab, setTab] = useState<Tab>("home");

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand">Reel</span>
        <nav>
          {(["home", "shows", "movies", "add", "import", "settings", "diagnostics"] as Tab[]).map((t) => (
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
        {tab === "add" && <AddTitle />}
        {tab === "import" && <ImportWizard />}
        {tab === "settings" && <Settings />}
        {tab === "diagnostics" && <Diagnostics />}
      </main>
    </div>
  );
}

export default App;
