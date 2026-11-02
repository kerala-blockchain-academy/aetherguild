<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount, onDestroy } from "svelte";
  import { getBlockNumber } from "$lib/rpc";
  import { errorDialog } from "$lib/stores/errorDialog.svelte";
  import {
    Play,
    Square,
    RotateCcw,
    Copy,
    Check,
    Eye,
    EyeOff,
    Send,
    Blocks,
    Link,
    Hash,
    Cpu,
  } from "lucide-svelte";
  import { fade, slide, scale } from "svelte/transition";
  import { quintOut } from "svelte/easing";

  let status = $state<"stopped" | "starting" | "running">("stopped");
  let blockNumber = $state(0);
  let showPrivKey = $state(false);
  let fundAddress = $state("");
  let fundAmount = $state("10");
  let fundStatus = $state<"idle" | "loading" | "success" | "error">("idle");
  let fundError = $state("");
  let copied = $state("");

  const devAddress = "0x71562b71999567F8C7E3BD885b2D4Fe429781573";
  const devPrivKey = "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291";

  const urls = [
    { label: "HTTP RPC", value: "http://localhost:8545", icon: Link },
    { label: "WebSocket", value: "ws://localhost:8546", icon: Link },
    { label: "GraphQL", value: "http://localhost:8545/graphql", icon: Link },
    { label: "Faucet", value: "http://localhost:8545/faucet/ui", icon: Link },
  ];

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    copied = key;
    setTimeout(() => (copied = ""), 1500);
  }

  async function startDruid() {
    status = "starting";
    try {
      await invoke("start_druid");
    } catch (e) {
      console.error("Failed to start druid:", e);
      status = "stopped";
      errorDialog.show("Failed to start Druid", String(e));
    }
  }

  async function stopDruid() {
    try {
      await invoke("stop_druid");
    } catch (e) {
      console.error("Failed to stop druid:", e);
    }
  }

  async function restartDruid() {
    status = "starting";
    try {
      await invoke("restart_druid");
    } catch (e) {
      console.error("Failed to restart druid:", e);
      status = "stopped";
      errorDialog.show("Failed to restart Druid", String(e));
    }
  }

  async function sendFunds() {
    if (!fundAddress.trim()) return;
    fundStatus = "loading";
    fundError = "";
    try {
      await invoke("fund", {
        address: fundAddress.trim(),
        amount: parseInt(fundAmount) || 1,
      });
      fundStatus = "success";
      setTimeout(() => { fundStatus = "idle"; }, 3000);
    } catch (e: any) {
      fundError = String(e);
      fundStatus = "error";
      setTimeout(() => { fundStatus = "idle"; }, 4000);
    }
  }

  let blockInterval: ReturnType<typeof setInterval>;

  async function pollBlockNumber() {
    try {
      blockNumber = await getBlockNumber();
    } catch { /* druid offline */ }
  }

  onMount(async () => {
    try {
      const s = await invoke<string>("get_status");
      status = s === "running" ? "running" : "stopped";
    } catch (e) {
      console.warn("get_status failed (not in Tauri context?):", e);
    }

    try {
      const unlisten = await listen<{ status: string }>("druid-status", (event) => {
        status = event.payload.status === "running" ? "running" : "stopped";
      });
      // Start polling block number
      await pollBlockNumber();
      blockInterval = setInterval(pollBlockNumber, 3000);
      return () => { unlisten(); clearInterval(blockInterval); };
    } catch (e) {
      console.warn("listen failed:", e);
    }
  });

  onDestroy(() => clearInterval(blockInterval));
</script>

