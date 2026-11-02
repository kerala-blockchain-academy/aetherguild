# Cleric

A desktop app for running a local **druid** blockchain node and compiling/deploying
Solidity contracts against it. Built with Tauri (Rust), SvelteKit and TypeScript.

The `druid` node binary and the `solc` Solidity compiler are **embedded into the
app at compile time** — you must drop both executables into `src-tauri/` before
building. The Rust shell extracts them to a per‑user data folder on first launch,
runs the node as a child process, streams its logs to the UI, exposes a faucet,
and compiles contracts via `solc --standard-json`.

## Prerequisites

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/) (`npm i -g pnpm`)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri's platform deps — on Windows that's the **WebView2 runtime** (preinstalled
  on Windows 11) and the **MSVC C++ Build Tools** (Visual Studio Build Tools with
  the "Desktop development with C++" workload).

## 1. Place the `druid` and `solc` executables

Both binaries go directly in the **`src-tauri/`** folder (next to `Cargo.toml` and
`build.rs`):

```
cleric/
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── druid.exe   ← put the druid node here
    └── solc.exe    ← put the Solidity compiler here
```

### What to name them

[`build.rs`](src-tauri/build.rs) scans `src-tauri/` for files whose (lowercased)
name **starts with `druid` / `solc`** and **ends with `.exe`** (on Windows). The
exact rest of the name doesn't matter, so any of these are accepted:

| OS            | druid                              | solc                              |
| ------------- | ---------------------------------- | --------------------------------- |
| Windows       | `druid.exe`                        | `solc.exe`                        |
| Windows (alt) | `druid-x86_64-pc-windows-msvc.exe` | `solc-x86_64-pc-windows-msvc.exe` |
| macOS / Linux | `druid` (no extension)             | `solc` (no extension)             |

`druid.exe` / `solc.exe` are the simplest names — use those if unsure.

> The build **fails** if either binary is missing:
> `druid binary not found in src-tauri/ — place it there`.

> These binaries are **not committed** to git (`src-tauri/druid-*` is gitignored),
> so every fresh clone needs them dropped in manually.

### Where to get them

- **solc** — download the Windows release (`solc-windows.exe`) from the
  [solidity releases page](https://github.com/ethereum/solidity/releases),
  rename it to `solc.exe`. Match the `^0.8.x` line used by the JS `solc`
  dependency in [package.json](package.json).
- **druid** — use the `druid` node binary from your KBA / druid distribution and
  rename it to `druid.exe`.

## 2. Install & run

```powershell
pnpm install

# Dev (hot reload):
cargo tauri dev

# Production build (installer in src-tauri/target/release/bundle/):
cargo tauri build
```

The first `cargo tauri dev/build` after swapping a binary recompiles the Rust shell
(the new bytes get baked in via `include_bytes!`). On launch the app extracts the
binaries to your per‑user app‑data dir (`%LOCALAPPDATA%\com.anant.cleric\bin\` on
Windows) and only rewrites them when the size changes.

---

## Windows: "Smart App Control blocked druid.exe"

`druid.exe` is unsigned, so Smart App Control (SAC) blocks it. SAC can't be
bypassed per‑app — it's all‑or‑nothing — so the only fix on your own machine is to
turn it off:

1. Open **Windows Security** → **App & browser control**.
2. Under **Smart App Control**, click **Smart App Control settings**.
3. Set it to **Off**.

> ⚠️ Once Smart App Control is turned **Off**, Windows will **not** let you turn it
> back On without resetting/reinstalling Windows. Only do this if you accept that
> trade‑off (typical on a developer machine).

For shipping to other users (so they don't have to disable SAC), the only real fix
is to **code‑sign** `druid.exe` and the Cleric installer with a valid Authenticode
certificate — ideally an EV cert, which earns SmartScreen/SAC reputation.

---

## Project layout

- `src/` — SvelteKit frontend (dashboard, contracts, explorer, logs, settings).
- `src-tauri/src/lib.rs` — Rust backend: druid process management
  (`start`/`stop`/`restart`/`status`), faucet, contract scanning, and
  `solc`‑based compilation.
- `src-tauri/build.rs` — locates and embeds the `druid`/`solc` binaries.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) +
[Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) +
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
