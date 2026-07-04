import { useState } from "preact/hooks";
import { activePanel, navigateTo, sidePanel, type Panel, type SidePanel } from "../app/shell/state";
import { locale, theme } from "../app/settings/state";
import type { Locale } from "../types/settings";
import { t } from "../i18n";
import type { BrowserDraftSummary } from "./browser-app-data";
import styles from "./BrowserAppShell.module.css";

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];

export interface BrowserShellCommandHandlers {
  readonly newDesign?: () => void | Promise<void>;
  readonly openCanopi?: () => void | Promise<boolean>;
  readonly downloadCanopi?: () => void | Promise<void>;
  readonly openDrafts?: () => void;
  readonly openDraft?: (id: string) => void | boolean | Promise<void | boolean>;
}

export interface BrowserShellSettings {
  readonly locale: Locale;
  readonly theme: "light" | "dark";
}

interface BrowserAppShellProps {
  readonly handlers?: BrowserShellCommandHandlers;
  readonly drafts?: readonly BrowserDraftSummary[];
  readonly onSettingsChange?: (settings: BrowserShellSettings) => void;
}

interface ShellCommand {
  readonly id: string;
  readonly label: string;
  readonly active?: boolean;
  readonly run: () => void | Promise<void | boolean>;
}

export function BrowserAppShell({
  handlers = {},
  drafts = [],
  onSettingsChange,
}: BrowserAppShellProps) {
  const [draftsOpen, setDraftsOpen] = useState(false);
  const currentLocale = locale.value;
  const currentTheme = theme.value;
  const currentPanel = activePanel.value;
  const currentSidePanel = sidePanel.value;

  const commands: readonly ShellCommand[] = [
    { id: "file.new", label: t("canvas.file.new"), run: () => handlers.newDesign?.() },
    { id: "file.openCanopi", label: t("webShell.openCanopi"), run: () => handlers.openCanopi?.() },
    { id: "file.downloadCanopi", label: t("webShell.downloadCanopi"), run: () => handlers.downloadCanopi?.() },
    {
      id: "drafts.open",
      label: t("webShell.drafts"),
      run: () => {
        handlers.openDrafts?.();
        setDraftsOpen((open) => !open);
      },
    },
    {
      id: "settings.language",
      label: currentLocale.toUpperCase(),
      run: () => {
        cycleLanguage();
        onSettingsChange?.({ locale: locale.value, theme: theme.value });
      },
    },
    {
      id: "settings.theme",
      label: t(currentTheme === "dark" ? "theme.light" : "theme.dark"),
      run: () => {
        toggleTheme();
        onSettingsChange?.({ locale: locale.value, theme: theme.value });
      },
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
              onClick={() => void command.run()}
            >
              {command.label}
            </button>
          ))}
        </nav>
      </header>
      {draftsOpen ? (
        <section
          className={styles.draftsPanel}
          data-testid="browser-drafts-list"
          aria-label={t("webShell.browserDrafts")}
        >
          <div className={styles.draftsHeader}>
            <div>
              <h2 className={styles.draftsTitle}>{t("webShell.browserDrafts")}</h2>
              <p className={styles.draftsHint}>{t("webShell.browserDraftsHint")}</p>
            </div>
          </div>
          {drafts.length === 0 ? (
            <p className={styles.emptyDrafts}>{t("webShell.noDrafts")}</p>
          ) : (
            <div className={styles.draftRows} role="list">
              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={styles.draftRow}
                  data-browser-draft-id={draft.id}
                  onClick={() => {
                    setDraftsOpen(false);
                    void handlers.openDraft?.(draft.id);
                  }}
                >
                  <span className={styles.draftName}>{draft.name}</span>
                  <span className={styles.draftUpdated}>{formatDraftDate(draft.updatedAt, currentLocale)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}
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

function formatDraftDate(value: string, currentLocale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(currentLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
