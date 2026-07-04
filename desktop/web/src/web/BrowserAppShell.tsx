import { activePanel, navigateTo, sidePanel, type Panel, type SidePanel } from "../app/shell/state";
import { locale, theme } from "../app/settings/state";
import type { Locale } from "../types/settings";
import { t } from "../i18n";
import styles from "./BrowserAppShell.module.css";

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];

export interface BrowserShellCommandHandlers {
  readonly newDesign?: () => void;
  readonly openCanopi?: () => void;
  readonly downloadCanopi?: () => void;
  readonly openDrafts?: () => void;
}

interface BrowserAppShellProps {
  readonly handlers?: BrowserShellCommandHandlers;
}

interface ShellCommand {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
  readonly run: () => void;
}

export function BrowserAppShell({ handlers = {} }: BrowserAppShellProps) {
  const currentLocale = locale.value;
  const currentTheme = theme.value;
  const currentPanel = activePanel.value;
  const currentSidePanel = sidePanel.value;

  const commands: readonly ShellCommand[] = [
    { id: "file.new", label: t("canvas.file.new"), run: () => handlers.newDesign?.() },
    { id: "file.openCanopi", label: t("webShell.openCanopi"), run: () => handlers.openCanopi?.() },
    { id: "file.downloadCanopi", label: t("webShell.downloadCanopi"), run: () => handlers.downloadCanopi?.() },
    { id: "drafts.open", label: t("webShell.drafts"), run: () => handlers.openDrafts?.() },
    { id: "settings.language", label: currentLocale.toUpperCase(), run: cycleLanguage },
    {
      id: "settings.theme",
      label: t(currentTheme === "dark" ? "theme.light" : "theme.dark"),
      run: toggleTheme,
    },
    panelCommand("nav.canvas", t("nav.canvas"), "canvas", currentPanel, currentSidePanel),
    panelCommand("nav.location", t("canvas.location.title"), "location", currentPanel, currentSidePanel),
    panelCommand("nav.plantDb", t("nav.plantDb"), "plant-db", currentPanel, currentSidePanel),
    panelCommand("nav.favorites", t("nav.favorites"), "favorites", currentPanel, currentSidePanel),
  ];

  return (
    <div className={styles.shell} data-testid="browser-app-shell">
      <header className={styles.header}>
        <div className={styles.brand}>Canopi</div>
        <nav className={styles.commands} aria-label={t("webShell.commands")}>
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              className={`${styles.command} ${command.active ? styles.commandActive : ""}`}
              data-web-command-id={command.id}
              aria-pressed={command.active === undefined ? undefined : command.active}
              onClick={command.run}
            >
              {command.label}
            </button>
          ))}
        </nav>
      </header>
      <main className={styles.workspace} aria-label={t("webShell.workspace")} />
    </div>
  );
}

function panelCommand(
  id: string,
  label: string,
  panel: Panel,
  currentPanel: Panel,
  currentSidePanel: SidePanel | null,
): ShellCommand {
  return {
    id,
    label,
    active: panel === "plant-db" || panel === "favorites"
      ? currentSidePanel === panel
      : currentPanel === panel,
    run: () => navigateTo(panel),
  };
}

function cycleLanguage(): void {
  const currentIndex = LOCALES.indexOf(locale.value);
  locale.value = LOCALES[(currentIndex + 1) % LOCALES.length] ?? "en";
}

function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme.value);
}
