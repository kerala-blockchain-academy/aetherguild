import { createContext, useContext } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type TxLink = {
  from: string;
  to: string;
  hash?: string;
  gasPrice?: string;
  fromIsContract?: boolean;
  toIsContract?: boolean;
};

export type Settings = { rpc_url: string; explorer_url: string };

// Commands reject with a plain string message.
export const getBlock = (blockNumber: number) =>
  invoke<TxLink[]>("get_block", { blockNumber });

export type RangeBatch = { kind: "batch"; links: TxLink[]; loaded: number; total: number };

let nextFetchId = 1;

/**
 * Stream a block range in chunks; `onBatch` fires as each chunk arrives.
 * `done` resolves true when finished, false if cancelled (via `cancel` or
 * by starting another range).
 */
export function streamBlocksRange(
  startBlock: number,
  endBlock: number,
  onBatch: (batch: RangeBatch) => void,
): { done: Promise<boolean>; cancel: () => void } {
  const fetchId = nextFetchId++;
  const onEvent = new Channel<RangeBatch>();
  onEvent.onmessage = onBatch;
  return {
    done: invoke<boolean>("stream_blocks_range", { fetchId, startBlock, endBlock, onEvent }),
    cancel: () => void invoke("cancel_fetch", { fetchId }).catch(() => {}),
  };
}

export const getSettings = () => invoke<Settings>("get_settings");
export const saveSettings = (settings: Settings) => invoke<void>("save_settings", { settings });

/** Ask for a save location and write the file. Returns false if cancelled. */
export async function saveTextFile(defaultName: string, contents: string): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path) return false;
  await invoke("write_text_file", { path, contents });
  return true;
}

/** Ask for a file and return its text, or null if cancelled. */
export async function openTextFile(): Promise<string | null> {
  const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  if (!path || Array.isArray(path)) return null;
  return invoke<string>("read_text_file", { path });
}

export const ExplorerCtx = createContext("https://polygonscan.com");
export const useExplorer = () => useContext(ExplorerCtx);
