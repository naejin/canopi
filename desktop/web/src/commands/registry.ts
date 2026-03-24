import { navigateTo, theme, type Panel } from "../state/app";
import { activeTool } from "../state/canvas";
import { t } from "../i18n";
import {
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  newDesignAction,
} from "../state/design";
import { canvasEngine } from "../canvas/engine";
import { exportPNG, exportSVG, exportPlantCSV } from "../canvas/export";
import { importBackgroundImage } from "../canvas/import";
import { exportFile, exportBinary, importFileDialog } from "../ipc/design";

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
}

async function doExportPNG(): Promise<void> {
  if (!canvasEngine) return;
  try {
    const blob = await exportPNG(canvasEngine, { pixelRatio: 2 });
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    await exportBinary(bytes, "design.png", "PNG Image", ["png"]);
  } catch (e) {
    if (e !== "Dialog cancelled") console.error("PNG export failed:", e);
  }
}

async function doExportSVG(): Promise<void> {
  if (!canvasEngine) return;
  try {
    const svg = exportSVG(canvasEngine);
    await exportFile(svg, "design.svg", "SVG Image", ["svg"]);
  } catch (e) {
    if (e !== "Dialog cancelled") console.error("SVG export failed:", e);
  }
}

async function doExportCSV(): Promise<void> {
  if (!canvasEngine) return;
  try {
    const csv = exportPlantCSV(canvasEngine);
    await exportFile(csv, "plant-list.csv", "CSV Spreadsheet", ["csv"]);
  } catch (e) {
    if (e !== "Dialog cancelled") console.error("CSV export failed:", e);
  }
}

async function doImportBackgroundImage(): Promise<void> {
  if (!canvasEngine) return;
  try {
    const [bytes, filename] = await importFileDialog("Image", [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
    ]);
    const uint8 = new Uint8Array(bytes);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
    };
    const mime = mimeMap[ext] ?? "image/png";
    const file = new File([uint8], filename, { type: mime });
    await importBackgroundImage(canvasEngine, file);
  } catch (e) {
    if (e !== "Dialog cancelled") console.error("Background import failed:", e);
  }
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
  { id: "nav.worldMap", label: () => t("commands.worldMap"), shortcut: "Ctrl+3", action: switchPanel("world-map") },
  { id: "nav.learning", label: () => t("commands.learning"), shortcut: "Ctrl+4", action: switchPanel("learning") },

  // Theme
  { id: "view.toggleTheme", label: () => t("commands.toggleTheme"), action: cycleTheme },

  // Canvas tools
  { id: "canvas.tool.select",     label: () => t("canvas.tools.select"),     shortcut: "V", action: switchTool("select") },
  { id: "canvas.tool.hand",       label: () => t("canvas.tools.hand"),       shortcut: "H", action: switchTool("hand") },
  { id: "canvas.tool.rectangle",  label: () => t("canvas.tools.rectangle"),  shortcut: "R", action: switchTool("rectangle") },
  { id: "canvas.tool.ellipse",    label: () => t("canvas.tools.ellipse"),    shortcut: "E", action: switchTool("ellipse") },
  { id: "canvas.tool.polygon",    label: () => t("canvas.tools.polygon"),    shortcut: "P", action: switchTool("polygon") },
  { id: "canvas.tool.freeform",   label: () => t("canvas.tools.freeform"),   shortcut: "F", action: switchTool("freeform") },
  { id: "canvas.tool.line",       label: () => t("canvas.tools.line"),       shortcut: "L", action: switchTool("line") },
  { id: "canvas.tool.text",       label: () => t("canvas.tools.text"),       shortcut: "T", action: switchTool("text") },
  { id: "canvas.tool.measure",    label: () => t("canvas.tools.measure"),    shortcut: "M", action: switchTool("measure") },

  // Export / Import
  { id: "canvas.export.png",   label: () => t("canvas.export.exportPng"),   action: () => { void doExportPNG() } },
  { id: "canvas.export.svg",   label: () => t("canvas.export.exportSvg"),   action: () => { void doExportSVG() } },
  { id: "canvas.export.csv",   label: () => t("canvas.export.exportCsv"),   action: () => { void doExportCSV() } },
  { id: "canvas.import.image", label: () => t("canvas.export.importImage"), action: () => { void doImportBackgroundImage() } },
];
