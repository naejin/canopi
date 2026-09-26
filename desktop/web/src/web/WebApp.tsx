import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import { activePanel, sidePanel } from "../app/shell/state";
import { keyboardShortcutsDialogOpen } from "../app/shell/dialogs";
import { workspaceCanvasCommandProjection } from "../app/workspace-commands/canvas-actions";
import styles from "./WebApp.module.css";
import { BrowserAppShell } from "./BrowserAppShell";
import {
  createBrowserShellCapabilities,
  createBrowserShellCatalog,
  createBrowserShellCommandProjection,
  type BrowserShellCatalog,
} from "./browser-shell-commands";
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from "./browser-design-session";
import { hasConfiguredStaticDesignTemplates } from "../app/community/catalog.browser";
import { WorkspaceDialogs } from "../components/workspace/WorkspaceComposition";
import { SaveProblemDialog } from "../components/shared/SaveProblemDialog";
import { SettingsDialog } from "../components/shared/SettingsDialog";
import { KeyboardShortcutsDialog } from "../components/shared/KeyboardShortcutsDialog";
import { AboutCanopiDialog } from "../components/shared/AboutCanopiDialog";
import { PlaceSearchField } from "../components/canvas/PlaceSearch";
import { WebWorkspace } from "./WebWorkspace";
import { createBrowserGeoJsonWorkflow } from "./browser-geojson";
import type { WebShellShortcutSource } from "./canvas-shortcuts";
import { currentCanvasSession } from "../canvas/session";
import type { GeoJsonWorkflow } from "../app/geojson/workflow";

interface WebAppProps {
  readonly controller?: BrowserDesignSessionController;
  readonly templatesEnabled?: boolean;
  readonly workspace?: ComponentChildren;
  readonly geoJson?: GeoJsonWorkflow;
  /** The catalog the entry's keyboard shortcuts use; built here when absent. */
  readonly catalog?: BrowserShellCatalog;
}

/** Build the Web Edition command catalog for a controller and its GeoJSON workflow. */
export function createWebAppCatalog(
  controller: BrowserDesignSessionController = browserDesignSessionController,
  geoJson: GeoJsonWorkflow = createBrowserGeoJsonWorkflow(),
  templatesEnabled: boolean = hasConfiguredStaticDesignTemplates(),
): BrowserShellCatalog {
  return createBrowserShellCatalog(
    createBrowserShellCapabilities(controller, logWebAppCommandError, geoJson),
    {
      templatesEnabled,
      canvasReady: () => controller.hasCurrentDesign() && currentCanvasSession.peek() !== null,
    },
  );
}

/** What the Web keyboard shortcuts need to run shell commands against the live state. */
export function createWebShellShortcutSource(
  catalog: BrowserShellCatalog,
  controller: BrowserDesignSessionController = browserDesignSessionController,
): WebShellShortcutSource {
  return {
    catalog,
    readState: () => ({
      hasDesign: controller.hasCurrentDesign(),
      revertAvailable: controller.continuousSave.revertAvailable.peek(),
      activePanel: activePanel.peek(),
      sidePanel: sidePanel.peek(),
    }),
  }
}

export function WebApp({
  controller = browserDesignSessionController,
  templatesEnabled = hasConfiguredStaticDesignTemplates(),
  workspace,
  geoJson,
  catalog,
}: WebAppProps) {
  const hasDesign = controller.hasCurrentDesign();
  const designIdentity = controller.readDesignIdentity();
  const shellCatalog = useMemo(
    () => catalog ?? createWebAppCatalog(controller, geoJson ?? createBrowserGeoJsonWorkflow(), templatesEnabled),
    [catalog, controller, geoJson, templatesEnabled],
  );
  const commandProjection = createBrowserShellCommandProjection({
    catalog: shellCatalog,
    state: {
      hasDesign,
      revertAvailable: controller.continuousSave.revertAvailable.value,
      activePanel: activePanel.value,
      sidePanel: sidePanel.value,
    },
    canvas: workspaceCanvasCommandProjection.value,
  });

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        commandProjection={commandProjection}
        designIdentity={designIdentity}
        onRenameDesign={(name) => controller.renameDesign(name)}
        onRetrySave={() => {
          void controller.continuousSave.flush().catch(logWebAppCommandError);
        }}
        search={hasDesign ? <PlaceSearchField compact /> : undefined}
      >
        {workspace ?? (
          <WebWorkspace
            controller={controller}
            panelProjection={commandProjection.panelBar}
            templatesEnabled={templatesEnabled}
          />
        )}
      </BrowserAppShell>
      <WorkspaceDialogs />
      <SaveProblemDialog />
      <SettingsDialog />
      {keyboardShortcutsDialogOpen.value && <KeyboardShortcutsDialog menus={commandProjection.workspaceMenus} />}
      <AboutCanopiDialog />
    </div>
  );
}

function logWebAppCommandError(error: unknown): void {
  console.error("Browser Web App command failed:", error);
}
