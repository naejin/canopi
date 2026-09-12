import { CanvasPdfDialog } from './components/canvas-pdf/CanvasPdfDialog'
import "./styles/global.css";
import styles from "./App.module.css";
import { lazy, Suspense } from "preact/compat";
import { activePanel, sidePanel } from "./app/shell/state";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { AboutCanopiDialog } from "./components/shared/AboutCanopiDialog";
import { ProblemReportDialog } from "./components/shared/ProblemReportDialog";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";
import { SidePanelDock } from "./components/shared/SidePanelDock";

const PlantDbPanel = lazy(async () => {
  const module = await import("./components/panels/PlantDbPanel");
  return { default: module.PlantDbPanel };
});

const FavoritesPanel = lazy(async () => {
  const module = await import("./components/panels/FavoritesPanel");
  return { default: module.FavoritesPanel };
});

const DesignNotebookPanel = lazy(async () => {
  const module = await import("./components/panels/DesignNotebookPanel");
  return { default: module.DesignNotebookPanel };
});

const SpeciesKeyPanel = lazy(async () => {
  const module = await import("./components/panels/DesktopSpeciesKeyPanel");
  return { default: module.DesktopSpeciesKeyPanel };
});
const LayerPanel = lazy(async () => {
  const module = await import("./components/panels/LayersPanel");
  return { default: module.LayersPanel };
});

const LocationPanel = lazy(async () => {
  const module = await import("./components/panels/LocationPanel");
  return { default: module.LocationPanel };
});

function SidePanelContent({ side }: { side: string }) {
  const Panel = side === "plant-db"
    ? PlantDbPanel
    : side === "favorites"
      ? FavoritesPanel
      : side === "design-notebook"
        ? DesignNotebookPanel
        : side === "species-key" ? SpeciesKeyPanel
          : side === "layers" ? LayerPanel : null;

  if (!Panel) return null;

  return (
    <Suspense fallback={<div className={styles.sidePanelLoading} aria-hidden="true" />}>
      <Panel />
    </Suspense>
  );
}

export function App() {
  const panel = activePanel.value;
  const side = sidePanel.value;

  const showCanvas = panel === "canvas";
  const showLocation = panel === "location";
  const showSidebar = showCanvas && side !== null;


  return (
    <div className={styles.appRoot}>
      <TitleBar />
      <DegradedBanner />
      <div className={styles.appBody}>
        {/* Canvas — always fills available space */}
        {showCanvas && <CanvasPanel />}
        {showLocation && (
          <Suspense fallback={<div className={styles.sidePanelLoading} aria-hidden="true" />}>
            <LocationPanel />
          </Suspense>
        )}

        {/* Right side panel (Species Catalog Workbench, favorites, etc.) */}
        {showSidebar && (
          <SidePanelDock><SidePanelContent side={side!} /></SidePanelDock>
        )}

        {/* Right panel bar — always visible */}
        {(showCanvas || showLocation) && <PanelBar />}
      </div>
      <CommandPalette />
      <CanvasPdfDialog />
      <AboutCanopiDialog />
      <ProblemReportDialog />
    </div>
  );
}
