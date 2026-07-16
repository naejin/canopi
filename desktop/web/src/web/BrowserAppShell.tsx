import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { mutateSettingsProjection } from "../app/settings/projection";
import { locale, theme } from "../app/settings/state";
import type { Locale } from "../types/settings";
import { t } from "../i18n";
import { ButtonTooltip } from "../components/shared/ButtonTooltip";
import { Dropdown, type DropdownItem } from "../components/shared/Dropdown";
import {
  type BrowserShellChromeProjection,
  type BrowserShellDesignIdentity,
  type BrowserShellProjectedCommand,
} from "./browser-shell-commands";
import styles from "./BrowserAppShell.module.css";

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];
const LOCALE_ITEMS: DropdownItem<Locale>[] = LOCALES.map((code) => ({
  value: code,
  label: code.toUpperCase(),
}));
const PANEL_ICON_STROKE_WIDTH = 1.5;

type BrowserPanel = NonNullable<BrowserShellProjectedCommand["panel"]>;

const panelIcons: Partial<Record<BrowserPanel, () => preact.JSX.Element>> = {
  "canvas": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  ),
  "templates": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6.5h18" />
      <path d="M5 6.5v12" />
      <path d="M19 6.5v12" />
      <path d="M7 18.5h10" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4" />
    </svg>
  ),
  "plant-db": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  ),
  "favorites": () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={PANEL_ICON_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

interface BrowserAppShellProps {
  readonly commandProjection: BrowserShellChromeProjection;
  readonly designIdentity?: BrowserShellDesignIdentity | null;
  readonly onRenameDesign?: (name: string) => void;
  readonly children?: ComponentChildren;
}

export function BrowserAppShell({
  commandProjection,
  designIdentity = null,
  onRenameDesign,
  children,
}: BrowserAppShellProps) {
  const currentLocale = locale.value;
  const currentTheme = theme.value;
  const visibleTitle = designIdentity ? visibleDesignName(designIdentity.name) : "Canopi";
  const projection = commandProjection;
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(visibleTitle);
  const menuBarRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    if (isEditingName) return;
    setDraftName(visibleTitle);
  }, [isEditingName, visibleTitle]);
  useEffect(() => {
    if (!isEditingName) return;
    const input = nameInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
  }, [isEditingName]);
  useEffect(() => {
    if (designIdentity || !isEditingName) return;
    setIsEditingName(false);
    setDraftName(visibleTitle);
  }, [designIdentity, isEditingName, visibleTitle]);

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
                            command.action();
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
          {designIdentity && isEditingName ? (
            <input
              ref={nameInputRef}
              className={styles.designTitleInput}
              data-web-design-title-input
              aria-label={t("titleBar.designNameInput")}
              value={draftName}
              onInput={(event) => setDraftName((event.currentTarget as HTMLInputElement).value)}
              onBlur={commitDesignNameEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDesignNameEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelDesignNameEdit();
                }
              }}
            />
          ) : designIdentity ? (
            <button
              type="button"
              className={styles.designTitleButton}
              data-web-design-title-button
              aria-label={t("titleBar.renameDesignName")}
              onDblClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginDesignNameEdit();
              }}
            >
              <span className={styles.designTitle} data-web-design-title>
                {visibleTitle}
              </span>
              {designIdentity.dirty ? (
                <span
                  className={styles.dirtyDot}
                  data-web-design-dirty
                  aria-label={t("titleBar.unsavedChanges")}
                />
              ) : null}
            </button>
          ) : (
            <span className={styles.designTitle} data-web-design-title>
              {visibleTitle}
            </span>
          )}
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
            data-web-command-id={projection.theme.id}
            onClick={() => projection.theme.action()}
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
    const Icon = command.panel ? panelIcons[command.panel] : undefined;
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
        onClick={() => command.action()}
      >
        {Icon ? <Icon /> : command.label}
        <ButtonTooltip label={command.label} side="left" />
      </button>
    );
  }

  function changeLanguage(nextLocale: Locale): void {
    mutateSettingsProjection((settings) => {
      settings.locale = nextLocale;
    }, { persist: "immediate" });
  }

  function beginDesignNameEdit(): void {
    if (!designIdentity) return;
    setDraftName(visibleTitle);
    setIsEditingName(true);
  }

  function commitDesignNameEdit(): void {
    if (!designIdentity) {
      setIsEditingName(false);
      return;
    }
    const nextName = draftName.trim();
    if (
      nextName.length > 0 &&
      nextName !== designIdentity.name &&
      !isVisibleFallbackName(designIdentity.name, nextName)
    ) {
      onRenameDesign?.(nextName);
    }
    setDraftName(visibleTitle);
    setIsEditingName(false);
  }

  function cancelDesignNameEdit(): void {
    setDraftName(visibleTitle);
    setIsEditingName(false);
  }
}

function visibleDesignName(name: string): string {
  return name === "Untitled" ? t("titleBar.untitledDesign") : name;
}

function isVisibleFallbackName(currentName: string, draftName: string): boolean {
  return currentName === "Untitled" && draftName === t("titleBar.untitledDesign");
}
