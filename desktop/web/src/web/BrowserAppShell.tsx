import type { ComponentChildren } from "preact";
import { t } from "../i18n";
import { ButtonTooltip } from "../components/shared/ButtonTooltip";
import { ControlIcon } from "../components/shared/ControlIcon";
import { DesignNameField } from "../components/shared/DesignNameField";
import { PanelRail } from "../components/shared/PanelRail";
import { SaveStatusLabel } from "../components/shared/SaveStatusLabel";
import { WorkspaceTitleBar } from "../components/shared/WorkspaceTitleBar";
import titleBarStyles from "../components/shared/WorkspaceTitleBar.module.css";
import {
  type BrowserShellChromeProjection,
  type BrowserShellDesignIdentity,
  type BrowserShellProjectedCommand,
} from "./browser-shell-commands";
import { browserShellNotice, dismissBrowserShellNotice } from "./browser-shell-notice";
import styles from "./BrowserAppShell.module.css";

interface BrowserAppShellProps {
  readonly commandProjection: BrowserShellChromeProjection;
  readonly designIdentity?: BrowserShellDesignIdentity | null;
  readonly onRenameDesign?: (name: string) => void;
  readonly onRetrySave?: () => void;
  /** The title-bar place field, supplied while a Design is open. */
  readonly search?: ComponentChildren;
  readonly children?: ComponentChildren;
}

/**
 * The Web Edition frame: the same floating title bar and panel rail as
 * Desktop over a full-bleed workspace. Saving is to this browser; a copy is
 * a download.
 */
export function BrowserAppShell({
  commandProjection,
  designIdentity = null,
  onRenameDesign,
  onRetrySave,
  search,
  children,
}: BrowserAppShellProps) {
  const notice = browserShellNotice.value;
  const commands = commandProjection.commands;
  const help = requireCommand(commands.get("help.shortcuts"), "help.shortcuts");
  const settings = requireCommand(commands.get("app.settings"), "app.settings");
  const openCanopi = commands.get("file.openCanopi");
  const download = commands.get("file.downloadCanopi");
  const downloadAction = {
    label: t("webShell.downloadCopy"),
    run: () => download?.action(),
  };

  return (
    <div className={styles.shell} data-testid="browser-app-shell">
      <main className={styles.workspace} aria-label={t("webShell.workspace")}>
        {children}
      </main>
      <WorkspaceTitleBar
        menus={commandProjection.workspaceMenus}
        design={designIdentity ? (
          <>
            <DesignNameField name={designIdentity.name} onRename={(name) => onRenameDesign?.(name)} />
            <SaveStatusLabel
              status={designIdentity.saveStatus}
              failureReason={designIdentity.saveFailureReason}
              draftLabel={t("webShell.savedInBrowser")}
              draftAction={{ ...downloadAction, style: "link" }}
              saveElsewhere={downloadAction}
              onRetry={() => onRetrySave?.()}
            />
          </>
        ) : undefined}
        fileActions={openCanopi ? (
          <button
            type="button"
            className={titleBarStyles.iconButton}
            data-web-command-id={openCanopi.id}
            aria-label={t("webShell.openCanopiFile")}
            aria-keyshortcuts={openCanopi.ariaShortcut}
            onClick={() => openCanopi.action()}
          >
            <ControlIcon name="folder-open" size={20} />
            <ButtonTooltip label={t("webShell.openCanopiFile")} shortcut={openCanopi.shortcut} side="bottom" />
          </button>
        ) : undefined}
        search={search}
        help={help}
        settings={settings}
      />
      {/* The Web rail stays for Templates and the catalog, which work without a Design. */}
      <PanelRail
        label={t("webShell.panels")}
        groups={[
          // The Design canvas and the Templates map are the two primary views; with
          // no Templates there is nothing to switch between.
          commandProjection.panelBar.primary.length > 1 ? commandProjection.panelBar.primary : [],
          commandProjection.panelBar.design,
          commandProjection.panelBar.planning,
        ]}
      />
      {notice ? (
        <div
          className={styles.notice}
          role={notice.tone === "error" ? "alert" : "status"}
          data-tone={notice.tone}
          data-web-shell-notice
        >
          <span className={styles.noticeTitle}>{notice.title}</span>
          <span className={styles.noticeMessage}>{notice.message}</span>
          <button
            type="button"
            className={styles.noticeDismiss}
            aria-label={t("webShell.dismissNotice")}
            onClick={dismissBrowserShellNotice}
          >
            <ControlIcon name="close" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function requireCommand(
  command: BrowserShellProjectedCommand | undefined,
  id: string,
): BrowserShellProjectedCommand {
  if (!command) throw new Error(`Browser shell projection requires '${id}'`);
  return command;
}
