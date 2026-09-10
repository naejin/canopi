import { PanelIcon } from '../components/shared/PanelIcon'
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
          {projection.panelBar.design.map(renderPanelButton)}
          <div className={styles.panelDivider} aria-hidden="true" />
          {projection.panelBar.side.map(renderPanelButton)}
        </nav>
      </div>
    </div>
  );

  function renderPanelButton(command: BrowserShellProjectedCommand) {
    return (
      <button
        key={command.id}
        type="button"
        className={styles.panelButton}
        data-web-command-id={command.id}
        data-web-panelbar-command-id={command.id}
        data-panel={command.panel}
        aria-label={command.label}
        aria-pressed={command.active}
        aria-disabled={command.disabled || undefined}
        disabled={command.disabled}
        onClick={() => command.action()}
      >
        {command.panel ? <PanelIcon panel={command.panel} /> : command.label}
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
