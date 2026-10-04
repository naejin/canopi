import "./styles/global.css";
import styles from "./App.module.css";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { AboutCanopiDialog } from "./components/shared/AboutCanopiDialog";
import { SaveProblemDialog } from "./components/shared/SaveProblemDialog";
import { ProblemReportDialog } from "./components/shared/ProblemReportDialog";
import { SettingsDialog, type SettingsFoldersAdapter } from "./components/shared/SettingsDialog";
import { KeyboardShortcutsDialog } from "./components/shared/KeyboardShortcutsDialog";
import { DesktopPanelRail } from "./components/panels/DesktopPanelRail";
import { DesktopWorkspace } from "./components/workspace/DesktopWorkspace";
import { WorkspaceDialogs } from "./components/workspace/WorkspaceComposition";
import { keyboardShortcutsDialogOpen } from "./app/shell/dialogs";
import { appCommandGraphChromeProjection } from "./commands/registry";
import { getAppFolders, showAppFolder } from "./ipc/settings";

/** Settings › Files and data on Desktop: the app-data folders and Show in folder. */
const DESKTOP_FOLDERS: SettingsFoldersAdapter = { load: getAppFolders, show: showAppFolder };

export function App() {
  return (
    <div className={styles.appRoot}>
      <DesktopWorkspace />
      <TitleBar />
      <DesktopPanelRail />
      <DegradedBanner />
      <CommandPalette />
      <WorkspaceDialogs />
      <SettingsDialog folders={DESKTOP_FOLDERS} />
      <DesktopKeyboardShortcuts />
      <AboutCanopiDialog />
      <SaveProblemDialog />
      <ProblemReportDialog />
    </div>
  );
}

function DesktopKeyboardShortcuts() {
  if (!keyboardShortcutsDialogOpen.value) return null;
  return <KeyboardShortcutsDialog menus={appCommandGraphChromeProjection.value.menus} />;
}
