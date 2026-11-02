<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { Play, Loader, AlertTriangle } from "lucide-svelte";

  // Svelte Flow passes node props (id, data, …) to custom node components.
  let { id, data }: { id: string; data: any } = $props();

  // run() is provided by FunctionFlow via context (it owns the viem clients).
  const flow: any = getContext("cleric-flow");

  function mutClass(m?: string) {
    if (m === "view" || m === "pure") return "text-accent";
    if (m === "payable") return "text-yellow";
    return "text-green";
  }
</script>

<div class="w-64 rounded-xl border border-border bg-surface-1 shadow-lg backdrop-blur">
  <!-- incoming flow -->
  <Handle type="target" position={Position.Left} />

  <div class="flex items-center gap-2 border-b border-border px-3 py-2">
    <span class="flex-1 truncate font-mono text-xs font-semibold text-text">{data.name}</span>
    {#if data.stateMutability}
      <span class="shrink-0 text-[9px] font-medium uppercase {mutClass(data.stateMutability)}">
        {data.stateMutability}
      </span>
    {/if}
  </div>
  <div class="truncate px-3 pt-1.5 text-[10px] text-text-dimmer">{data.contract}</div>

  <div class="flex flex-col gap-2 p-3">
    {#if (data.inputs ?? []).length === 0}
      <div class="text-[10px] text-text-dimmer">No inputs</div>
    {:else}
      {#each data.inputs as inp, i}
        {@const key = inp.name || `arg${i}`}
        <div>
          <div class="mb-0.5 truncate font-mono text-[9px] text-text-dimmer">{key}: {inp.type}</div>
          <input
            class="nodrag w-full rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-text outline-none focus:border-accent/50"
            placeholder={inp.type}
            bind:value={data.values[key]}
          />
        </div>
      {/each}
    {/if}

    <button
      class="mt-1 flex items-center justify-center gap-1.5 rounded-md bg-green/15 px-3 py-1.5 text-[11px] font-medium text-green transition-colors hover:bg-green/25 disabled:opacity-50"
      onclick={() => flow?.run(id)}
      disabled={data.running}
    >
      {#if data.running}
        <Loader size={12} class="animate-spin" /> Running…
      {:else}
        <Play size={12} /> Run
      {/if}
    </button>

    {#if data.error}
      <div class="flex items-start gap-1 text-[10px] text-red">
        <AlertTriangle size={11} class="mt-0.5 shrink-0" />
        <span class="break-all">{data.error}</span>
      </div>
    {/if}
  </div>

  <!-- result -> output card -->
  <Handle type="source" position={Position.Bottom} id="out" style="left: 28px" />
  <!-- continue the flow to the next function -->
  <Handle type="source" position={Position.Right} id="next" />
</div>
