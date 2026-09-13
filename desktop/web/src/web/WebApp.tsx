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
import { WebWorkspace } from "./WebWorkspace";

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
  const shellCapabilities = useMemo<BrowserShellCapabilities>(
    () => createBrowserShellCapabilities(controller, logWebAppCommandError),
    [controller],
  );
  const commandProjection = createBrowserShellCommandProjection({
    currentPanel: activePanel.value,
    currentSidePanel: sidePanel.value,
    downloadCanopiEnabled: hasDesign,
    templatesEnabled,
    capabilities: shellCapabilities,
  });

  useEffect(() => controller.installAutosave(), [controller]);

  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell
        commandProjection={commandProjection}
        designIdentity={designIdentity}
        onRenameDesign={(name) => controller.renameDesign(name)}
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
    </div>
  );
}

function logWebAppCommandError(error: unknown): void {
  console.error("Browser Web App command failed:", error);
}
