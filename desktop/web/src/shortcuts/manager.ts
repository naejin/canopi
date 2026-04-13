import { signal } from "@preact/signals";
import { activePanel, navigateTo } from "../app/shell/state";
import { currentCanvasHasSelection, getCurrentCanvasSession, setCurrentCanvasTool } from "../canvas/session";
import { isEditableTarget } from "../canvas/runtime/interaction/pointer-utils";
import {
  COMMAND_PALETTE_SHORTCUT_KEY,
  canvasToolKeys,
  panelKeys,
} from "./definitions";
import {
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  newDesignAction,
} from "../app/document-session/actions";

export const commandPaletteOpen = signal(false);

// Module-level reference so HMR can remove the old handler before re-adding.
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function initShortcuts() {
  // Remove any handler registered by a previous HMR execution.
  if (_keydownHandler) {
    window.removeEventListener("keydown", _keydownHandler)
  }

  _keydownHandler = (e: KeyboardEvent) => {
    // Don't capture when typing in inputs
    const isInput = isEditableTarget(e.target);

    // Ctrl+Shift+P — command palette
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === COMMAND_PALETTE_SHORTCUT_KEY) {
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
      setCurrentCanvasTool(canvasToolKeys[e.key]!);
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

    // Canvas operations — only when canvas panel is active and not in input
    const session = getCurrentCanvasSession()
    if (activePanel.value === "canvas" && !isInput && session) {
      // Ctrl+= — zoom in
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "=") {
        e.preventDefault();
        session.zoomIn();
        return;
      }
      // Ctrl+- — zoom out
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "-") {
        e.preventDefault();
        session.zoomOut();
        return;
      }
      // Ctrl+0 — fit to content
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "0") {
        e.preventDefault();
        session.zoomToFit();
        return;
      }
      // Ctrl+Z — undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        session.undo();
        return;
      }
      // Ctrl+Shift+Z — redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z") {
        e.preventDefault();
        session.redo();
        return;
      }
      // Ctrl+C — copy
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "c") {
        e.preventDefault();
        session.copy();
        return;
      }
      // Ctrl+V — paste
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "v") {
        e.preventDefault();
        session.paste();
        return;
      }
      // Ctrl+D — duplicate
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "d") {
        e.preventDefault();
        session.duplicateSelected();
        return;
      }
      // Delete or Backspace — delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        session.deleteSelected();
        return;
      }
      // Ctrl+A — select all
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "a") {
        e.preventDefault();
        session.selectAll();
        return;
      }
      // ] — bring to front
      if (!e.ctrlKey && !e.metaKey && e.key === "]") {
        session.bringToFront();
        return;
      }
      // [ — send to back
      if (!e.ctrlKey && !e.metaKey && e.key === "[") {
        session.sendToBack();
        return;
      }
      // Ctrl+L — lock/unlock toggle
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "l") {
        e.preventDefault();
        if (currentCanvasHasSelection.value) session.lockSelected();
        else session.unlockSelected();
        return;
      }
      // Ctrl+G — group
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "g") {
        e.preventDefault();
        session.groupSelected();
        return;
      }
      // Ctrl+Shift+G — ungroup
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "G") {
        e.preventDefault();
        session.ungroupSelected();
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