<div class="flex-1 overflow-y-auto" in:fade={{duration: 200}}>
  <div class="mx-auto max-w-6xl p-8">
    <!-- Header -->
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-text flex items-center gap-3">
          <Cpu class="text-accent" size={28}/> Command Center
        </h1>
        <p class="mt-1 text-sm text-text-dim">Monitor and control your Druid development blockchain</p>
      </div>
      <div class="flex gap-3">
        {#if status === "stopped"}
          <button
            class="flex items-center gap-2 rounded-lg bg-green/10 px-5 py-2.5 text-sm font-bold tracking-wide text-green border border-green/30 shadow-[0_0_15px_rgba(0,255,102,0.1)] transition-all hover:bg-green/20 hover:shadow-[0_0_20px_rgba(0,255,102,0.3)] hover:-translate-y-0.5"
            onclick={startDruid}
            disabled={status === "starting"}
            in:fade={{duration: 150}}
          >
            <Play size={16} /> {status === "starting" ? "STARTING..." : "START NODE"}
          </button>
        {:else}
          <button
            class="flex items-center gap-2 rounded-lg bg-surface-3 px-5 py-2.5 text-sm font-medium text-text border border-border transition-all hover:bg-border hover:-translate-y-0.5"
            onclick={restartDruid}
            in:fade={{duration: 150}}
          >
            <RotateCcw size={16} /> Restart
          </button>
          <button
            class="flex items-center gap-2 rounded-lg bg-red/10 px-5 py-2.5 text-sm font-bold tracking-wide text-red border border-red/30 shadow-[0_0_15px_rgba(255,0,85,0.1)] transition-all hover:bg-red/20 hover:shadow-[0_0_20px_rgba(255,0,85,0.3)] hover:-translate-y-0.5"
            onclick={stopDruid}
            in:fade={{duration: 150}}
          >
            <Square size={16} /> STOP NODE
          </button>
        {/if}
      </div>
    </div>

    <!-- Grid -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Chain Stats -->
      <div class="glass-panel rounded-2xl p-6 transition-all duration-300 hover:shadow-[0_4px_30px_rgba(0,0,0,0.5)] hover:border-accent/30" in:slide={{duration: 300, delay: 50, easing: quintOut}}>
        <h2 class="mb-5 text-xs font-bold uppercase tracking-widest text-accent">Chain Telemetry</h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="rounded-xl border border-border bg-surface-2 p-4 transition-colors hover:border-accent/30">
            <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-dimmer mb-2">
              <Blocks size={14} class="text-primary" /> Block Height
            </div>
            <div class="font-mono text-2xl font-semibold tracking-tight text-text">{blockNumber}</div>
          </div>
          <div class="rounded-xl border border-border bg-surface-2 p-4 transition-colors hover:border-accent/30">
            <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-dimmer mb-2">
              <Hash size={14} class="text-primary" /> Chain ID
            </div>
            <div class="font-mono text-2xl font-semibold tracking-tight text-text">1337</div>
          </div>
        </div>
      </div>

      <!-- Endpoints -->
      <div class="glass-panel rounded-2xl p-6 transition-all duration-300 hover:shadow-[0_4px_30px_rgba(0,0,0,0.5)] hover:border-accent/30" in:slide={{duration: 300, delay: 150, easing: quintOut}}>
        <h2 class="mb-5 text-xs font-bold uppercase tracking-widest text-accent">Local Endpoints</h2>
        <div class="flex flex-col gap-3">
          {#each urls as url}
            <div class="group flex items-center justify-between rounded-xl border border-transparent bg-surface-2 px-4 py-3.5 transition-all hover:border-accent/20 hover:bg-accent/5">
              <div>
                <div class="text-[0.65rem] font-bold uppercase tracking-wider text-text-dimmer mb-1">{url.label}</div>
                <div class="font-mono text-sm text-text">{url.value}</div>
              </div>
              <button
                class="relative flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all hover:bg-surface-3 hover:text-text"
                onclick={() => copyToClipboard(url.value, url.label)}
              >
                {#if copied === url.label}
                  <div in:scale={{duration:200, start:0.5}} out:fade={{duration:150}} class="absolute bg-green/20 p-1.5 rounded text-green">
                    <Check size={14} strokeWidth={3}/>
                  </div>
                {:else}
                  <div in:fade={{duration: 150}}>
                    <Copy size={14} class="group-hover:text-accent transition-colors" />
                  </div>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      </div>

      <!-- Dev Account -->
      <div class="glass-panel rounded-2xl p-6 transition-all duration-300 hover:shadow-[0_4px_30px_rgba(0,0,0,0.5)] hover:border-primary/30" in:slide={{duration: 300, delay: 250, easing: quintOut}}>
        <h2 class="mb-5 text-xs font-bold uppercase tracking-widest text-primary">Default Account</h2>
        <div class="flex flex-col gap-5">
          <div>
            <div class="text-[0.65rem] font-bold uppercase tracking-wider text-text-dimmer mb-2">Public Address</div>
            <div class="relative flex items-center rounded-xl bg-surface-2 border border-border p-1 group">
              <code class="dev-badge dev-badge-mono flex-1 truncate rounded-lg px-3 py-2 text-sm">{devAddress}</code>
              <button
                class="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-surface-3 hover:text-text"
                onclick={() => copyToClipboard(devAddress, "addr")}
              >
                {#if copied === "addr"}
                  <div in:scale={{duration:200}} class="text-green"><Check size={16} /></div>
                {:else}
                  <div in:fade={{duration: 150}}><Copy size={16} class="group-hover:text-accent"/></div>
                {/if}
              </button>
            </div>
          </div>
          <div>
            <div class="text-[0.65rem] font-bold uppercase tracking-wider text-text-dimmer mb-2">Private Key</div>
            <div class="relative flex items-center rounded-xl bg-surface-2 border border-border p-1 group">
              <code class="flex-1 truncate rounded-lg bg-surface-3/50 px-3 py-2 text-sm font-mono text-text-dim">
                {showPrivKey ? devPrivKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
              </code>
              <button
                class="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-surface-3 hover:text-text"
                onclick={() => (showPrivKey = !showPrivKey)}
              >
                {#if showPrivKey}
                  <EyeOff size={16} class="text-yellow" />
                {:else}
                  <Eye size={16} class="group-hover:text-text"/>
                {/if}
              </button>
              <button
                class="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-surface-3 hover:text-text"
                onclick={() => copyToClipboard(devPrivKey, "pk")}
              >
                {#if copied === "pk"}
                  <div in:scale={{duration:200}} class="text-green"><Check size={16} /></div>
                {:else}
                  <div in:fade={{duration: 150}}><Copy size={16} class="group-hover:text-accent"/></div>
                {/if}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Fund -->
      <div class="glass-panel rounded-2xl p-6 transition-all duration-300 hover:shadow-[0_4px_30px_rgba(0,0,0,0.5)] hover:border-primary/30" in:slide={{duration: 300, delay: 350, easing: quintOut}}>
        <h2 class="mb-2 text-xs font-bold uppercase tracking-widest text-primary">Quick Fund Terminal</h2>
        <p class="mb-5 text-sm text-text-dim">Deploy test ETH directly from the genesis faucet.</p>
        <div class="flex flex-col gap-4">
          <input
            type="text"
            placeholder="0x... Recipient Address"
            bind:value={fundAddress}
            class="glass-input dev-badge-mono w-full rounded-xl px-4 py-3 text-sm placeholder:text-text-dimmer/70"
          />
          <div class="flex gap-3">
            <div class="relative w-32">
              <input
                type="number"
                min="1"
                max="100"
                bind:value={fundAmount}
                class="glass-input w-full rounded-xl py-3 pl-4 pr-10 text-sm font-semibold"
              />
              <span class="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-dimmer">ETH</span>
            </div>
            <button
              onclick={sendFunds}
              disabled={fundStatus === "loading" || !fundAddress.trim()}
              class="group flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-[0_0_15px_rgba(138,43,226,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(138,43,226,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                {fundStatus === 'success' ? 'bg-gradient-to-r from-[#00ff66] to-[#00cc44]' : fundStatus === 'error' ? 'bg-gradient-to-r from-[#ff0055] to-[#cc0044]' : 'bg-gradient-to-r from-[#8a2be2] to-[#6a1b9a]'}"
            >
              {#if fundStatus === "loading"}
                <span class="animate-spin">⟳</span> Sending...
              {:else if fundStatus === "success"}
                <Check size={14} /> Sent!
              {:else if fundStatus === "error"}
                Failed
              {:else}
                Transfer <Send size={14} class="transition-transform group-hover:translate-x-1" />
              {/if}
            </button>
          </div>
          {#if fundStatus === "error" && fundError}
            <p class="text-xs text-red" in:fade={{duration:150}}>{fundError}</p>
          {/if}
        </div>
      </div>

    </div>
  </div>
</div>
