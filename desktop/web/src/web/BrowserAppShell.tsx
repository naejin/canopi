import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { activePanel, navigateTo, sidePanel } from "../app/shell/state";
import { locale, theme } from "../app/settings/state";
import type { Locale } from "../types/settings";
import { t } from "../i18n";
import { ButtonTooltip } from "../components/shared/ButtonTooltip";
import { Dropdown, type DropdownItem } from "../components/shared/Dropdown";
import type { BrowserDraftSummary } from "./browser-app-data";
import {
  createBrowserShellProjection,
  type BrowserShellCommandId,
  type BrowserShellProjectedCommand,
} from "./browser-shell-projection";
import styles from "./BrowserAppShell.module.css";

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];
const LOCALE_ITEMS: DropdownItem<Locale>[] = LOCALES.map((code) => ({
  value: code,
  label: code.toUpperCase(),
}));
const PANEL_ICON_STROKE_WIDTH = 1.5;

const panelIcons: Record<string, () => preact.JSX.Element> = {
  "nav.canvas": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  ),
  "nav.location": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a11 11 0 0 1 0 16" />
      <path d="M12 4a11 11 0 0 0 0 16" />
      <path d="M4 12h16" />
    </svg>
  ),
  "nav.templates": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5h18" />
      <path d="M5 6.5v12" />
      <path d="M19 6.5v12" />
      <path d="M7 18.5h10" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4" />
    </svg>
  ),
  "nav.plantDb": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  ),
  "nav.favorites": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

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

export interface BrowserShellDesignIdentity {
  readonly name: string;
  readonly dirty: boolean;
}

interface BrowserAppShellProps {
  readonly handlers?: BrowserShellCommandHandlers;
  readonly drafts?: readonly BrowserDraftSummary[];
  readonly designIdentity?: BrowserShellDesignIdentity | null;
  readonly downloadCanopiEnabled?: boolean;
  readonly templatesEnabled?: boolean;
  readonly onSettingsChange?: (settings: BrowserShellSettings) => void;
  readonly children?: ComponentChildren;
}

