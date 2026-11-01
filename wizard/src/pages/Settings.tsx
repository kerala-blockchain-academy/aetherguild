import { useState } from "react";
import { saveSettings, type Settings } from "../api";

export default function SettingsPage({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [rpcUrl, setRpcUrl] = useState(settings.rpc_url);
  const [explorer, setExplorer] = useState(settings.explorer_url);
  const [status, setStatus] = useState("");

  async function submit() {
    try {
      await saveSettings({ rpc_url: rpcUrl.trim(), explorer_url: explorer.trim() });
      onSaved();
      setStatus("Saved.");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    }
  }

  const field = "w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const label = "block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-8 space-y-5">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Settings</h1>
      <div>
        <label className={label}>Node RPC URL</label>
        <input
          type="password"
          placeholder="https://…/v2/<api-key>"
          value={rpcUrl}
          onChange={(e) => setRpcUrl(e.target.value)}
          className={`${field} font-mono`}
        />
        <p className="text-xs text-gray-400 mt-1">
          Any provider (Alchemy, Infura, QuickNode…) or a local node, with the API key included in the URL. Stored locally in the app config directory.
        </p>
      </div>
      <div>
        <label className={label}>Block explorer URL (optional)</label>
        <input value={explorer} onChange={(e) => setExplorer(e.target.value)} className={field} placeholder="https://polygonscan.com" />
        <p className="text-xs text-gray-400 mt-1">Used for address and transaction links.</p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-semibold">
          Save
        </button>
        <span className="text-sm text-gray-600 dark:text-gray-400">{status}</span>
      </div>
    </div>
  );
}
