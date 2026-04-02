import { navigateTo, theme, persistCurrentSettings, type Panel } from "../state/app";
import { setCurrentCanvasTool } from "../canvas/session";
import { t } from "../i18n";
import { FILE_SHORTCUTS, PANEL_SHORTCUTS, TOOL_SHORTCUTS } from "../shortcuts/definitions";
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
    setCurrentCanvasTool(tool);
  };
}

function cycleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  persistCurrentSettings();
}

export const commands: Command[] = [
  // File operations
  { id: "file.new",    label: () => t("canvas.file.new"),    shortcut: FILE_SHORTCUTS.newDesign,   action: () => { void newDesignAction() } },
  { id: "file.open",   label: () => t("canvas.file.open"),   shortcut: FILE_SHORTCUTS.openDesign,  action: () => { void openDesign() } },
  { id: "file.save",   label: () => t("canvas.file.save"),   shortcut: FILE_SHORTCUTS.saveDesign,  action: () => { void saveCurrentDesign() } },
  { id: "file.saveAs", label: () => t("canvas.file.saveAs"), shortcut: FILE_SHORTCUTS.saveDesignAs, action: () => { void saveAsCurrentDesign() } },

  // Navigation
  { id: "nav.canvas",   label: () => t("commands.canvas"),   shortcut: PANEL_SHORTCUTS.canvas, action: switchPanel("canvas") },
  { id: "nav.location", label: () => t("canvas.location.title"), action: switchPanel("location") },
  { id: "nav.plantDb",  label: () => t("commands.plantDb"),  shortcut: PANEL_SHORTCUTS.plantDb, action: switchPanel("plant-db") },

  // Theme
  { id: "view.toggleTheme", label: () => t("commands.toggleTheme"), action: cycleTheme },

  // Canvas tools (MVP set)
  { id: "canvas.tool.select",     label: () => t("canvas.tools.select"),     shortcut: TOOL_SHORTCUTS.select, action: switchTool("select") },
  { id: "canvas.tool.hand",       label: () => t("canvas.tools.hand"),       shortcut: TOOL_SHORTCUTS.hand, action: switchTool("hand") },
  { id: "canvas.tool.rectangle",  label: () => t("canvas.tools.rectangle"),  shortcut: TOOL_SHORTCUTS.rectangle, action: switchTool("rectangle") },
  { id: "canvas.tool.text",       label: () => t("canvas.tools.text"),       shortcut: TOOL_SHORTCUTS.text, action: switchTool("text") },
];
