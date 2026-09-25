import type { ComponentChildren } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import { activePanel, sidePanel } from "../app/shell/state";
import styles from "./WebApp.module.css";
import { BrowserAppShell } from "./BrowserAppShell";
import {
  createBrowserShellCommandProjection,
  createBrowserShellCapabilities,
  type BrowserShellCapabilities,
} from "./browser-shell-commands";
import {
  browserDesignSessionController,
  type BrowserDesignSessionController,
} from "./browser-design-session";
import { hasConfiguredStaticDesignTemplates } from "../app/community/catalog.browser";
import { WorkspaceDialogs } from "../components/workspace/WorkspaceComposition";
import { SaveProblemDialog } from "../components/shared/SaveProblemDialog";
import { WebWorkspace } from "./WebWorkspace";
import { createBrowserGeoJsonWorkflow } from "./browser-geojson";
import { currentCanvasSession } from "../canvas/session";
import type { GeoJsonWorkflow } from "../app/geojson/workflow";

interface WebAppProps {
  readonly controller?: BrowserDesignSessionController;
  readonly templatesEnabled?: boolean;
  readonly workspace?: ComponentChildren;
  readonly geoJson?: GeoJsonWorkflow;
}

export function WebApp({
  controller = browserDesignSessionController,
  templatesEnabled = hasConfiguredStaticDesignTemplates(),
  workspace,
  geoJson,
}: WebAppProps) {
  const hasDesign = controller.hasCurrentDesign();
  const designIdentity = controller.readDesignIdentity();
  const geoJsonWorkflow = useMemo(() => geoJson ?? createBrowserGeoJsonWorkflow(), [geoJson]);
  const shellCapabilities = useMemo<BrowserShellCapabilities>(
    () => createBrowserShellCapabilities(controller, logWebAppCommandError, geoJsonWorkflow),
    [controller, geoJsonWorkflow],
  );
  const commandProjection = createBrowserShellCommandProjection({
    currentPanel: activePanel.value,
    currentSidePanel: sidePanel.value,
    downloadCanopiEnabled: hasDesign,
    revertAvailable: controller.continuousSave.revertAvailable.value,
    geoJsonEnabled: hasDesign && currentCanvasSession.value !== null,
    templatesEnabled,
    capabilities: shellCapabilities,
  });

  useEffect(() => {
    try {
      controller.restoreLatestDraft();
    } catch (error) {
      logWebAppCommandError(error);
    }
    return controller.installContinuousSave();
  }, [controller]);

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        commandProjection={commandProjection}
        designIdentity={designIdentity}
        onRenameDesign={(name) => controller.renameDesign(name)}
        onRetrySave={() => {
          void controller.continuousSave.flush().catch(logWebAppCommandError);
        }}
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
    </div>
  );
}

function logWebAppCommandError(error: unknown): void {
  console.error("Browser Web App command failed:", error);
}
