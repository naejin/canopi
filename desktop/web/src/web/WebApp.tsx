import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo } from "preact/hooks";
import { activePanel, sidePanel } from "../app/shell/state";
import styles from "./WebApp.module.css";
import { BrowserAppShell, type BrowserShellCommandHandlers } from "./BrowserAppShell";
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from "./browser-design-session";
import { WebCanvasWorkspace } from "./WebCanvasWorkspace";
import { WebSpeciesCatalogPanel } from "./WebSpeciesCatalogPanel";
import { hasConfiguredStaticDesignTemplates } from "../app/community/catalog.browser";

const WorldMapPanel = lazy(async () => {
  const module = await import("../components/panels/WorldMapPanel");
  return { default: module.WorldMapPanel };
});

interface WebAppProps {
  readonly controller?: BrowserDesignSessionController;
  readonly templatesEnabled?: boolean;
  readonly workspace?: ComponentChildren;
}

export function WebApp({
  controller = browserDesignSessionController,
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

  useEffect(() => controller.installAutosave(), [controller]);

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        handlers={handlers}
        designIdentity={designIdentity}
        downloadCanopiEnabled={hasDesign}
        templatesEnabled={templatesEnabled}
        onRenameDesign={(name) => controller.renameDesign(name)}
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

function logWebAppCommandError(error: unknown): void {
  console.error("Browser Web App command failed:", error);
}
