import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { initTheme } from "./utils/theme";
import { initShortcuts } from "./shortcuts/manager";
import { useCallback, useRef } from "preact/hooks";
import { activePanel, sidePanel, sidePanelWidth } from "./state/app";
import { designDirty, saveCurrentDesign } from "./state/design";
import { ActivityBar } from "./components/activity-bar/ActivityBar";
import { TitleBar } from "./components/shared/TitleBar";
import { StatusBar } from "./components/shared/StatusBar";
import { CommandPalette } from "./components/shared/CommandPalette";
import { PlantDbPanel } from "./components/panels/PlantDbPanel";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { WorldMapPanel } from "./components/panels/WorldMapPanel";
import { LearningPanel } from "./components/panels/LearningPanel";
import { getCurrentWindow } from "@tauri-apps/api/window";

initTheme();
initShortcuts();

// Save-before-close guard — runs once at module init, not inside a component.
// We keep a reference to the unlisten function so Vite HMR can remove the
// previous handler before registering a new one (prevents duplicate prompts).
//
// Typed as `unknown` to prevent TypeScript's control-flow analysis from
// narrowing the variable to `never` at the module top level (where it is
// provably null on first load but may be a function on HMR re-execution).
let _unlistenClose: unknown = null

;(function registerCloseGuard() {
  // On HMR re-execution, remove the previous listener before adding a new one.
  if (typeof _unlistenClose === 'function') (_unlistenClose as () => void)()

  getCurrentWindow().onCloseRequested(async (event) => {
    if (!designDirty.value) return  // clean — allow close immediately

    // Prevent the default close so we can prompt the user
    event.preventDefault()

    // Native confirm dialog (replace with Tauri dialog plugin in a future phase)
    const shouldSave = window.confirm(
      t('canvas.file.saveBeforeCloseMessage')
    )

    if (shouldSave) {
      try {
        await saveCurrentDesign()
      } catch {
        // Save failed or dialog was cancelled — do not close
        return
      }
    }

    // User chose "Don't save" (shouldSave=false) or save succeeded — close now
    await getCurrentWindow().close()
  }).then(unlisten => { _unlistenClose = unlisten })
})()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof _unlistenClose === 'function') {
      ;(_unlistenClose as () => void)()
      _unlistenClose = null
    }
  })
}

const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 800;

function SidePanelContent({ side }: { side: string }) {
  if (side === "plant-db") return <PlantDbPanel />;
  if (side === "learning") return <LearningPanel />;
  return null;
}

export function App() {
  const panel = activePanel.value;
  const side = sidePanel.value;
  const width = sidePanelWidth.value;

  const showCanvas = panel === "canvas";
  const showWorldMap = panel === "world-map";
  const showSidebar = showCanvas && side !== null;

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidePanelWidth.value };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const newW = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dragRef.current.startW + delta));
      sidePanelWidth.value = newW;
    };

    const onUp = () => {
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
      <div className={styles.appBody}>
        <ActivityBar />

        {/* Resizable side panel */}
        {showSidebar && (
          <>
            <div
              className={styles.sidePanel}
              style={{
                width: `${width}px`,
                minWidth: `${MIN_SIDEBAR_WIDTH}px`,
                maxWidth: `${MAX_SIDEBAR_WIDTH}px`,
              }}
            >
              <SidePanelContent side={side!} />
            </div>
            {/* Drag handle */}
            <div
              onMouseDown={handleDragStart}
              className={styles.dragHandle}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-primary)"; }}
              onMouseLeave={(e) => { if (!dragRef.current) (e.currentTarget as HTMLElement).style.background = ""; }}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('sidebar.resize')}
            />
          </>
        )}

        {/* Main content area */}
        {showCanvas && <CanvasPanel />}
        {showWorldMap && <WorldMapPanel />}
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}
