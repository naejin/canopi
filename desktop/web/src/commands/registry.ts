import { activePanel, theme, type Panel } from "../state/app";
import { t } from "../i18n";

export interface Command {
  id: string;
  label: () => string;
  shortcut?: string;
  action: () => void;
}

function switchPanel(panel: Panel): () => void {
  return () => { activePanel.value = panel; };
}

function cycleTheme() {
  const order = ["system", "light", "dark"] as const;
  const idx = order.indexOf(theme.value);
  theme.value = order[(idx + 1) % order.length]!;
}

export const commands: Command[] = [
  { id: "nav.plantDb", label: () => t("commands.plantDb"), shortcut: "Ctrl+1", action: switchPanel("plant-db") },
  { id: "nav.canvas", label: () => t("commands.canvas"), shortcut: "Ctrl+2", action: switchPanel("canvas") },
  { id: "nav.worldMap", label: () => t("commands.worldMap"), shortcut: "Ctrl+3", action: switchPanel("world-map") },
  { id: "nav.learning", label: () => t("commands.learning"), shortcut: "Ctrl+4", action: switchPanel("learning") },
  { id: "view.toggleTheme", label: () => t("commands.toggleTheme"), action: cycleTheme },
];
