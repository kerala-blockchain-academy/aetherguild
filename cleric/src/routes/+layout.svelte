<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import { fade } from "svelte/transition";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import { initLogListener } from "$lib/stores/logs.svelte";
  import { theme } from "$lib/stores/theme.svelte";
  import { errorDialog } from "$lib/stores/errorDialog.svelte";
  import ErrorModal from "$lib/components/ErrorModal.svelte";
  import {
    LayoutDashboard,
    Search,
    FileCode2,
    ScrollText,
    Settings,
    FlaskConical,
    Sun,
    Moon,
  } from "lucide-svelte";

  let { children } = $props();

  const tabs = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/explorer", label: "Explorer", icon: Search },
    { href: "/contracts", label: "Contracts", icon: FileCode2 },
    { href: "/tests", label: "Tests", icon: FlaskConical },
    { href: "/logs", label: "Logs", icon: ScrollText },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  let druidRunning = $state(false);

  onMount(async () => {
    // Sync the <html> class with the stored theme (app.html sets it pre-paint).
    theme.apply();

    // Start collecting logs globally
    initLogListener();

    // Get initial status
    try {
      const s = await invoke<string>("get_status");
      druidRunning = s === "running";
    } catch { /* not in Tauri context (dev browser) */ }

    // Listen for status changes + unexpected exits (shown as an error dialog).
    try {
      const unlistenStatus = await listen<{ status: string }>("druid-status", (event) => {
        druidRunning = event.payload.status === "running";
      });
      const unlistenError = await listen<{ message: string; detail: string }>(
        "druid-error",
        (event) => {
          const { message: msg, detail } = event.payload;
          errorDialog.show("Druid Error", msg, detail);
        },
      );
      return () => {
        unlistenStatus();
        unlistenError();
      };
    } catch { /* not in Tauri context */ }
  });
</script>

<div class="flex h-screen w-screen overflow-hidden">
  <!-- Sidebar -->
  <nav class="glass-panel z-10 flex w-56 shrink-0 flex-col border-r-0 border-r border-border">
    <!-- Logo / Title -->
    <div class="flex items-center gap-3 border-b border-border px-5 py-5">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#8a2be2] to-[#00f0ff] font-bold text-white shadow-[0_0_15px_rgba(138,43,226,0.3)]">
        <span class="drop-shadow-md">C</span>
      </div>
      <div>
        <div class="text-base font-bold tracking-wide text-text">Cleric</div>
        <div class="text-[0.65rem] font-medium uppercase tracking-widest text-accent">Druid Manager</div>
      </div>
    </div>

    <!-- Nav tabs -->
    <div class="flex flex-1 flex-col gap-1.5 px-3 py-4">
      {#each tabs as tab}
        {@const active = $page.url.pathname.startsWith(tab.href)}
        <a
          href={tab.href}
          class="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200
            {active
            ? 'bg-accent/10 font-semibold text-text shadow-[inset_0_0_10px_rgba(0,240,255,0.05)]'
            : 'text-text-dim hover:bg-surface-2 hover:text-text'}"
        >
          {#if active}
            <div class="absolute left-0 top-1/2 h-1/2 w-1 -translate-y-1/2 rounded-r bg-accent shadow-[0_0_10px_#00f0ff]" transition:fade={{duration: 150}}></div>
          {/if}
          <div class="transition-transform group-hover:scale-110">
            <tab.icon size={18} color={active ? "var(--color-accent)" : "currentColor"} />
          </div>
          {tab.label}
        </a>
      {/each}
    </div>

    <!-- Theme toggle -->
    <div class="border-t border-border px-3 py-3">
      <button
        onclick={() => theme.toggle()}
        class="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-dim transition-all hover:bg-surface-2 hover:text-text"
        aria-label="Toggle dark and light mode"
      >
        <div class="transition-transform group-hover:scale-110">
          {#if theme.resolved === "dark"}
            <Moon size={18} />
          {:else}
            <Sun size={18} />
          {/if}
        </div>
        {theme.resolved === "dark" ? "Dark Mode" : "Light Mode"}
      </button>
    </div>

    <!-- Status footer -->
    <div class="border-t border-border px-5 py-4">
      <div class="flex items-center gap-3">
        <div class="relative flex h-3 w-3">
          {#if druidRunning}
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-40"></span>
          {/if}
          <span class="relative inline-flex h-3 w-3 rounded-full {druidRunning ? 'bg-green' : 'bg-red'} shadow-[0_0_8px_currentColor]"></span>
        </div>
        <div class="flex flex-col">
          <span class="text-xs font-semibold text-text">
            {druidRunning ? "DRUID ONLINE" : "DRUID OFFLINE"}
          </span>
          <span class="mt-0.5 font-mono text-[0.65rem] text-text-dimmer">ID: 1337 • DEV</span>
        </div>
      </div>
    </div>
  </nav>

  <!-- Main content -->
  <main class="relative flex flex-1 flex-col overflow-hidden">
    {@render children()}
  </main>
</div>

<!-- Global error popup -->
<ErrorModal />
