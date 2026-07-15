import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { useRef } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { activePanel, sidePanel, sidePanelWidth } from "./app/shell/state";
import { commitSidePanelWidth } from "./app/shell/controller";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { AboutCanopiDialog } from "./components/shared/AboutCanopiDialog";
import { ProblemReportDialog } from "./components/shared/ProblemReportDialog";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";
import { usePointerResize } from "./components/shared/usePointerResize";

const MIN_SIDEBAR_WIDTH = 320;
const DEFAULT_SIDEBAR_RATIO = 0.35;
const DEFAULT_SIDEBAR_WIDTH = `clamp(${MIN_SIDEBAR_WIDTH}px, 35vw, 90vw)`;
const MAX_SIDEBAR_RATIO = 0.9;

interface SidebarResizeSession {
  readonly panel: HTMLDivElement;
  readonly startX: number;
  readonly startWidth: number;
  readonly previousInlineWidth: string;
}

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

function SidePanelResizeHandle({
  panelRef,
}: {
  panelRef: { current: HTMLDivElement | null };
}) {
  const onPointerDown = usePointerResize<SidebarResizeSession>({
    cursor: "col-resize",
    begin: (event) => {
      const panel = panelRef.current;
      if (!panel) return null;
      return {
        panel,
        startX: event.clientX,
        startWidth: currentSidebarWidth(panel),
        previousInlineWidth: panel.style.width,
      };
    },
    preview: (session, event) => {
      const width = resolveSidebarWidth(session, event.clientX);
      session.panel.style.width = `${width}px`;
      return width !== session.startWidth;
    },
    commit: (session, event) => {
      commitSidePanelWidth(resolveSidebarWidth(session, event.clientX));
    },
    rollback: (session) => {
      session.panel.style.width = session.previousInlineWidth;
    },
  });

  return (
    <div
      onPointerDown={onPointerDown}
      className={styles.dragHandle}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('sidebar.resize')}
    />
  );
}

function currentSidebarWidth(panel: HTMLDivElement): number {
  const measured = panel.getBoundingClientRect().width;
  if (Number.isFinite(measured) && measured > 0) return measured;
  return sidePanelWidth.peek() ?? Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.floor(window.innerWidth * DEFAULT_SIDEBAR_RATIO),
  );
}

function resolveSidebarWidth(session: SidebarResizeSession, clientX: number): number {
  // Right-side panel: dragging left = wider (negative delta = larger).
  const delta = session.startX - clientX;
  const maxWidth = Math.floor(window.innerWidth * MAX_SIDEBAR_RATIO);
  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(maxWidth, session.startWidth + delta),
  );
}

export function App() {
  const panel = activePanel.value;
  const side = sidePanel.value;
  const width = sidePanelWidth.value;

  const showCanvas = panel === "canvas";
  const showLocation = panel === "location";
  const showSidebar = showCanvas && side !== null;

  const sidebarRef = useRef<HTMLDivElement>(null);

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
            <SidePanelResizeHandle panelRef={sidebarRef} />
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
