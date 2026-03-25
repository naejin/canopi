import { effect } from "@preact/signals";
import { theme } from "../state/app";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

let disposeThemeEffect: (() => void) | null = null;
let mediaHandler: (() => void) | null = null;
const mq = window.matchMedia("(prefers-color-scheme: dark)");

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
  if (mediaHandler) mq.removeEventListener("change", mediaHandler);

  // Read the sync cache for instant first-paint (avoids system→saved flash)
  const cached = localStorage.getItem("canopi-theme");
  if (cached === "light" || cached === "dark" || cached === "system") {
    theme.value = cached;
  }

  // Apply theme reactively whenever the signal changes, and sync the cache
  disposeThemeEffect = effect(() => {
    const resolved =
      theme.value === "system" ? getSystemTheme() : theme.value;
    applyTheme(resolved);
    // Keep the sync cache up to date (Rust bootstrap overwrites the signal,
    // which triggers this effect, which updates the cache for next startup)
    localStorage.setItem("canopi-theme", theme.value);
  });

  mediaHandler = () => {
    if (theme.value === "system") {
      applyTheme(getSystemTheme());
    }
  };
  mq.addEventListener("change", mediaHandler);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeThemeEffect?.();
    if (mediaHandler) mq.removeEventListener("change", mediaHandler);
  });
}
