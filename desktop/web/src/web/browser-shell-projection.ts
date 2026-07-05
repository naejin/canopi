import type { Panel, SidePanel } from "../app/shell/state";
import { t } from "../i18n";
import type { Locale, Theme } from "../types/settings";

export type BrowserShellMenuId = "file" | "settings";

export type BrowserShellCommandId =
  | "file.new"
  | "file.openCanopi"
  | "file.downloadCanopi"
  | "drafts.open"
  | "settings.language"
  | "settings.theme"
  | "nav.canvas"
  | "nav.location"
  | "nav.templates"
  | "nav.plantDb"
  | "nav.favorites";

export interface BrowserShellProjectionInput {
  readonly currentLocale: Locale;
  readonly currentTheme: Theme;
  readonly currentPanel: Panel;
  readonly currentSidePanel: SidePanel | null;
  readonly downloadCanopiEnabled: boolean;
  readonly templatesEnabled: boolean;
}

export interface BrowserShellProjectedCommand {
  readonly id: BrowserShellCommandId;
  readonly label: string;
  readonly disabled: boolean;
  readonly active?: boolean;
}

export interface BrowserShellMenuProjection {
  readonly id: BrowserShellMenuId;
  readonly label: string;
  readonly items: readonly BrowserShellProjectedCommand[];
}

export interface BrowserShellPanelBarProjection {
  readonly primary: readonly BrowserShellProjectedCommand[];
  readonly side: readonly BrowserShellProjectedCommand[];
}

export interface BrowserShellChromeProjection {
  readonly menus: readonly BrowserShellMenuProjection[];
  readonly panelBar: BrowserShellPanelBarProjection;
}

export function createBrowserShellProjection({
  currentLocale,
  currentTheme,
  currentPanel,
  currentSidePanel,
  downloadCanopiEnabled,
  templatesEnabled,
}: BrowserShellProjectionInput): BrowserShellChromeProjection {
  return {
    menus: [
      {
        id: "file",
        label: t("menu.file"),
        items: [
          command("file.new", t("canvas.file.new")),
          command("file.openCanopi", t("webShell.openCanopi")),
          command("file.downloadCanopi", t("webShell.downloadCanopi"), {
            disabled: !downloadCanopiEnabled,
          }),
          command("drafts.open", t("webShell.drafts")),
        ],
      },
      {
        id: "settings",
        label: t("webShell.settings"),
        items: [
          command("settings.language", currentLocale.toUpperCase()),
          command("settings.theme", t(currentTheme === "dark" ? "theme.light" : "theme.dark")),
        ],
      },
    ],
    panelBar: {
      primary: [
        panelCommand("nav.canvas", t("nav.canvas"), "canvas", currentPanel, currentSidePanel),
        panelCommand("nav.location", t("canvas.location.title"), "location", currentPanel, currentSidePanel),
        ...(templatesEnabled
          ? [panelCommand("nav.templates", t("worldMap.title"), "templates", currentPanel, currentSidePanel)]
          : []),
      ],
      side: [
        panelCommand("nav.plantDb", t("nav.plantDb"), "plant-db", currentPanel, currentSidePanel),
        panelCommand("nav.favorites", t("nav.favorites"), "favorites", currentPanel, currentSidePanel),
      ],
    },
  };
}

function command(
  id: BrowserShellCommandId,
  label: string,
  options: { readonly disabled?: boolean } = {},
): BrowserShellProjectedCommand {
  return {
    id,
    label,
    disabled: options.disabled ?? false,
  };
}

function panelCommand(
  id: BrowserShellCommandId,
  label: string,
  panel: Panel,
  currentPanel: Panel,
  currentSidePanel: SidePanel | null,
): BrowserShellProjectedCommand {
  return {
    id,
    label,
    disabled: false,
    active: panel === "plant-db" || panel === "favorites"
      ? currentSidePanel === panel
      : currentPanel === panel,
  };
}