export function BrowserAppShell({
  handlers = {},
  drafts = [],
  designIdentity = null,
  downloadCanopiEnabled = true,
  templatesEnabled = false,
  onSettingsChange,
  children,
}: BrowserAppShellProps) {
  const [draftsOpen, setDraftsOpen] = useState(false);
  const currentLocale = locale.value;
  const currentTheme = theme.value;
  const currentPanel = activePanel.value;
  const currentSidePanel = sidePanel.value;
  const projection = createBrowserShellProjection({
    currentPanel,
    currentSidePanel,
    downloadCanopiEnabled,
    templatesEnabled,
  });
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openMenuId) return;
    const handleOutsidePointerUp = (event: Event) => {
      if (menuBarRef.current?.contains(event.target as Node)) return;
      setOpenMenuId(null);
    };
    document.addEventListener("pointerup", handleOutsidePointerUp);
    return () => {
      document.removeEventListener("pointerup", handleOutsidePointerUp);
    };
  }, [openMenuId]);

  return (
    <div className={styles.shell} data-testid="browser-app-shell">
      <header className={styles.header}>
        <div className={styles.leftChrome}>
          <img
            src={new URL("../assets/canopi-logo.svg", import.meta.url).href}
            className={styles.logo}
            alt="Canopi"
            draggable={false}
          />
          <nav
            ref={menuBarRef}
            className={styles.menuBar}
            role="menubar"
            aria-label={t("webShell.commands")}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setOpenMenuId(null);
            }}
          >
            {projection.menus.map((menu) => {
              const isOpen = openMenuId === menu.id;
              return (
                <div key={menu.id} className={styles.menuGroup}>
                  <button
                    type="button"
                    className={`${styles.menuTrigger} ${isOpen ? styles.menuTriggerOpen : ""}`}
                    data-web-menu-id={menu.id}
                    aria-expanded={isOpen}
                    aria-haspopup="menu"
                    onClick={() => setOpenMenuId((current) => current === menu.id ? null : menu.id)}
                  >
                    {menu.label}
                  </button>
                  {isOpen ? (
                    <div
                      className={styles.menu}
                      role="menu"
                      aria-label={menu.label}
                      data-web-menu-open="true"
                    >
                      {menu.items.map((command) => (
                        <button
                          key={command.id}
                          type="button"
                          className={`${styles.menuItem} ${command.disabled ? styles.menuItemDisabled : ""}`}
                          role="menuitem"
                          data-web-command-id={command.id}
                          aria-disabled={command.disabled || undefined}
                          disabled={command.disabled}
                          onClick={() => {
                            setOpenMenuId(null);
                            runBrowserShellCommand(command.id);
                          }}
                        >
                          {command.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>
        <div className={styles.designIdentity}>
          <span className={styles.designTitle} data-web-design-title>
            {designIdentity ? visibleDesignName(designIdentity.name) : "Canopi"}
          </span>
          {designIdentity?.dirty ? (
            <span
              className={styles.dirtyDot}
              data-web-design-dirty
              aria-label={t("titleBar.unsavedChanges")}
            />
          ) : null}
        </div>
        <div className={styles.settings}>
          <div data-web-locale-control>
            <Dropdown
              trigger={currentLocale.toUpperCase()}
              items={LOCALE_ITEMS}
              value={currentLocale}
              onChange={changeLanguage}
              menuDirection="down"
              ariaLabel={t("status.language")}
              className={styles.localePicker}
              triggerClassName={styles.localeBtn}
              menuClassName={styles.localeMenu}
              optionClassName={styles.localeItem}
              preserveOverlays
            />
          </div>
          <button
            className={styles.themeBtn}
            type="button"
            data-web-theme-control
            data-web-command-id="settings.theme"
            onClick={() => runBrowserShellCommand("settings.theme")}
            aria-label={t("status.theme")}
            title={t(currentTheme === "dark" ? "theme.light" : "theme.dark")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {currentTheme === "dark" ? (
                <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
              ) : (
                <path d="M13 8.5a5.5 5.5 0 0 1-7.5-7.5 6 6 0 1 0 7.5 7.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>
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
      <div className={styles.workspaceShell}>
        <main className={styles.workspace} aria-label={t("webShell.workspace")}>
          {children}
        </main>
        <nav className={styles.panelBar} data-testid="web-panel-bar" aria-label={t("webShell.panels")}>
          {projection.panelBar.primary.map(renderPanelButton)}
          <div className={styles.panelDivider} aria-hidden="true" />
          {projection.panelBar.side.map(renderPanelButton)}
        </nav>
      </div>
    </div>
  );

  function renderPanelButton(command: BrowserShellProjectedCommand) {
    const Icon = panelIcons[command.id];
    return (
      <button
        key={command.id}
        type="button"
        className={styles.panelButton}
        data-web-command-id={command.id}
        data-web-panelbar-command-id={command.id}
        aria-label={command.label}
        aria-pressed={command.active}
        aria-disabled={command.disabled || undefined}
        disabled={command.disabled}
        onClick={() => runBrowserShellCommand(command.id)}
      >
        {Icon ? <Icon /> : command.label}
        <ButtonTooltip label={command.label} side="left" />
      </button>
    );
  }

  function runBrowserShellCommand(id: BrowserShellCommandId): void {
    switch (id) {
      case "file.new":
        void handlers.newDesign?.();
        break;
      case "file.openCanopi":
        void handlers.openCanopi?.();
        break;
      case "file.downloadCanopi":
        void handlers.downloadCanopi?.();
        break;
      case "drafts.open":
        handlers.openDrafts?.();
        setDraftsOpen((open) => !open);
        break;
      case "settings.theme":
        toggleTheme();
        onSettingsChange?.({ locale: locale.value, theme: theme.value });
        break;
      case "nav.canvas":
        navigateTo("canvas");
        break;
      case "nav.location":
        navigateTo("location");
        break;
      case "nav.templates":
        navigateTo("templates");
        break;
      case "nav.plantDb":
        navigateTo("plant-db");
        break;
      case "nav.favorites":
        navigateTo("favorites");
        break;
    }
  }

  function changeLanguage(nextLocale: Locale): void {
    locale.value = nextLocale;
    onSettingsChange?.({ locale: locale.value, theme: theme.value });
  }
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

function visibleDesignName(name: string): string {
  return name === "Untitled" ? t("titleBar.untitledDesign") : name;
}
