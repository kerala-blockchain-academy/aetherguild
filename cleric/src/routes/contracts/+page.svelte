<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    FolderOpen, X, Rocket, ChevronDown, ChevronRight,
    Copy, Check, FileCode, ArrowRight, AlertTriangle, Pencil, Save, Loader, RotateCcw,
  } from "lucide-svelte";
  import {
    createPublicClient,
    createWalletClient,
    http,
    defineChain,
  } from "viem";
  import { privateKeyToAccount } from "viem/accounts";
  import { contractsStore } from "$lib/contracts.svelte";
  import type { SolFile, SelectedContract } from "$lib/contracts.svelte";

  // ── Druid chain + default dev account ─────────────────────────────────────
  const druidChain = defineChain({
    id: 1337,
    name: "Druid",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://localhost:8545"] } },
  });

  const DEV_PRIVATE_KEY =
    "0xb71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291";

  const account = privateKeyToAccount(DEV_PRIVATE_KEY);

  const walletClient = createWalletClient({
    account,
    transport: http("http://localhost:8545"),
    chain: druidChain,
  });

  const publicClient = createPublicClient({
    transport: http("http://localhost:8545"),
    chain: druidChain,
  });

  // ── Local transient state (intentionally not persisted) ───────────────────
  let copied = $state("");

  // File editor (modal — always starts closed)
  let editorOpen    = $state(false);
  let editorFile    = $state<SolFile | null>(null);
  let editorContent = $state("");
  let editorOriginal = $state("");
  let editorSaving  = $state(false);
  let editorError   = $state("");
  let editorSaved   = $state(false);

  // Shorthand aliases so the template stays readable
  const s = contractsStore;

  // ── Duplicate detection ───────────────────────────────────────────────────
  let duplicateNames = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const file of s.solFiles) {
      for (const c of file.contracts) {
        counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
      }
    }
    const dupes = new Set<string>();
    for (const [name, count] of counts) {
      if (count > 1) dupes.add(name);
    }
    return dupes;
  });

  // ── Folder / editor ───────────────────────────────────────────────────────
  async function browseFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    s.folderPath = Array.isArray(selected) ? selected[0] : (selected as string);
    s.scanning = true;
    s.scanError = "";
    s.selected = [];
    try {
      s.solFiles = await invoke<SolFile[]>("scan_contracts", { folder: s.folderPath });
    } catch (e: any) {
      s.scanError = String(e);
      s.solFiles = [];
    }
    s.scanning = false;
  }

  async function openEditor(file: SolFile) {
    editorError = "";
    editorSaved = false;
    editorFile = file;
    try {
      const content = await invoke<string>("read_file", { path: file.path });
      editorContent = content;
      editorOriginal = content;
      editorOpen = true;
    } catch (e: any) {
      editorError = `Failed to read file: ${e}`;
    }
  }

  async function saveEditor() {
    if (!editorFile) return;
    editorSaving = true;
    editorError = "";
    try {
      await invoke("write_file", { path: editorFile.path, content: editorContent });
      editorOriginal = editorContent;
      editorSaved = true;
      // Any already-deployed contract from this file is now out of date — flag it
      // so the queue offers a redeploy.
      const savedPath = editorFile.path;
      s.selected = s.selected.map((sc) =>
        sc.deployed && sc.filePath === savedPath ? { ...sc, stale: true } : sc
      );
      s.solFiles = await invoke<SolFile[]>("scan_contracts", { folder: s.folderPath });
      setTimeout(() => (editorSaved = false), 2000);
    } catch (e: any) {
      editorError = `Failed to save: ${e}`;
    }
    editorSaving = false;
  }

  function closeEditor() {
    editorOpen = false;
    editorFile = null;
    editorContent = "";
    editorOriginal = "";
    editorError = "";
  }

  let editorDirty = $derived(editorContent !== editorOriginal);

  // ── Selection ─────────────────────────────────────────────────────────────
  function isSelected(name: string, filename: string): number | null {
    const idx = s.selected.findIndex((sc) => sc.name === name && sc.filename === filename);
    return idx >= 0 ? idx + 1 : null;
  }

  function toggleSelect(file: SolFile, contract: { name: string; kind: string; constructor_args: any[] }) {
    const existing = s.selected.findIndex(
      (sc) => sc.name === contract.name && sc.filename === file.filename
    );
    if (existing >= 0) {
      s.selected = s.selected
        .filter((_, i) => i !== existing)
        .map((sc, i) => ({ ...sc, order: i + 1 }));
    } else {
      s.selected = [
        ...s.selected,
        {
          order: s.selected.length + 1,
          name: contract.name,
          kind: contract.kind,
          filename: file.filename,
          filePath: file.path,
          constructorArgs: contract.constructor_args ?? [],
          argValues: {},
          deployState: "idle",
          deployed: false,
          stale: false,
        },
      ];
    }
  }

  function removeSelected(index: number) {
    s.selected = s.selected
      .filter((_, i) => i !== index)
      .map((sc, i) => ({ ...sc, order: i + 1 }));
  }

  // ── Arg parsing ───────────────────────────────────────────────────────────
  function parseArgValue(raw: string, solType: string): unknown {
    const t = solType.trim().toLowerCase();
    const v = raw.trim();
    if (t === "bool") return v === "true" || v === "1";
    if (t === "address") return v as `0x${string}`;
    if (t.startsWith("uint") || t.startsWith("int")) {
      try { return BigInt(v || "0"); } catch { return 0n; }
    }
    if (t.startsWith("bytes")) return v as `0x${string}`;
    return v;
  }

  // ── Solc compilation via Rust backend (Node.js + solc npm package) ────────
  async function compileSolidity(
    sc: SelectedContract
  ): Promise<{ abi: unknown[]; bytecode: `0x${string}` }> {
    const sources: Record<string, string> = {};
    for (const file of s.solFiles) {
      try {
        sources[file.filename] = await invoke<string>("read_file", { path: file.path });
      } catch { /* skip unreadable */ }
    }
    if (!sources[sc.filename]) throw new Error(`Could not read ${sc.filename}`);

    const result = await invoke<{ abi: string; bytecode: string }>("compile_contract", {
      sources,
      contractName: sc.name,
    });

    return {
      abi: JSON.parse(result.abi),
      bytecode: `0x${result.bytecode}` as `0x${string}`,
    };
  }

  // ── Deploy ────────────────────────────────────────────────────────────────
  async function deployContract(index: number) {
    const sc = s.selected[index];

    s.selected[index] = { ...sc, deployState: "compiling", deployError: undefined };
    let abi: unknown[];
    let bytecode: `0x${string}`;
    try {
      ({ abi, bytecode } = await compileSolidity(s.selected[index]));
    } catch (e: any) {
      s.selected[index] = { ...s.selected[index], deployState: "error", deployError: String(e) };
      return;
    }

    s.selected[index] = { ...s.selected[index], deployState: "deploying" };
    try {
      const args = s.selected[index].constructorArgs.map((arg, ai) => {
        const key = arg.name || `arg${ai}`;
        return parseArgValue(s.selected[index].argValues[key] ?? "", arg.arg_type);
      });

      const hash = await walletClient.deployContract({
        abi: abi as any,
        bytecode,
        args: s.selected[index].constructorArgs.length > 0 ? (args as any) : undefined,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      s.selected[index] = {
        ...s.selected[index],
        deployState: "deployed",
        deployed: true,
        stale: false,
        address: receipt.contractAddress ?? undefined,
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        abi,
      };
    } catch (e: any) {
      s.selected[index] = { ...s.selected[index], deployState: "error", deployError: String(e) };
    }
  }

  // ── Deploy-all gating ─────────────────────────────────────────────────────
  /** True when every constructor argument for `sc` has a non-empty value. */
  function argsFilled(sc: SelectedContract): boolean {
    return sc.constructorArgs.every((arg, ai) => {
      const key = arg.name || `arg${ai}`;
      return (sc.argValues[key] ?? "").trim() !== "";
    });
  }

  // Contracts that still need deploying: never deployed, or deployed but their
  // source changed since (stale). Failed ones also count as pending.
  let pending = $derived(s.selected.filter((sc) => !sc.deployed || sc.stale));
  // Deploy All is allowed only when there's something to do and every pending
  // contract has all of its constructor values filled in.
  let canDeployAll = $derived(pending.length > 0 && pending.every(argsFilled));

  async function deployAll() {
    if (!canDeployAll) return;
    for (let i = 0; i < s.selected.length; i++) {
      const sc = s.selected[i];
      if (sc.deployed && !sc.stale) continue; // already up to date
      await deployContract(i);
      // Stop the batch if a deploy fails, so dependents don't deploy against a
      // missing prerequisite.
      if (s.selected[i].deployState === "error") break;
    }
  }

  // ── Misc ──────────────────────────────────────────────────────────────────
  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    copied = key;
    setTimeout(() => (copied = ""), 1500);
  }

  const kindStyle: Record<string, string> = {
    "contract":          "bg-accent/10 text-accent",
    "abstract contract": "bg-primary/10 text-primary",
    "interface":         "bg-yellow/10 text-yellow",
    "library":           "bg-green/10 text-green",
  };
</script>

<!-- File Editor Modal -->
{#if editorOpen && editorFile}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
    <div class="flex h-full w-full max-w-4xl flex-col rounded-2xl border border-border bg-background shadow-2xl">

      <!-- Modal header -->
      <div class="flex items-center justify-between border-b border-border px-5 py-4">
        <div class="flex items-center gap-3 min-w-0">
          <FileCode size={16} class="shrink-0 text-accent" />
          <div class="min-w-0">
            <div class="text-sm font-semibold text-text">{editorFile.filename}</div>
            <div class="truncate font-mono text-[10px] text-text-dimmer">{editorFile.path}</div>
          </div>
          {#if editorDirty}
            <span class="shrink-0 rounded-full bg-yellow/15 px-2 py-0.5 text-[10px] text-yellow">unsaved</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <button
            onclick={saveEditor}
            disabled={editorSaving || !editorDirty}
            class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:opacity-40
              {editorSaved ? 'bg-green/15 text-green' : 'bg-accent/10 text-accent hover:bg-accent/20'}"
          >
            {#if editorSaved}
              <Check size={14} /> Saved
            {:else}
              <Save size={14} /> {editorSaving ? "Saving..." : "Save"}
            {/if}
          </button>
          <button
            onclick={closeEditor}
            class="rounded-lg p-2 text-text-dim transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {#if editorError}
        <div class="flex items-center gap-2 border-b border-border bg-red/10 px-5 py-2 text-xs text-red">
          <AlertTriangle size={13} /> {editorError}
        </div>
      {/if}

      <textarea
        bind:value={editorContent}
        spellcheck="false"
        class="flex-1 resize-none bg-transparent p-5 font-mono text-sm text-text outline-none"
        onkeydown={(e) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveEditor(); } }}
      ></textarea>

      <div class="flex items-center justify-between border-t border-border px-5 py-2 text-[10px] text-text-dimmer">
        <span>Solidity</span>
        <span>Ctrl+S to save</span>
      </div>
    </div>
  </div>
{/if}

<!-- Main page -->
<div class="flex min-h-0 flex-1 flex-col p-6">
  <div class="mb-6">
    <h1 class="text-xl font-semibold text-text">Contracts</h1>
    <p class="text-sm text-text-dim">Browse Solidity sources, pick deploy order, and deploy</p>
  </div>

  <!-- Folder picker -->
  <div class="mb-5 flex flex-wrap items-center gap-3">
    <button
      class="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      onclick={browseFolder}
      disabled={s.scanning}
    >
      <FolderOpen size={15} /> {s.scanning ? "Scanning..." : "Browse Folder"}
    </button>
    {#if s.folderPath}
      <div class="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
        <FileCode size={14} class="shrink-0 text-text-dimmer" />
        <span class="truncate font-mono text-text-dim">{s.folderPath}</span>
        {#if s.solFiles.length > 0}
          <span class="shrink-0 text-text-dimmer">&middot; {s.solFiles.length} file{s.solFiles.length !== 1 ? "s" : ""}</span>
        {/if}
      </div>
    {/if}
    {#if s.scanError}
      <div class="flex items-center gap-2 rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
        <AlertTriangle size={13} class="shrink-0" /> {s.scanError}
      </div>
    {/if}
    {#if duplicateNames.size > 0}
      <div class="flex items-center gap-2 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-xs text-yellow">
        <AlertTriangle size={13} class="shrink-0" />
        {duplicateNames.size} duplicate name{duplicateNames.size > 1 ? "s" : ""} —
        <span class="font-mono">{[...duplicateNames].join(", ")}</span>. Edit files to fix.
      </div>
    {/if}
  </div>

  {#if !s.folderPath}
    <div class="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20 text-center">
      <FolderOpen size={48} class="mb-3 text-text-dimmer" />
      <p class="text-sm text-text-dim">No project folder loaded</p>
      <p class="text-xs text-text-dimmer">Browse a folder containing Solidity source files to get started</p>
    </div>
  {:else if s.solFiles.length === 0 && !s.scanning}
    <div class="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20 text-center">
      <FileCode size={48} class="mb-3 text-text-dimmer" />
      <p class="text-sm text-text-dim">No Solidity files found</p>
      <p class="text-xs text-text-dimmer">Make sure the folder contains .sol files</p>
    </div>
  {:else if s.solFiles.length > 0}
    <div class="flex min-h-0 flex-1 gap-5">

      <!-- LEFT: File groups -->
      <div class="flex w-80 shrink-0 flex-col">
        <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-text-dimmer">Source Files</h2>
        <div class="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-1 p-2">
          {#each s.solFiles as file}
            <div class="mb-2">
              <div class="mb-1 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <FileCode size={13} class="shrink-0 text-text-dimmer" />
                <span class="flex-1 truncate font-mono text-xs text-text">{file.filename}</span>
                <span class="shrink-0 text-[10px] text-text-dimmer">{file.contracts.length}</span>
                <button
                  onclick={() => openEditor(file)}
                  class="shrink-0 rounded p-1 text-text-dimmer transition-colors hover:bg-surface-3 hover:text-accent"
                  title="Edit file"
                >
                  <Pencil size={11} />
                </button>
              </div>

              <div class="flex flex-col gap-0.5 pl-3">
                {#each file.contracts as contract}
                  {@const order = isSelected(contract.name, file.filename)}
                  {@const isDupe = duplicateNames.has(contract.name)}
                  {@const hasConstructor = (contract.constructor_args ?? []).length > 0}
                  <button
                    class="group flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all
                      {order
                        ? 'border-accent/30 bg-accent/15'
                        : isDupe
                          ? 'border-yellow/25 bg-yellow/5 hover:border-yellow/50'
                          : 'border-transparent bg-surface-2/50 hover:border-border hover:bg-surface-3'}"
                    onclick={() => toggleSelect(file, contract)}
                  >
                    {#if order}
                      <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-bold text-white">
                        {order}
                      </div>
                    {:else}
                      <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-3 text-[10px] text-text-dimmer group-hover:bg-border">
                        +
                      </div>
                    {/if}
                    {#if isDupe}
                      <AlertTriangle size={11} class="shrink-0 text-yellow" />
                    {/if}
                    <span class="flex-1 truncate text-sm {order ? 'font-medium text-accent-hover' : isDupe ? 'text-yellow' : 'text-text'}">
                      {contract.name}
                    </span>
                    <span class="shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium {kindStyle[contract.kind] ?? 'bg-surface-3 text-text-dimmer'}">
                      {contract.kind}
                    </span>
                    {#if hasConstructor}
                      <span class="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-medium text-primary">
                        ctor({(contract.constructor_args ?? []).length})
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <div class="mt-2 text-xs text-text-dimmer">Click contract to select · ✏ to edit file</div>
      </div>

      <!-- RIGHT: Deploy queue -->
      <div class="flex flex-1 flex-col min-w-0">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-xs font-medium uppercase tracking-wider text-text-dimmer">
            Deploy Queue ({s.selected.length})
          </h2>
          {#if pending.length > 0}
            <button
              class="flex items-center gap-2 rounded-lg bg-green px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              onclick={deployAll}
              disabled={!canDeployAll}
              title={canDeployAll ? "Deploy all pending contracts" : "Fill in every constructor value to enable Deploy All"}
            >
              <Rocket size={14} /> Deploy All
            </button>
          {/if}
        </div>

        <div class="flex-1 overflow-y-auto">
          {#if s.selected.length === 0}
            <div class="flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
              <ArrowRight size={32} class="mb-3 -rotate-180 text-text-dimmer" />
              <p class="text-sm text-text-dim">Select contracts from the left</p>
              <p class="text-xs text-text-dimmer">Click in the order you want them deployed</p>
            </div>
          {:else}
            <div class="flex flex-col gap-3">
              {#each s.selected as sc, i}
                <div class="rounded-xl border bg-surface-1 {sc.deployed ? 'border-green/30' : 'border-border'}">
                  <div class="flex items-center gap-3 px-4 py-3">
                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md {sc.deployed ? 'bg-green/15 text-green' : 'bg-accent/15 text-accent'} text-xs font-bold">
                      {sc.order}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold text-text">{sc.name}</span>
                        <span class="font-mono text-xs text-text-dimmer">{sc.filename}</span>
                        <span class="rounded-full px-1.5 py-px text-[9px] font-medium {kindStyle[sc.kind] ?? ''}">
                          {sc.kind}
                        </span>
                        {#if sc.deployed && !sc.stale}
                          <span class="rounded-full bg-green/15 px-2 py-0.5 text-xs font-medium text-green">Deployed</span>
                        {/if}
                        {#if sc.deployed && sc.stale}
                          <span class="rounded-full bg-yellow/15 px-2 py-0.5 text-xs font-medium text-yellow">Source changed</span>
                        {/if}
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      {#if sc.deployState === "idle"}
                        <button
                          class="flex items-center gap-1.5 rounded-lg bg-green/15 px-3 py-1.5 text-xs font-medium text-green transition-colors hover:bg-green/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-green/15"
                          onclick={() => deployContract(i)}
                          disabled={!argsFilled(sc)}
                          title={argsFilled(sc) ? "" : "Fill in all constructor values first"}
                        >
                          <Rocket size={12} /> Deploy
                        </button>
                      {:else if sc.deployState === "compiling"}
                        <div class="flex items-center gap-1.5 rounded-lg bg-yellow/10 px-3 py-1.5 text-xs font-medium text-yellow">
                          <Loader size={12} class="animate-spin" /> Compiling…
                        </div>
                      {:else if sc.deployState === "deploying"}
                        <div class="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">
                          <Loader size={12} class="animate-spin" /> Deploying…
                        </div>
                      {:else if sc.deployState === "error"}
                        <button
                          class="flex items-center gap-1.5 rounded-lg bg-red/10 px-3 py-1.5 text-xs font-medium text-red transition-colors hover:bg-red/20"
                          onclick={() => deployContract(i)}
                          title={sc.deployError}
                        >
                          <AlertTriangle size={12} /> Retry
                        </button>
                      {:else if sc.deployState === "deployed"}
                        {#if sc.stale}
                          <button
                            class="flex items-center gap-1.5 rounded-lg bg-yellow/15 px-3 py-1.5 text-xs font-medium text-yellow transition-colors hover:bg-yellow/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-yellow/15"
                            onclick={() => deployContract(i)}
                            disabled={!argsFilled(sc)}
                            title={argsFilled(sc) ? "Redeploy with the updated source" : "Fill in all constructor values first"}
                          >
                            <RotateCcw size={12} /> Redeploy
                          </button>
                        {:else}
                          <div class="flex items-center gap-1.5 rounded-lg bg-green/10 px-3 py-1.5 text-xs font-medium text-green">
                            <Check size={12} /> Done
                          </div>
                        {/if}
                      {/if}
                      <button
                        class="rounded-md p-1.5 text-text-dim transition-colors hover:bg-surface-2 hover:text-text"
                        onclick={() => (s.expandedDeploy[sc.name] = !s.expandedDeploy[sc.name])}
                      >
                        {#if s.expandedDeploy[sc.name]}
                          <ChevronDown size={16} />
                        {:else}
                          <ChevronRight size={16} />
                        {/if}
                      </button>
                      <button
                        class="rounded-md p-1.5 text-text-dim transition-colors hover:bg-red/15 hover:text-red"
                        onclick={() => removeSelected(i)}
                        disabled={sc.deployState === "compiling" || sc.deployState === "deploying"}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {#if sc.deployState === "error" && sc.deployError}
                    <div class="flex items-start gap-2 border-t border-red/20 bg-red/5 px-4 py-2.5 text-xs text-red">
                      <AlertTriangle size={12} class="mt-0.5 shrink-0" />
                      <span class="font-mono break-all">{sc.deployError}</span>
                    </div>
                  {/if}

                  {#if sc.constructorArgs.length > 0 && (!sc.deployed || sc.stale)}
                    <div class="border-t border-border px-4 py-3">
                      <div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-dimmer">
                        Constructor Arguments
                      </div>
                      <div class="flex flex-col gap-2">
                        {#each sc.constructorArgs as arg, ai}
                          <div class="flex items-center gap-3">
                            <div class="w-32 shrink-0">
                              <div class="truncate font-mono text-[10px] text-accent">{arg.arg_type}</div>
                              <div class="truncate text-xs text-text-dim">{arg.name || `arg${ai}`}</div>
                            </div>
                            <input
                              type="text"
                              placeholder={arg.arg_type === "bool" ? "true / false" : arg.arg_type.startsWith("uint") || arg.arg_type.startsWith("int") ? "0" : arg.arg_type === "address" ? "0x..." : "value"}
                              bind:value={sc.argValues[arg.name || `arg${ai}`]}
                              class="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-text outline-none focus:border-accent/50"
                            />
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if sc.deployed}
                    <div class="border-t border-border px-4 py-3">
                      <div class="flex flex-col gap-2">
                        <div class="flex items-center justify-between rounded-lg bg-green/5 px-3 py-2">
                          <div>
                            <div class="text-xs text-text-dimmer">Contract Address</div>
                            <div class="font-mono text-sm text-green">{sc.address}</div>
                          </div>
                          <button
                            class="rounded-md p-1.5 text-text-dim hover:text-text"
                            onclick={() => copyText(sc.address ?? "", `addr-${i}`)}
                          >
                            {#if copied === `addr-${i}`}
                              <Check size={12} class="text-green" />
                            {:else}
                              <Copy size={12} />
                            {/if}
                          </button>
                        </div>
                        <div class="flex gap-3 text-xs">
                          <div class="flex-1 rounded-lg bg-surface-2 px-3 py-2">
                            <span class="text-text-dimmer">Tx Hash: </span>
                            <span class="font-mono text-text">{sc.txHash?.slice(0, 18)}...</span>
                          </div>
                          <div class="rounded-lg bg-surface-2 px-3 py-2">
                            <span class="text-text-dimmer">Block: </span>
                            <span class="font-mono text-text">#{sc.blockNumber}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
