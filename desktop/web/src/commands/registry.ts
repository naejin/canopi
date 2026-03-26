import { navigateTo, theme, persistCurrentSettings, type Panel } from "../state/app";
import { activeTool } from "../state/canvas";
import { t } from "../i18n";
import {
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  newDesignAction,
} from "../state/document";

export interface Command {
  id: string;
  label: () => string;
  shortcut?: string;
  action: () => void;
}

function switchPanel(panel: Panel): () => void {
  return () => { navigateTo(panel); };
}

function switchTool(tool: string): () => void {
  return () => {
    navigateTo("canvas");
    activeTool.value = tool;
  };
}

function cycleTheme() {
  const order = ["system", "light", "dark"] as const;
  const idx = order.indexOf(theme.value);
  theme.value = order[(idx + 1) % order.length]!;
  persistCurrentSettings();
}

export const commands: Command[] = [
  // File operations
  { id: "file.new",    label: () => t("canvas.file.new"),    shortcut: "Ctrl+N",       action: () => { void newDesignAction() } },
  { id: "file.open",   label: () => t("canvas.file.open"),   shortcut: "Ctrl+O",       action: () => { void openDesign() } },
  { id: "file.save",   label: () => t("canvas.file.save"),   shortcut: "Ctrl+S",       action: () => { void saveCurrentDesign() } },
  { id: "file.saveAs", label: () => t("canvas.file.saveAs"), shortcut: "Ctrl+Shift+S", action: () => { void saveAsCurrentDesign() } },

  // Navigation
  { id: "nav.plantDb",  label: () => t("commands.plantDb"),  shortcut: "Ctrl+1", action: switchPanel("plant-db") },
  { id: "nav.canvas",   label: () => t("commands.canvas"),   shortcut: "Ctrl+2", action: switchPanel("canvas") },

  // Theme
  { id: "view.toggleTheme", label: () => t("commands.toggleTheme"), action: cycleTheme },

  // Canvas tools (MVP set)
  { id: "canvas.tool.select",     label: () => t("canvas.tools.select"),     shortcut: "V", action: switchTool("select") },
  { id: "canvas.tool.hand",       label: () => t("canvas.tools.hand"),       shortcut: "H", action: switchTool("hand") },
  { id: "canvas.tool.rectangle",  label: () => t("canvas.tools.rectangle"),  shortcut: "R", action: switchTool("rectangle") },
  { id: "canvas.tool.text",       label: () => t("canvas.tools.text"),       shortcut: "T", action: switchTool("text") },
];
