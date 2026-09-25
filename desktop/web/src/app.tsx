import "./styles/global.css";
import styles from "./App.module.css";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { AboutCanopiDialog } from "./components/shared/AboutCanopiDialog";
import { SaveProblemDialog } from "./components/shared/SaveProblemDialog";
import { ProblemReportDialog } from "./components/shared/ProblemReportDialog";
import { PanelBar } from "./components/panels/PanelBar";
import { DesktopWorkspace } from "./components/workspace/DesktopWorkspace";
import { WorkspaceDialogs } from "./components/workspace/WorkspaceComposition";

export function App() {
  return (
    <div className={styles.appRoot}>
      <TitleBar />
      <DegradedBanner />
      <div className={styles.appBody}>
        <DesktopWorkspace />
        <PanelBar />
      </div>
      <CommandPalette />
      <WorkspaceDialogs />
      <AboutCanopiDialog />
      <SaveProblemDialog />
      <ProblemReportDialog />
    </div>
  );
}
