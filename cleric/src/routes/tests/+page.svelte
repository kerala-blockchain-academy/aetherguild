<script lang="ts">
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import FunctionFlow from "$lib/components/FunctionFlow.svelte";
  import { contractsStore } from "$lib/contracts.svelte";
  import type { SelectedContract } from "$lib/contracts.svelte";
  import {
    Box,
    ChevronDown,
    ChevronRight,
    FunctionSquare,
    FlaskConical,
    GripVertical,
  } from "lucide-svelte";

  const s = contractsStore;

  interface AbiFn {
    name: string;
    inputs: { name: string; type: string }[];
    stateMutability?: string;
  }

  // Only contracts that have actually been deployed are testable.
  let deployed = $derived(s.selected.filter((sc) => sc.deployed));

  let expanded = $state<Record<string, boolean>>({});

  function functionsOf(sc: SelectedContract): AbiFn[] {
    return (sc.abi ?? []).filter((item: any) => item?.type === "function") as AbiFn[];
  }

  function signature(fn: AbiFn): string {
    return `${fn.name}(${(fn.inputs ?? []).map((i) => i.type).join(", ")})`;
  }

  // Read-only vs state-changing, for the little colour cue.
  function mutabilityClass(m?: string): string {
    if (m === "view" || m === "pure") return "text-accent";
    if (m === "payable") return "text-yellow";
    return "text-green";
  }

  function onDragStart(event: DragEvent, sc: SelectedContract, fn: AbiFn) {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(
      "application/cleric-fn",
      JSON.stringify({
        contract: sc.name,
        address: sc.address,
        name: fn.name,
        signature: signature(fn),
        stateMutability: fn.stateMutability,
        inputs: fn.inputs ?? [],
        abiItem: fn,
      }),
    );
    event.dataTransfer.effectAllowed = "move";
  }
</script>

<div class="flex min-h-0 flex-1 flex-col p-6">
  <div class="mb-5">
    <h1 class="text-xl font-semibold text-text">Tests</h1>
    <p class="text-sm text-text-dim">
      Drag contract functions onto the canvas to build a test flow
    </p>
  </div>

  <SvelteFlowProvider>
    <div class="flex min-h-0 flex-1 gap-5">
      <!-- LEFT: deployed contracts + their functions -->
      <div class="flex w-80 shrink-0 flex-col">
        <h2 class="mb-3 text-xs font-medium uppercase tracking-wider text-text-dimmer">
          Deployed Contracts
        </h2>

        {#if deployed.length === 0}
          <div class="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
            <FlaskConical size={36} class="mb-3 text-text-dimmer" />
            <p class="text-sm text-text-dim">No deployed contracts yet</p>
            <p class="text-xs text-text-dimmer">Deploy contracts from the Contracts tab first</p>
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto rounded-xl border border-border bg-surface-1 p-2">
            {#each deployed as sc (sc.address)}
              {@const fns = functionsOf(sc)}
              {@const key = sc.address ?? sc.name}
              <div class="mb-2">
                <!-- Contract header (expand/collapse) -->
                <button
                  class="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left transition-colors hover:border-border-hover"
                  onclick={() => (expanded[key] = !expanded[key])}
                >
                  {#if expanded[key]}
                    <ChevronDown size={14} class="shrink-0 text-text-dimmer" />
                  {:else}
                    <ChevronRight size={14} class="shrink-0 text-text-dimmer" />
                  {/if}
                  <Box size={13} class="shrink-0 text-accent" />
                  <span class="flex-1 truncate text-sm font-medium text-text">{sc.name}</span>
                  <span class="shrink-0 rounded-full bg-surface-3 px-1.5 py-px text-[9px] text-text-dimmer">
                    {fns.length} fn
                  </span>
                </button>

                <!-- Functions -->
                {#if expanded[key]}
                  <div class="mt-1 flex flex-col gap-0.5 pl-3">
                    {#if fns.length === 0}
                      <div class="px-3 py-2 text-xs text-text-dimmer">No callable functions</div>
                    {:else}
                      {#each fns as fn}
                        <div
                          role="button"
                          tabindex="0"
                          draggable="true"
                          ondragstart={(e) => onDragStart(e, sc, fn)}
                          class="group flex cursor-grab items-center gap-2 rounded-lg border border-transparent bg-surface-2/50 px-2.5 py-2 transition-all hover:border-border hover:bg-surface-3 active:cursor-grabbing"
                          title="Drag onto the canvas"
                        >
                          <GripVertical size={13} class="shrink-0 text-text-dimmer opacity-0 transition-opacity group-hover:opacity-100" />
                          <FunctionSquare size={13} class="shrink-0 {mutabilityClass(fn.stateMutability)}" />
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-mono text-xs text-text">{fn.name}</div>
                            {#if (fn.inputs ?? []).length > 0}
                              <div class="truncate font-mono text-[10px] text-text-dimmer">
                                ({(fn.inputs ?? []).map((i) => i.type).join(", ")})
                              </div>
                            {/if}
                          </div>
                          {#if fn.stateMutability}
                            <span class="shrink-0 text-[9px] font-medium uppercase {mutabilityClass(fn.stateMutability)}">
                              {fn.stateMutability}
                            </span>
                          {/if}
                        </div>
                      {/each}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          <div class="mt-2 text-xs text-text-dimmer">Drag a function onto the canvas →</div>
        {/if}
      </div>

      <!-- RIGHT: drag-and-drop flow canvas -->
      <div class="min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface-1">
        <FunctionFlow />
      </div>
    </div>
  </SvelteFlowProvider>
</div>
