<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";
  import { Search, Box, ChevronRight, RefreshCw } from "lucide-svelte";
  import {
    getBlockNumber,
    getBlockByNumber,
    formatGas,
    formatAge,
    hexToNum,
  } from "$lib/rpc";

  const PAGE = 10;

  let searchQuery = $state("");
  let blocks = $state<any[]>([]);
  let latestBlock = $state(-1);
  let oldestLoaded = $state(0);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state("");
  let interval: ReturnType<typeof setInterval>;

  async function fetchBlocks(from: number, count: number): Promise<any[]> {
    const nums = Array.from({ length: count }, (_, i) => from - i).filter((n) => n >= 0);
    const results = await Promise.all(nums.map((n) => getBlockByNumber(n, false)));
    return results.filter(Boolean);
  }

  async function init() {
    loading = true;
    error = "";
    try {
      latestBlock = await getBlockNumber();
      oldestLoaded = Math.max(latestBlock - PAGE + 1, 0);
      blocks = await fetchBlocks(latestBlock, PAGE);
    } catch (e: any) {
      error = e.message ?? "Failed to connect to Druid";
    }
    loading = false;
  }

  async function loadMore() {
    if (oldestLoaded <= 0 || loadingMore) return;
    loadingMore = true;
    try {
      const from = oldestLoaded - 1;
      const more = await fetchBlocks(from, PAGE);
      blocks = [...blocks, ...more];
      oldestLoaded = Math.max(oldestLoaded - PAGE, 0);
    } catch {}
    loadingMore = false;
  }

  async function poll() {
    try {
      const latest = await getBlockNumber();
      if (latest > latestBlock) {
        const newBlocks = await fetchBlocks(latest, latest - latestBlock);
        blocks = [...newBlocks, ...blocks];
        latestBlock = latest;
      }
    } catch {}
  }

  function handleSearch(e: KeyboardEvent) {
    if (e.key !== "Enter" || !searchQuery.trim()) return;
    const q = searchQuery.trim();
    if (q.startsWith("0x") && q.length === 66) {
      goto(`/explorer/${q}`);
    } else {
      const n = parseInt(q);
      if (!isNaN(n)) goto(`/explorer/${n}`);
    }
  }

  onMount(() => {
    init();
    interval = setInterval(poll, 3000);
  });

  onDestroy(() => clearInterval(interval));
</script>

<div class="flex flex-1 flex-col overflow-y-auto">
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-text">Explorer</h1>
        <p class="text-sm text-text-dim">Browse blocks and transactions on the dev chain</p>
      </div>
      {#if latestBlock >= 0}
        <div class="font-mono text-xs text-text-dimmer">
          Latest block: <span class="text-accent">#{latestBlock}</span>
        </div>
      {/if}
    </div>

    <!-- Search -->
    <div class="mb-5 flex gap-2">
      <div class="relative flex-1">
        <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-dimmer" />
        <input
          type="text"
          placeholder="Search by block number or transaction hash..."
          bind:value={searchQuery}
          onkeydown={handleSearch}
          class="w-full rounded-lg border border-border bg-surface-1 py-2.5 pl-10 pr-4 text-sm text-text placeholder:text-text-dimmer focus:border-accent focus:outline-none"
        />
      </div>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-20 text-text-dimmer gap-3">
        <RefreshCw size={18} class="animate-spin" /> Loading blocks...
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center py-20 text-center">
        <p class="text-sm text-red">{error}</p>
        <p class="mt-1 text-xs text-text-dimmer">Make sure Druid is running.</p>
        <button
          class="mt-4 rounded-lg bg-surface-2 px-4 py-2 text-sm text-text-dim hover:bg-surface-3"
          onclick={init}
        >
          Retry
        </button>
      </div>
    {:else if blocks.length === 0}
      <div class="flex items-center justify-center py-20 text-text-dimmer">
        <p class="text-sm">No blocks found.</p>
      </div>
    {:else}
      <!-- Block table -->
      <div class="overflow-hidden rounded-xl border border-border bg-surface-1">
        <table class="w-full">
          <thead>
            <tr class="border-b border-border text-left text-xs text-text-dimmer">
              <th class="px-4 py-3 font-medium">Block</th>
              <th class="px-4 py-3 font-medium">Age</th>
              <th class="px-4 py-3 font-medium text-right">Txns</th>
              <th class="px-4 py-3 font-medium text-right">Gas Used</th>
              <th class="w-10 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {#each blocks as block (block.hash)}
              <tr class="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                <td class="px-4 py-3">
                  <a
                    href="/explorer/{hexToNum(block.number)}"
                    class="flex items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover"
                  >
                    <Box size={14} class="text-text-dimmer" />
                    #{hexToNum(block.number)}
                  </a>
                </td>
                <td class="px-4 py-3 text-sm text-text-dim">{formatAge(block.timestamp)}</td>
                <td class="px-4 py-3 text-right text-sm text-text">{block.transactions.length}</td>
                <td class="px-4 py-3 text-right font-mono text-sm text-text-dim">{formatGas(block.gasUsed)}</td>
                <td class="px-4 py-3 text-right">
                  <a href="/explorer/{hexToNum(block.number)}" class="text-text-dimmer hover:text-text">
                    <ChevronRight size={16} />
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Load more -->
      {#if oldestLoaded > 0}
        <div class="mt-4 flex justify-center">
          <button
            class="rounded-lg bg-surface-2 px-4 py-2 text-sm text-text-dim transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-50"
            onclick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load More Blocks"}
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>
