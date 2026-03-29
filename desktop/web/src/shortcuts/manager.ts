import { signal } from "@preact/signals";
import { activePanel, navigateTo, type Panel } from "../state/app";
import { activeTool, selectedObjectIds } from "../state/canvas";
import { canvasEngine } from "../canvas/engine";
import {
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  newDesignAction,
} from "../state/document";

export const commandPaletteOpen = signal(false);

const panelKeys: Record<string, Panel> = {
  "1": "canvas",
  "2": "plant-db",
};

// Single-key tool shortcuts — only fire when canvas panel is active (MVP set)
const canvasToolKeys: Record<string, string> = {
  v: "select",
  V: "select",
  h: "hand",
  H: "hand",
  r: "rectangle",
  R: "rectangle",
  t: "text",
  T: "text",
};

// Module-level reference so HMR can remove the old handler before re-adding.
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function initShortcuts() {
  // Remove any handler registered by a previous HMR execution.
  if (_keydownHandler) {
    window.removeEventListener("keydown", _keydownHandler)
  }

  _keydownHandler = (e: KeyboardEvent) => {
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
      navigateTo(panelKeys[e.key]!);
      return;
    }

    // Escape — close command palette
    if (e.key === "Escape" && commandPaletteOpen.value) {
      commandPaletteOpen.value = false;
      return;
    }

    // Number keys without modifier for panel switching (only when not in input)
    if (!isInput && !e.ctrlKey && !e.metaKey && !e.altKey && panelKeys[e.key]) {
      navigateTo(panelKeys[e.key]!);
      return;
    }

    // Canvas tool shortcuts — single letter, no modifier, canvas panel active, not in input
    if (
      !isInput &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      activePanel.value === "canvas" &&
      canvasToolKeys[e.key]
    ) {
      e.preventDefault();
      activeTool.value = canvasToolKeys[e.key]!;
      return;
    }

    // File operations — canvas panel, with or without focus on canvas
    if (activePanel.value === "canvas") {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        void saveCurrentDesign().catch(() => {});
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        void saveAsCurrentDesign();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "o") {
        e.preventDefault();
        void openDesign();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        void newDesignAction();
        return;
      }
    }

    // Canvas object operations — only when canvas panel is active and not in input
    if (activePanel.value === "canvas" && !isInput && canvasEngine) {
      // Ctrl+Z — undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        canvasEngine.undo();
        return;
      }
      // Ctrl+Shift+Z — redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        canvasEngine.redo();
        return;
      }
      // Ctrl+C — copy
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "c") {
        e.preventDefault();
        canvasEngine.copyToClipboard();
        return;
      }
      // Ctrl+V — paste
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "v") {
        e.preventDefault();
        canvasEngine.pasteFromClipboard();
        return;
      }
      // Ctrl+D — duplicate
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "d") {
        e.preventDefault();
        canvasEngine.duplicateSelected();
        return;
      }
      // Delete or Backspace — delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        canvasEngine.deleteSelected();
        return;
      }
      // Ctrl+A — select all
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "a") {
        e.preventDefault();
        canvasEngine.selectAll();
        return;
      }
      // ] — bring to front
      if (!e.ctrlKey && !e.metaKey && e.key === "]") {
        canvasEngine.bringToFront();
        return;
      }
      // [ — send to back
      if (!e.ctrlKey && !e.metaKey && e.key === "[") {
        canvasEngine.sendToBack();
        return;
      }
      // Ctrl+L — lock/unlock toggle
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "l") {
        e.preventDefault();
        if (selectedObjectIds.value.size > 0) canvasEngine.lockSelected();
        else canvasEngine.unlockSelected();
        return;
      }
      // Ctrl+G — group
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "g") {
        e.preventDefault();
        canvasEngine.groupSelectedNodes();
        return;
      }
      // Ctrl+Shift+G — ungroup
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "G") {
        e.preventDefault();
        canvasEngine.ungroupSelectedNodes();
        return;
      }
    }
  }

  window.addEventListener("keydown", _keydownHandler)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_keydownHandler) {
      window.removeEventListener("keydown", _keydownHandler)
      _keydownHandler = null
    }
  })
}
