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

export function initTheme() {
  const saved = localStorage.getItem("canopi-theme");
  if (saved === "light" || saved === "dark" || saved === "system") {
    theme.value = saved;
  }

  effect(() => {
    const resolved =
      theme.value === "system" ? getSystemTheme() : theme.value;
    applyTheme(resolved);
    localStorage.setItem("canopi-theme", theme.value);
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (theme.value === "system") {
        applyTheme(getSystemTheme());
      }
    });
}
