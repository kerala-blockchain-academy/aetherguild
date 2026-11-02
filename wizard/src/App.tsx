import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { ExplorerCtx, getSettings, type Settings } from "./api";
import { useTheme } from "./theme";
import Graph from "./pages/Graph";
// React Flow is only needed on the whiteboard; load it on demand.
const Whiteboard = lazy(() => import("./pages/Whiteboard"));
import SettingsPage from "./pages/Settings";

const tab = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1 text-sm rounded-md ${isActive ? "bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`;

export default function App() {
  const { dark, toggle } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);

  const reload = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const explorer = (settings?.explorer_url || "https://polygonscan.com").replace(/[/]+$/, "");

  return (
    <ExplorerCtx.Provider value={explorer}>
      <div className="flex flex-col h-full w-full">
        <nav className="flex flex-wrap items-center gap-1 px-3 py-1.5 min-h-11 shrink-0 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <span className="font-bold text-gray-800 dark:text-gray-100 mr-3">🧙 Wizard</span>
          <NavLink to="/" end className={tab}>Graph</NavLink>
          <NavLink to="/whiteboard" className={tab}>Whiteboard</NavLink>
          <NavLink to="/settings" className={tab}>Settings</NavLink>
          {settings && !settings.rpc_url && (
            <span className="ml-auto text-xs text-red-600">No node RPC URL set — open Settings</span>
          )}
          <button
            onClick={toggle}
            className={`${settings && !settings.rpc_url ? "" : "ml-auto "}px-3 py-1 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800`}
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </button>
        </nav>
        <main className="flex-1 min-h-0 relative overflow-auto">
          <Routes>
            <Route path="/" element={<Graph />} />
            <Route
              path="/whiteboard"
              element={
                <Suspense fallback={null}>
                  <Whiteboard />
                </Suspense>
              }
            />
            <Route
              path="/settings"
              element={settings && <SettingsPage settings={settings} onSaved={reload} />}
            />
          </Routes>
        </main>
      </div>
    </ExplorerCtx.Provider>
  );
}
