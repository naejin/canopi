import { signal } from "@preact/signals";
import { activePanel, type Panel } from "../state/app";

export const commandPaletteOpen = signal(false);

const panelKeys: Record<string, Panel> = {
  "1": "plant-db",
  "2": "canvas",
  "3": "world-map",
  "4": "learning",
};

export function initShortcuts() {
  window.addEventListener("keydown", (e) => {
    // Don't capture when typing in inputs
    const tag = (e.target as HTMLElement).tagName;
    const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    // Ctrl+Shift+P — command palette
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
      e.preventDefault();
      commandPaletteOpen.value = !commandPaletteOpen.value;
      return;
    }

    // Ctrl+1-4 — panel switching
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && panelKeys[e.key]) {
      e.preventDefault();
      activePanel.value = panelKeys[e.key]!;
      return;
    }

    // Escape — close command palette
    if (e.key === "Escape" && commandPaletteOpen.value) {
      commandPaletteOpen.value = false;
      return;
    }

    // Number keys without modifier for panel switching (only when not in input)
    if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && panelKeys[e.key]) {
      activePanel.value = panelKeys[e.key]!;
    }
  });
}
