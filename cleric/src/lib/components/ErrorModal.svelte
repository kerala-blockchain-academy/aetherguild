<script lang="ts">
  import { errorDialog } from "$lib/stores/errorDialog.svelte";
  import { AlertOctagon, X, Copy, Check } from "lucide-svelte";
  import { fade, scale } from "svelte/transition";

  let copied = $state(false);

  // Lines that look like failures get highlighted in the scrollable log view.
  const ERROR_RE = /(error|panic|fatal|failed|cannot|refused|unable|denied)/i;

  let lines = $derived(
    errorDialog.detail
      ? errorDialog.detail.split(/\r?\n/).filter((l) => l.trim().length > 0)
      : [],
  );

  function copyDetail() {
    navigator.clipboard.writeText(errorDialog.detail);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if errorDialog.open}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    transition:fade={{ duration: 120 }}
    onclick={(e) => {
      if (e.target === e.currentTarget) errorDialog.close();
    }}
    role="presentation"
  >
    <div
      class="glass-panel flex w-full max-w-lg flex-col overflow-hidden rounded-2xl shadow-2xl"
      transition:scale={{ duration: 150, start: 0.96 }}
    >
      <!-- Header -->
      <div class="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red/15 text-red">
          <AlertOctagon size={17} />
        </div>
        <div class="min-w-0 flex-1 text-sm font-semibold text-text">{errorDialog.title}</div>
        <button
          class="rounded-lg p-1.5 text-text-dim transition-colors hover:bg-surface-2 hover:text-text"
          onclick={() => errorDialog.close()}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <!-- Body -->
      <div class="flex flex-col gap-3 px-5 py-4">
        {#if errorDialog.message}
          <p class="whitespace-pre-wrap text-sm text-text-dim">{errorDialog.message}</p>
        {/if}

        {#if lines.length > 0}
          <div class="flex items-center justify-between">
            <span class="text-[0.65rem] font-bold uppercase tracking-wider text-text-dimmer">
              Recent Logs
            </span>
            <button
              class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-dim transition-colors hover:bg-surface-2 hover:text-text"
              onclick={copyDetail}
            >
              {#if copied}
                <Check size={12} class="text-green" /> Copied
              {:else}
                <Copy size={12} /> Copy
              {/if}
            </button>
          </div>
          <div class="max-h-44 overflow-y-auto rounded-lg border border-border bg-background font-mono text-xs">
            {#each lines as line}
              <div
                class="break-all px-3 py-[3px] {ERROR_RE.test(line)
                  ? 'border-l-2 border-red/50 bg-red/10 text-red'
                  : 'text-text-dim'}"
              >
                {line}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-end border-t border-border px-5 py-3">
        <button
          class="rounded-lg bg-red/15 px-4 py-2 text-sm font-medium text-red transition-colors hover:bg-red/25"
          onclick={() => errorDialog.close()}
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
{/if}
