import { effect } from "@preact/signals";
import { theme } from "../state/app";

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

let disposeThemeEffect: (() => void) | null = null;

/**
 * Initialize the theme reactive effect.
 *
 * Rust settings are the canonical persistence source of truth for theme.
 * localStorage is used ONLY as a synchronous cache for first-paint — it
 * prevents theme flash by providing the last-known theme before the async
 * Rust bootstrap resolves. The effect writes to localStorage on every
 * change so the cache stays in sync with whatever Rust provides.
 */
export function initTheme() {
  // Clean up previous init (HMR safety)
  disposeThemeEffect?.();

  // Read the sync cache for instant first-paint (avoids flash)
  const cached = localStorage.getItem("canopi-theme");
  if (cached === "light" || cached === "dark") {
    theme.value = cached;
  }

  // Apply theme reactively whenever the signal changes, and sync the cache
  disposeThemeEffect = effect(() => {
    applyTheme(theme.value);
    // Keep the sync cache up to date (Rust bootstrap overwrites the signal,
    // which triggers this effect, which updates the cache for next startup)
    localStorage.setItem("canopi-theme", theme.value);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeThemeEffect?.();
  });
}
