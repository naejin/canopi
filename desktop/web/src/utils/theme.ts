import { effect } from "@preact/signals";
import { theme } from "../app/settings/state";
import { primeThemeProjectionFromFirstPaintCache } from "../app/settings/projection";
import { invalidateCssVarCache } from "../canvas/canvas2d-utils";

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

let disposeThemeEffect: (() => void) | null = null;

function readCachedTheme(): "light" | "dark" | null {
  try {
    const cached = localStorage.getItem("canopi-theme");
    return cached === "light" || cached === "dark" ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedTheme(resolved: "light" | "dark"): void {
  try {
    localStorage.setItem("canopi-theme", resolved);
  } catch {
    // Theme cache is optional; the active settings adapter remains authoritative.
  }
}

/**
 * Initialize the theme reactive effect.
 *
 * The active platform settings adapter is the persistence source of truth.
 * localStorage is used ONLY as a synchronous cache for first-paint — it
 * prevents theme flash by providing the last-known theme before the async
 * settings bootstrap resolves. The effect writes to localStorage on every
 * change so the cache stays in sync with the durable platform setting.
 */
export function initTheme(): () => void {
  // Clean up previous init (HMR safety)
  disposeThemeEffect?.();

  // Read the sync cache for instant first-paint (avoids flash)
  const cached = readCachedTheme();
  if (cached) {
    primeThemeProjectionFromFirstPaintCache(cached);
  }

  // Apply theme reactively whenever the signal changes, and sync the cache
  const installedEffect = effect(() => {
    applyTheme(theme.value);
    invalidateCssVarCache();
    // Keep the sync cache up to date (settings bootstrap overwrites the signal,
    // which triggers this effect, which updates the cache for next startup)
    writeCachedTheme(theme.value);
  });
  disposeThemeEffect = installedEffect;

  return () => {
    if (disposeThemeEffect !== installedEffect) return;
    disposeThemeEffect = null;
    installedEffect();
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeThemeEffect?.();
  });
}
