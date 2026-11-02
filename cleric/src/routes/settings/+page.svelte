<script lang="ts">
  import {
    Globe,
    HardDrive,
    FolderOpen,
    Palette,
    Info,
    AlertTriangle,
  } from "lucide-svelte";
  import { theme } from "$lib/stores/theme.svelte";

  let expose = $state(false);
  let persist = $state(false);

  const dataDir = "%LOCALAPPDATA%\\AetherGuild\\druid";
</script>

<div class="flex-1 overflow-y-auto">
<div class="p-6">
  <div class="mb-6">
    <h1 class="text-xl font-semibold text-text">Settings</h1>
    <p class="text-sm text-text-dim">Configure Druid and Cleric behavior</p>
  </div>

  <div class="mx-auto flex max-w-2xl flex-col gap-5">
    <!-- Druid Flags -->
    <div class="rounded-xl border border-border bg-surface-1 p-5">
      <h2 class="mb-4 text-sm font-medium text-text-dim">Druid Configuration</h2>

      <div class="flex flex-col gap-4">
        <!-- Expose toggle -->
        <div class="flex items-start justify-between">
          <div class="flex gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-orange/15 text-orange">
              <Globe size={18} />
            </div>
            <div>
              <div class="text-sm font-medium text-text">Expose Network</div>
              <div class="text-xs text-text-dimmer">
                Bind to 0.0.0.0 instead of localhost. Makes the chain accessible from other devices on the network.
              </div>
            </div>
          </div>
          <button
            aria-label="Toggle expose network"
            class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors {expose ? 'bg-accent' : 'bg-surface-3'}"
            onclick={() => (expose = !expose)}
          >
            <div class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all {expose ? 'left-[22px]' : 'left-0.5'}"></div>
          </button>
        </div>

        <!-- Persist toggle -->
        <div class="flex items-start justify-between">
          <div class="flex gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <HardDrive size={18} />
            </div>
            <div>
              <div class="text-sm font-medium text-text">Persistent Storage</div>
              <div class="text-xs text-text-dimmer">
                Save chain state to disk. Data persists across restarts. Disable for ephemeral (in-memory) mode.
              </div>
            </div>
          </div>
          <button
            aria-label="Toggle persistent storage"
            class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors {persist ? 'bg-accent' : 'bg-surface-3'}"
            onclick={() => (persist = !persist)}
          >
            <div class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all {persist ? 'left-[22px]' : 'left-0.5'}"></div>
          </button>
        </div>

        <!-- Warning -->
        <div class="flex items-center gap-2 rounded-lg bg-yellow/10 px-3 py-2 text-xs text-yellow">
          <AlertTriangle size={14} class="shrink-0" />
          Changes to these settings take effect after restarting Druid.
        </div>

        <!-- Data directory -->
        <div class="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <FolderOpen size={16} class="text-text-dimmer" />
          <div>
            <div class="text-xs text-text-dimmer">Data Directory</div>
            <div class="font-mono text-sm text-text">{dataDir}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Theme -->
    <div class="rounded-xl border border-border bg-surface-1 p-5">
      <h2 class="mb-4 text-sm font-medium text-text-dim">Appearance</h2>

      <div class="flex gap-3">
        <Palette size={18} class="mt-0.5 text-text-dimmer" />
        <div>
          <div class="text-sm font-medium text-text">Theme</div>
          <div class="mt-2 flex gap-2">
            {#each [
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "System" },
            ] as option}
              <button
                class="rounded-lg px-4 py-2 text-sm transition-colors
                  {theme.value === option.value
                    ? 'bg-accent text-white font-medium'
                    : 'bg-surface-2 text-text-dim hover:bg-surface-3 hover:text-text'}"
                onclick={() => theme.set(option.value as typeof theme.value)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <!-- About -->
    <div class="rounded-xl border border-border bg-surface-1 p-5">
      <h2 class="mb-4 text-sm font-medium text-text-dim">About</h2>
      <div class="flex items-start gap-3">
        <Info size={18} class="mt-0.5 text-text-dimmer" />
        <div class="flex flex-col gap-1 text-sm">
          <div class="text-text">Cleric <span class="text-text-dimmer">v0.1.0</span></div>
          <div class="text-text-dimmer">Desktop manager for the Druid Ethereum dev chain</div>
          <div class="text-text-dimmer">Part of the AetherGuild development suite</div>
          <div class="mt-2 text-xs text-text-dimmer">Kerala Blockchain Academy &middot; LGPL-3.0</div>
        </div>
      </div>
    </div>
  </div>
</div>
</div>
