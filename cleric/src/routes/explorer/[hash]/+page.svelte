<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { ArrowLeft, Copy, Check, ArrowRight, RefreshCw } from "lucide-svelte";
  import {
    getBlockByNumber,
    getTransactionByHash,
    formatGas,
    formatAge,
    formatTimestamp,
    formatEth,
    hexToNum,
  } from "$lib/rpc";

  let copied = $state("");
  let loading = $state(true);
  let error = $state("");
  let block = $state<any>(null);
  let tx = $state<any>(null);

  const param = $derived($page.params.hash);
  // Tx hash: starts with 0x and is 66 chars
  const isTx = $derived(param.startsWith("0x") && param.length === 66);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    copied = key;
    setTimeout(() => (copied = ""), 1500);
  }

  async function load() {
    loading = true;
    error = "";
    block = null;
    tx = null;
    try {
      if (isTx) {
        tx = await getTransactionByHash(param);
        if (!tx) throw new Error("Transaction not found");
      } else {
        const n = parseInt(param);
        if (isNaN(n)) throw new Error("Invalid block number");
        block = await getBlockByNumber(n, true);
        if (!block) throw new Error("Block not found");
      }
    } catch (e: any) {
      error = e.message ?? "Failed to load";
    }
    loading = false;
  }

  onMount(load);

  $effect(() => {
    param; // re-run when param changes
    load();
  });
</script>

<div class="flex-1 overflow-y-auto">
  <div class="p-6">
    <a
      href="/explorer"
      class="mb-4 inline-flex items-center gap-1.5 text-sm text-text-dim transition-colors hover:text-text"
    >
      <ArrowLeft size={14} /> Back to Explorer
    </a>

    {#if loading}
      <div class="flex items-center justify-center py-20 text-text-dimmer gap-3">
        <RefreshCw size={18} class="animate-spin" /> Loading...
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center py-20 text-center">
        <p class="text-sm text-red">{error}</p>
        <p class="mt-1 text-xs text-text-dimmer">Make sure Druid is running.</p>
      </div>
    {:else if block}
      <!-- Block Detail -->
      <h1 class="mb-6 text-xl font-semibold">Block #{hexToNum(block.number)}</h1>

      <div class="mb-6 rounded-xl border border-border bg-surface-1 p-5">
        <h2 class="mb-4 text-sm font-medium text-text-dim">Block Header</h2>
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {#each [
            { label: "Block Hash",        value: block.hash,                          key: "bh" },
            { label: "Parent Hash",       value: block.parentHash,                    key: "ph" },
            { label: "Timestamp",         value: formatTimestamp(block.timestamp),     key: "" },
            { label: "Miner",             value: block.miner,                         key: "miner" },
            { label: "Gas Used / Limit",  value: `${formatGas(block.gasUsed)} / ${formatGas(block.gasLimit)}`, key: "" },
            { label: "Age",               value: formatAge(block.timestamp),           key: "" },
          ] as field}
            <div class="flex items-start justify-between rounded-lg bg-surface-2 px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <div class="text-xs text-text-dimmer">{field.label}</div>
                <div class="mt-0.5 truncate font-mono text-sm text-text">{field.value}</div>
              </div>
              {#if field.key}
                <button
                  class="ml-2 shrink-0 rounded-md p-1 text-text-dim hover:text-text"
                  onclick={() => copyToClipboard(field.value, field.key)}
                >
                  {#if copied === field.key}
                    <Check size={12} class="text-green" />
                  {:else}
                    <Copy size={12} />
                  {/if}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Transactions -->
      <div class="rounded-xl border border-border bg-surface-1 p-5">
        <h2 class="mb-4 text-sm font-medium text-text-dim">
          Transactions ({block.transactions.length})
        </h2>
        {#if block.transactions.length === 0}
          <p class="text-sm text-text-dimmer">No transactions in this block.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each block.transactions as t}
              <a
                href="/explorer/{t.hash}"
                class="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
              >
                <div class="min-w-0 flex-1">
                  <div class="truncate font-mono text-sm text-accent">{t.hash}</div>
                  <div class="mt-1 flex items-center gap-2 text-xs text-text-dim">
                    <span class="truncate max-w-[120px]">{t.from}</span>
                    <ArrowRight size={10} class="shrink-0" />
                    <span class="truncate max-w-[120px]">{t.to ?? "Contract Create"}</span>
                  </div>
                </div>
                <div class="ml-4 shrink-0 text-right">
                  <div class="text-sm font-medium text-text">{formatEth(t.value)}</div>
                  <div class="text-xs text-green">Success</div>
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    {:else if tx}
      <!-- Transaction Detail -->
      <h1 class="mb-6 text-xl font-semibold">Transaction</h1>

      <div class="rounded-xl border border-border bg-surface-1 p-5">
        <div class="flex flex-col gap-3">
          {#each [
            { label: "Tx Hash",    value: tx.hash,                              mono: true },
            { label: "Block",      value: `#${hexToNum(tx.blockNumber)}`,        mono: false, href: `/explorer/${hexToNum(tx.blockNumber)}` },
            { label: "From",       value: tx.from,                              mono: true },
            { label: "To",         value: tx.to ?? "Contract Create",           mono: true },
            { label: "Value",      value: formatEth(tx.value),                  mono: false },
            { label: "Gas Limit",  value: formatGas(tx.gas),                    mono: false },
            { label: "Gas Price",  value: `${hexToNum(tx.gasPrice)} wei`,        mono: false },
            { label: "Nonce",      value: String(hexToNum(tx.nonce)),            mono: false },
            { label: "Input Data", value: tx.input,                             mono: true },
          ] as field}
            <div class="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
              <div class="w-24 shrink-0 text-xs text-text-dimmer">{field.label}</div>
              {#if field.href}
                <a
                  href={field.href}
                  class="min-w-0 flex-1 truncate text-right text-sm font-mono text-accent hover:underline"
                >
                  {field.value}
                </a>
              {:else}
                <div
                  class="min-w-0 flex-1 truncate text-right text-sm {field.mono ? 'font-mono' : ''} text-text"
                >
                  {field.value}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
