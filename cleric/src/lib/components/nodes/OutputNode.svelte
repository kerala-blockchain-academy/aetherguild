<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import { ArrowDownToLine } from "lucide-svelte";

  let { data }: { data: any } = $props();
</script>

<div class="w-56 rounded-xl border border-border bg-surface-1 shadow-lg backdrop-blur">
  <!-- result comes in from a function node's output handle -->
  <Handle type="target" position={Position.Top} />

  <div class="flex items-center gap-2 border-b border-border px-3 py-2">
    <ArrowDownToLine size={12} class="shrink-0 text-accent" />
    <span class="flex-1 truncate text-[11px] font-semibold text-text">{data.label ?? "Output"}</span>
  </div>

  <div class="p-3">
    {#if data.status === "error"}
      <div class="break-all font-mono text-[11px] text-red">{data.result ?? "Error"}</div>
    {:else if data.result !== undefined && data.result !== ""}
      <div class="break-all font-mono text-[11px] font-medium text-green">{data.result}</div>
    {:else}
      <div class="text-[10px] text-text-dimmer">Awaiting run…</div>
    {/if}
  </div>

  <!-- allow chaining the result onward if desired -->
  <Handle type="source" position={Position.Bottom} />
</div>
