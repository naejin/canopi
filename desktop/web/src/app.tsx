import "./styles/global.css";
import styles from "./App.module.css";
import { t } from "./i18n";
import { initTheme } from "./utils/theme";
import { initShortcuts } from "./shortcuts/manager";
import { useCallback, useRef } from "preact/hooks";
import { activePanel, sidePanel, sidePanelWidth, plantDbStatus, locale, theme, autoSaveIntervalMs, setBootstrappedSettings } from "./state/app";
import { designDirty, saveCurrentDesign } from "./state/document";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import type { SubsystemHealth } from "./types/health";
import { TitleBar } from "./components/shared/TitleBar";
import { DegradedBanner } from "./components/shared/DegradedBanner";
import { CommandPalette } from "./components/shared/CommandPalette";
import { PlantDbPanel } from "./components/panels/PlantDbPanel";
import { CanvasPanel } from "./components/panels/CanvasPanel";
import { PanelBar } from "./components/panels/PanelBar";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Settings } from "./types/settings";
import { gridSize, snapToGridEnabled } from "./state/canvas";

// Synchronous init — applies local defaults immediately (no theme flicker)
initTheme();
initShortcuts();

// Async bootstrap — hydrate from persisted Rust settings, reconcile on arrival
invoke<SubsystemHealth>('get_health')
  .then((h) => { plantDbStatus.value = h.plant_db })
  .catch((e) => console.error('Failed to query health:', e));

invoke<Settings>('get_settings')
  .then((s) => {
    locale.value = s.locale;
    theme.value = s.theme === 'dark' ? 'dark' : 'light';
    gridSize.value = s.grid_size_m;
    snapToGridEnabled.value = s.snap_to_grid;
    autoSaveIntervalMs.value = s.auto_save_interval_s * 1000;
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
    if (!designDirty.value) return  // clean — allow close immediately

    // Prevent the default close so we can prompt the user
    event.preventDefault()

    const shouldSave = await ask(
      t('canvas.file.saveBeforeCloseMessage'),
      { title: t('canvas.file.saveBeforeClose'), kind: 'warning' }
    )

    if (shouldSave) {
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
const MAX_SIDEBAR_WIDTH = 800;

function LearningPlaceholder() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: '32px 24px', textAlign: 'center', gap: '12px',
      background: 'var(--color-bg)',
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        <path d="M8 7h6M8 11h4" />
      </svg>
      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>
        Coming soon
      </span>
      <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', maxWidth: '220px', lineHeight: 1.5 }}>
        Companion planting guides, design patterns, and permaculture principles — all searchable from here.
      </span>
    </div>
  )
}

function SidePanelContent({ side }: { side: string }) {
  if (side === "plant-db") return <PlantDbPanel />;
  if (side === "learning") return <LearningPlaceholder />;
  return null;
}

export function App() {
  const panel = activePanel.value;
  const side = sidePanel.value;
  const width = sidePanelWidth.value;

  const showCanvas = panel === "canvas";
  const showSidebar = showCanvas && side !== null;

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const handleDragStart = useCallback((e: MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: sidePanelWidth.value };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      // Right-side panel: dragging left = wider (negative delta = larger)
      const delta = dragRef.current.startX - ev.clientX;
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
      <DegradedBanner />
      <div className={styles.appBody}>
        {/* Canvas — always fills available space */}
        {showCanvas && <CanvasPanel />}

        {/* Right side panel (plant search, etc.) */}
        {showSidebar && (
          <>
            <div
              onMouseDown={handleDragStart}
              className={styles.dragHandle}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-accent)"; }}
              onMouseLeave={(e) => { if (!dragRef.current) (e.currentTarget as HTMLElement).style.background = ""; }}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('sidebar.resize')}
            />
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
          </>
        )}

        {/* Right panel bar — always visible */}
        {showCanvas && <PanelBar />}
      </div>
      <CommandPalette />
    </div>
  );
}
