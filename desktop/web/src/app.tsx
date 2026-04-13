import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { initTheme } from "./utils/theme";
import { initShortcuts } from "./shortcuts/manager";
import { useCallback, useRef } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { activePanel, sidePanel, sidePanelWidth, plantDbStatus, setBootstrappedSettings, flushQueuedSettingsPersist } from "./state/app";
import { designDirty, saveCurrentDesign } from "./state/document";
import { invoke } from "@tauri-apps/api/core";
import type { SubsystemHealth } from "./types/health";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirmCloseWithUnsavedChanges } from "./state/close-guard";

import type { Settings } from "./types/settings";
// Synchronous init — applies local defaults immediately (no theme flicker)
initTheme();
initShortcuts();

// Async bootstrap — hydrate from persisted Rust settings, reconcile on arrival
invoke<SubsystemHealth>('get_health')
  .then((h) => { plantDbStatus.value = h.plant_db })
  .catch((e) => console.error('Failed to query health:', e));

invoke<Settings>('get_settings')
  .then((s) => {
    setBootstrappedSettings(s);
  })
  .catch((e) => console.error('Failed to bootstrap settings:', e));

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
    flushQueuedSettingsPersist()

    if (!designDirty.value) return  // clean — allow close immediately

    // Prevent the default close so we can prompt the user
    event.preventDefault()

    const decision = await confirmCloseWithUnsavedChanges()

    if (decision === 'cancel') {
      return
    }

    if (decision === 'save') {
      try {
        await saveCurrentDesign()
      } catch {
        // Save failed or dialog was cancelled — do not close
        return
      }
    }

    // User chose "Don't save" (shouldSave=false) or save succeeded — close now.
    // Must use destroy() instead of close() because close() re-emits
    // closeRequested, re-entering this handler while designDirty is still true.
    await getCurrentWindow().destroy()
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
      <DegradedBanner />
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
      <CommandPalette />
    </div>
  );
}
