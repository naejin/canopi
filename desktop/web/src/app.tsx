import "./styles/global.css";
import "./i18n";
import { initTheme } from "./utils/theme";
import { initShortcuts } from "./shortcuts/manager";
import { activePanel, savedDesignsOpen } from "./state/app";
import { ActivityBar } from "./components/activity-bar/ActivityBar";
import { StatusBar } from "./components/shared/StatusBar";
import { CommandPalette } from "./components/shared/CommandPalette";
import { PlantDbPanel } from "./components/panels/PlantDbPanel";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { WorldMapPanel } from "./components/panels/WorldMapPanel";
import { LearningPanel } from "./components/panels/LearningPanel";
import { SavedDesignsPanel } from "./components/panels/SavedDesignsPanel";

initTheme();
initShortcuts();

function ActivePanel() {
  switch (activePanel.value) {
    case "plant-db":
      return <PlantDbPanel />;
    case "canvas":
      return <CanvasPanel />;
    case "world-map":
      return <WorldMapPanel />;
    case "learning":
      return <LearningPanel />;
  }
}

export function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <ActivityBar />
        {savedDesignsOpen.value && <SavedDesignsPanel />}
        <ActivePanel />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
