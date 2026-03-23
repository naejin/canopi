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

export function initTheme() {
  // Clean up previous init (HMR safety)
  disposeThemeEffect?.();
  if (mediaHandler) mq.removeEventListener("change", mediaHandler);

  const saved = localStorage.getItem("canopi-theme");
  if (saved === "light" || saved === "dark" || saved === "system") {
    theme.value = saved;
  }

  disposeThemeEffect = effect(() => {
    const resolved =
      theme.value === "system" ? getSystemTheme() : theme.value;
    applyTheme(resolved);
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
