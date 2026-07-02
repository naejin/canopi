import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { useCallback, useEffect, useRef } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { activePanel, navigateTo, sidePanel, sidePanelWidth } from "./app/shell/state";
import { commitSidePanelWidth } from "./app/shell/controller";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { AboutCanopiDialog } from "./components/shared/AboutCanopiDialog";
import { ProblemReportDialog } from "./components/shared/ProblemReportDialog";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";

const MIN_SIDEBAR_WIDTH = 320;
const DEFAULT_SIDEBAR_RATIO = 0.35;
const DEFAULT_SIDEBAR_WIDTH = `clamp(${MIN_SIDEBAR_WIDTH}px, 35vw, 90vw)`;
const MAX_SIDEBAR_RATIO = 0.9;

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
        : null;

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
  const width = sidePanelWidth.value;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!new URLSearchParams(window.location.search).has("stampPrototype")) return;
    if (activePanel.peek() !== "canvas" || sidePanel.peek() !== "favorites") {
      navigateTo("favorites");
    }
  }, []);

  const showCanvas = panel === "canvas";
  const showLocation = panel === "location";
  const showSidebar = showCanvas && side !== null;

  const dragRef = useRef<{ startX: number; startW: number; lastW: number; moved: boolean } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const defaultSidebarWidth = useCallback(() => (
    Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.floor(window.innerWidth * DEFAULT_SIDEBAR_RATIO),
    )
  ), []);

  const currentSidebarWidth = useCallback(() => {
    const measured = sidebarRef.current?.getBoundingClientRect().width;
    if (measured !== undefined && Number.isFinite(measured) && measured > 0) return measured;
    return sidePanelWidth.peek() ?? defaultSidebarWidth();
  }, [defaultSidebarWidth]);

  const handleDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const startW = currentSidebarWidth();
    dragRef.current = { startX: e.clientX, startW, lastW: startW, moved: false };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // Right-side panel: dragging left = wider (negative delta = larger)
      const delta = dragRef.current.startX - ev.clientX;
      const maxW = Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO);
      const newW = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, dragRef.current.startW + delta));
      dragRef.current.lastW = newW;
      dragRef.current.moved = dragRef.current.moved || newW !== dragRef.current.startW;
      // Write to DOM directly at 60fps — commit signal on mouseup
      if (sidebarRef.current) sidebarRef.current.style.width = `${newW}px`;
    };

    const onUp = () => {
      // Commit final width to signal
      if (dragRef.current?.moved) {
        commitSidePanelWidth(dragRef.current.lastW);
      }
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

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
          <>
            <div
              onMouseDown={handleDragStart}
              className={styles.dragHandle}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('sidebar.resize')}
            />
            <div
              ref={sidebarRef}
              className={styles.sidePanel}
              style={{
                '--side-panel-width': width === null ? DEFAULT_SIDEBAR_WIDTH : `${width}px`,
                minWidth: `${MIN_SIDEBAR_WIDTH}px`,
                maxWidth: '90%',
              } as Record<string, string>}
            >
              <SidePanelContent side={side!} />
            </div>
          </>
        )}

        {/* Right panel bar — always visible */}
        {(showCanvas || showLocation) && <PanelBar />}
      </div>
      <CommandPalette />
      <AboutCanopiDialog />
      <ProblemReportDialog />
    </div>
  );
}
