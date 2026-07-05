import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo } from "preact/hooks";
import { activePanel, sidePanel } from "../app/shell/state";
import { locale } from "../app/settings/state";
import type { Locale, Theme } from "../types/settings";
import styles from "./WebApp.module.css";
import { BrowserAppShell, type BrowserShellCommandHandlers, type BrowserShellSettings } from "./BrowserAppShell";
import { applyBrowserTheme } from "./browser-theme";
import { browserAppDataStore, type BrowserAppDataStore } from "./browser-app-data";
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from "./browser-design-session";
import { WebCanvasWorkspace } from "./WebCanvasWorkspace";
import { WebLocationWorkspace } from "./WebLocationWorkspace";
import { WebSpeciesCatalogPanel } from "./WebSpeciesCatalogPanel";
import { hasConfiguredStaticDesignTemplates } from "../app/community/catalog.browser";

const WorldMapPanel = lazy(async () => {
  const module = await import("../components/panels/WorldMapPanel");
  return { default: module.WorldMapPanel };
});

const LOCALES: readonly Locale[] = ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"];

interface WebAppProps {
  readonly controller?: BrowserDesignSessionController;
  readonly appDataStore?: BrowserAppDataStore;
  readonly templatesEnabled?: boolean;
  readonly workspace?: ComponentChildren;
}

export function WebApp({
  controller = browserDesignSessionController,
  appDataStore = browserAppDataStore,
  templatesEnabled = hasConfiguredStaticDesignTemplates(),
  workspace,
}: WebAppProps) {
  const hasDesign = controller.hasCurrentDesign();
  const designIdentity = controller.readDesignIdentity();
  const handlers = useMemo<BrowserShellCommandHandlers>(() => ({
    newDesign: () => {
      void controller.newDesign().catch(logWebAppCommandError);
    },
    openCanopi: () => {
      void controller.openCanopi().catch(logWebAppCommandError);
    },
    downloadCanopi: () => {
      void controller.downloadCanopi().catch(logWebAppCommandError);
    },
  }), [controller]);

  useEffect(() => {
    applyStoredBrowserSettings(appDataStore.loadSettings());
  }, [appDataStore]);

  useEffect(() => controller.installAutosave(), [controller]);

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        handlers={handlers}
        designIdentity={designIdentity}
        downloadCanopiEnabled={hasDesign}
        templatesEnabled={templatesEnabled}
        onRenameDesign={(name) => controller.renameDesign(name)}
        onSettingsChange={(settings) => persistBrowserSettings(appDataStore, settings)}
      >
        {workspace ?? <WebWorkspace controller={controller} templatesEnabled={templatesEnabled} />}
      </BrowserAppShell>
    </div>
  );
}

function WebWorkspace({
  controller,
  templatesEnabled,
}: {
  readonly controller: BrowserDesignSessionController;
  readonly templatesEnabled: boolean;
}) {
  if (activePanel.value === "location") return <WebLocationWorkspace />;
  if (templatesEnabled && activePanel.value === "templates") {
    return (
      <Suspense fallback={<div className={styles.workspaceMain} aria-hidden="true" />}>
        <WorldMapPanel />
      </Suspense>
    );
  }
  const currentSidePanel = sidePanel.value;
  const hasSidePanel = currentSidePanel !== null;
  return (
    <div
      className={`${styles.workspaceWithSidebar} ${hasSidePanel ? styles.workspaceWithSidebarOpen : ""}`}
      data-web-workspace-with-sidebar
      data-web-sidebar-open={hasSidePanel ? "true" : undefined}
    >
      <div className={styles.workspaceMain}>
        <WebCanvasWorkspace controller={controller} />
      </div>
      {currentSidePanel === "plant-db" && (
        <aside className={styles.speciesSidebar} data-web-side-panel="plant-db">
          <WebSpeciesCatalogPanel mode="catalog" />
        </aside>
      )}
      {currentSidePanel === "favorites" && (
        <aside className={styles.speciesSidebar} data-web-side-panel="favorites">
          <WebSpeciesCatalogPanel mode="favorites" />
        </aside>
      )}
    </div>
  );
}

function applyStoredBrowserSettings(settings: Record<string, unknown> | null): void {
  if (!settings) return;
  if (isLocale(settings.locale)) {
    locale.value = settings.locale;
  }
  if (isTheme(settings.theme)) {
    applyBrowserTheme(settings.theme);
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
