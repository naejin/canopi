import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { useCallback, useRef } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { activePanel, sidePanel, sidePanelWidth } from "./app/shell/state";
import { TitleBar } from "./components/shared/TitleBar";
import { ShellNotices } from "./components/shared/ShellNotices";
import { CommandPalette } from "./components/shared/CommandPalette";
import { SettingsModal } from "./components/shared/SettingsModal";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";

const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_RATIO = 0.9;

const PlantDbPanel = lazy(async () => {
  const module = await import("./components/panels/PlantDbPanel");
  return { default: module.PlantDbPanel };
});

const FavoritesPanel = lazy(async () => {
  const module = await import("./components/panels/FavoritesPanel");
  return { default: module.FavoritesPanel };
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

  const showCanvas = panel === "canvas";
  const showLocation = panel === "location";
  const showSidebar = showCanvas && side !== null;

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidePanelWidth.peek() };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // Right-side panel: dragging left = wider (negative delta = larger)
      const delta = dragRef.current.startX - ev.clientX;
      const maxW = Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO);
      const newW = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxW, dragRef.current.startW + delta));
      // Write to DOM directly at 60fps — commit signal on mouseup
      if (sidebarRef.current) sidebarRef.current.style.width = `${newW}px`;
    };

    const onUp = () => {
      // Commit final width to signal
      if (sidebarRef.current) {
        sidePanelWidth.value = parseInt(sidebarRef.current.style.width, 10) || sidePanelWidth.peek();
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
      <ShellNotices />
      <div className={styles.appBody}>
        {/* Canvas — always fills available space */}
        {showCanvas && <CanvasPanel />}
        {showLocation && (
          <Suspense fallback={<div className={styles.sidePanelLoading} aria-hidden="true" />}>
            <LocationPanel />
          </Suspense>
        )}

        {/* Right side panel (plant search, etc.) */}
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
                width: `${width}px`,
                minWidth: `${MIN_SIDEBAR_WIDTH}px`,
                maxWidth: '90%',
              }}
            >
              <SidePanelContent side={side!} />
            </div>
          </>
        )}

        {/* Right panel bar — always visible */}
        {(showCanvas || showLocation) && <PanelBar />}
      </div>
      <SettingsModal />
      <CommandPalette />
    </div>
  );
}
