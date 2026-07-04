import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { activePanel } from "../app/shell/state";
import { locale, theme } from "../app/settings/state";
import type { Locale, Theme } from "../types/settings";
import styles from "./WebApp.module.css";
import { BrowserAppShell, type BrowserShellCommandHandlers, type BrowserShellSettings } from "./BrowserAppShell";
import { browserAppDataStore, type BrowserAppDataStore } from "./browser-app-data";
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from "./browser-design-session";
import { WebCanvasWorkspace } from "./WebCanvasWorkspace";
import { WebLocationWorkspace } from "./WebLocationWorkspace";

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];

interface WebAppProps {
  readonly controller?: BrowserDesignSessionController;
  readonly appDataStore?: BrowserAppDataStore;
  readonly workspace?: ComponentChildren;
}

export function WebApp({
  controller = browserDesignSessionController,
  appDataStore = browserAppDataStore,
  workspace,
}: WebAppProps) {
  const [draftRevision, setDraftRevision] = useState(0);
  const refreshDrafts = useCallback(() => {
    setDraftRevision((revision) => revision + 1);
  }, []);
  const drafts = useMemo(
    () => controller.listDrafts(),
    [controller, draftRevision],
  );
  const handlers = useMemo<BrowserShellCommandHandlers>(() => ({
    newDesign: () => {
      void controller.newDesign().then(refreshDrafts, logWebAppCommandError);
    },
    openCanopi: () => {
      void controller.openCanopi().then(refreshDrafts, logWebAppCommandError);
    },
    downloadCanopi: () => {
      void controller.downloadCanopi().then(refreshDrafts, logWebAppCommandError);
    },
    openDrafts: refreshDrafts,
    openDraft: (id) => {
      controller.openDraft(id);
      refreshDrafts();
    },
  }), [controller, refreshDrafts]);

  useEffect(() => {
    applyStoredBrowserSettings(appDataStore.loadSettings());
  }, [appDataStore]);

  useEffect(() => (
    controller.installAutosave({ onDraftSaved: refreshDrafts })
  ), [controller, refreshDrafts]);

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        handlers={handlers}
        drafts={drafts}
        onSettingsChange={(settings) => persistBrowserSettings(appDataStore, settings)}
      >
        {workspace ?? <WebWorkspace controller={controller} />}
      </BrowserAppShell>
    </div>
  );
}

function WebWorkspace({ controller }: { readonly controller: BrowserDesignSessionController }) {
  if (activePanel.value === "location") return <WebLocationWorkspace />;
  return <WebCanvasWorkspace controller={controller} />;
}

function applyStoredBrowserSettings(settings: Record<string, unknown> | null): void {
  if (!settings) return;
  if (isLocale(settings.locale)) {
    locale.value = settings.locale;
  }
  if (isTheme(settings.theme)) {
    theme.value = settings.theme;
    document.documentElement.setAttribute("data-theme", theme.value);
  }
}

function persistBrowserSettings(
  appDataStore: BrowserAppDataStore,
  settings: BrowserShellSettings,
): void {
  appDataStore.saveSettings({
    locale: settings.locale,
    theme: settings.theme,
  });
}

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale);
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function logWebAppCommandError(error: unknown): void {
  console.error("Browser Web App command failed:", error);
}
