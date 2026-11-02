<script lang="ts">
  import { getLogs, clearLogs } from "$lib/stores/logs.svelte";
  import { Trash2 } from "lucide-svelte";
  import { tick } from "svelte";

  type Level = "INFO" | "WARN" | "ERROR" | "DEBUG";

  let filterText = $state("");
  let activeLevels = $state<Set<Level>>(new Set(["INFO", "WARN", "ERROR", "DEBUG"]));
  let logEl = $state<HTMLDivElement | null>(null);
  let autoScroll = $state(true);

  const LEVELS: Level[] = ["INFO", "WARN", "ERROR", "DEBUG"];

  const levelStyle: Record<Level, { badge: string; row: string; text: string }> = {
    INFO:  { badge: "bg-accent/15 text-accent",   row: "",                              text: "text-text" },
    WARN:  { badge: "bg-yellow/15 text-yellow",   row: "bg-yellow/5 border-l-2 border-yellow/40", text: "text-yellow" },
    ERROR: { badge: "bg-red/15 text-red",   row: "bg-red/5 border-l-2 border-red/40", text: "text-red" },
    DEBUG: { badge: "bg-surface-3 text-text-dimmer",     row: "",                              text: "text-text-dimmer" },
  };

  let logs = $derived(getLogs());

  let filtered = $derived(
    logs.filter(
      (e) =>
        activeLevels.has(e.level) &&
        (filterText === "" || e.raw.toLowerCase().includes(filterText.toLowerCase()))
    )
  );

  function toggleLevel(level: Level) {
    if (activeLevels.has(level)) {
      if (activeLevels.size > 1) activeLevels.delete(level);
    } else {
      activeLevels.add(level);
    }
    activeLevels = new Set(activeLevels);
  }

  function handleScroll() {
    if (!logEl) return;
    const { scrollTop, scrollHeight, clientHeight } = logEl;
    autoScroll = scrollHeight - scrollTop - clientHeight < 40;
  }

  $effect(() => {
    // Reactive on filtered length so we scroll when new logs arrive
    filtered.length;
    if (autoScroll && logEl) {
      tick().then(() => {
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
      });
    }
  });
</script>

<div class="flex flex-1 flex-col overflow-hidden p-6">
  <!-- Header -->
  <div class="mb-5 flex items-start justify-between">
    <div>
      <h1 class="text-xl font-semibold text-text">Logs</h1>
      <p class="text-sm text-text-dim">Real-time output from the Druid process</p>
    </div>
    <button
      class="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-text-dim border border-border transition-colors hover:bg-red/10 hover:text-red hover:border-red/30"
      onclick={clearLogs}
    >
      <Trash2 size={14} /> Clear
    </button>
  </div>

  <!-- Filter + Levels -->
  <div class="mb-4 flex flex-col gap-3">
    <input
      type="text"
      placeholder="Filter logs..."
      bind:value={filterText}
      class="glass-input w-full rounded-xl px-4 py-2.5 text-sm font-mono placeholder:text-text-dimmer/70"
    />
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <span class="mr-1 text-xs text-text-dimmer">Levels:</span>
        {#each LEVELS as level}
          <button
            class="rounded-md px-2.5 py-1 text-xs font-bold tracking-wide transition-all
              {activeLevels.has(level)
                ? levelStyle[level].badge
                : 'bg-surface-2 text-text-dimmer opacity-40 hover:opacity-70'}"
            onclick={() => toggleLevel(level)}
          >
            {level}
          </button>
        {/each}
      </div>
      <span class="font-mono text-xs text-text-dimmer">
        {filtered.length} / {logs.length}
      </span>
    </div>
  </div>

  <!-- Log list -->
  <div
    bind:this={logEl}
    onscroll={handleScroll}
    class="flex-1 overflow-y-auto rounded-xl border border-border bg-background font-mono text-xs"
  >
    {#if filtered.length === 0}
      <div class="flex h-full flex-col items-center justify-center text-text-dimmer">
        <p class="text-sm">{logs.length === 0 ? "No logs yet — start Druid to see output." : "No logs match the current filter."}</p>
      </div>
    {:else}
      {#each filtered as entry (entry.id)}
        <div class="flex items-start gap-3 px-4 py-[3px] {levelStyle[entry.level].row} hover:bg-text/[0.04]">
          <span class="mt-[1px] shrink-0 text-text-dimmer">{entry.time}</span>
          <span class="mt-[1px] shrink-0 rounded px-1.5 py-px text-[10px] font-bold {levelStyle[entry.level].badge}">{entry.level}</span>
          <span class="min-w-0 break-all {levelStyle[entry.level].text}">{entry.raw}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>
