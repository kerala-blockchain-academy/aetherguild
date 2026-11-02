import { browser } from "$app/environment";

export type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "cleric-theme";

function prefersDark(): boolean {
  return browser && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function loadInitial(): Theme {
  if (!browser) return "dark";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "dark";
}

/**
 * Theme manager. `value` is the user's choice (dark/light/system); `resolved`
 * is what's actually shown. Applying a theme toggles the `light` class on
 * <html>, which the CSS variable overrides in app.css key off of.
 */
class ThemeManager {
  value = $state<Theme>(loadInitial());

  get resolved(): "dark" | "light" {
    return this.value === "system" ? (prefersDark() ? "dark" : "light") : this.value;
  }

  set(theme: Theme) {
    this.value = theme;
    if (browser) localStorage.setItem(STORAGE_KEY, theme);
    this.apply();
  }

  toggle() {
    this.set(this.resolved === "dark" ? "light" : "dark");
  }

  /** Sync the <html> class to the resolved theme. */
  apply() {
    if (!browser) return;
    document.documentElement.classList.toggle("light", this.resolved === "light");
  }
}

export const theme = new ThemeManager();
