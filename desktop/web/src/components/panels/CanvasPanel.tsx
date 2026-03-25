import { useRef, useEffect } from 'preact/hooks'
import { t } from '../../i18n'
import { locale, autoSaveIntervalMs } from '../../state/app'
import { canvasReady, layerPanelOpen, bottomPanelOpen, zoomLevel } from '../../state/canvas'
import {
  currentDesign, designName, designPath, designDirty,
  newDesignAction, openDesign, pendingDesignPath,
  writeCanvasIntoDocument, loadCanvasFromDocument, extractExtra,
  resetDirtyBaselines, autosaveFailed,
} from '../../state/document'
import { autosaveDesign, loadDesign } from '../../ipc/design'
import { CanvasEngine, setCanvasEngine, canvasEngine } from '../../canvas/engine'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { LayerPanel } from '../canvas/LayerPanel'
import { BottomPanel } from '../canvas/BottomPanel'
import styles from './Panels.module.css'

// Autosave interval is now configurable via Rust settings (autoSaveIntervalMs signal)

export function CanvasPanel() {
  // Subscribe to locale so the component re-renders when language changes
  void locale.value
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<CanvasEngine | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const engine = new CanvasEngine()
    engine.init(container, container.clientWidth, container.clientHeight)
    engineRef.current = engine
    setCanvasEngine(engine)
    canvasReady.value = true

    // Set initial view to show ~100m × 100m centered on origin
    const TARGET_M = 100
    const w = container.clientWidth
    const h = container.clientHeight
    const initScale = Math.min(w, h) / TARGET_M
    engine.stage.scale({ x: initScale, y: initScale })
    // Center origin in the viewport
    engine.stage.position({ x: w / 2 - (TARGET_M / 2) * initScale, y: h / 2 - (TARGET_M / 2) * initScale })
    zoomLevel.value = initScale
    // Attach HTML rulers to the overlay div (sits above the Konva canvas)
    if (rulerOverlayRef.current) {
      engine.attachRulersTo(rulerOverlayRef.current)
    }
    // Hide all canvas chrome until a design is created/loaded
    engine.hideCanvasChrome()

    // Load a file queued by SavedDesignsPanel before canvas was mounted
    const queued = pendingDesignPath.value
    if (queued) {
      pendingDesignPath.value = null
      void loadDesign(queued).then((file) => {
        file.extra = extractExtra(file as unknown as Record<string, unknown>)
        loadCanvasFromDocument(file, engine)
        currentDesign.value = file
        designName.value = file.name
        designPath.value = queued
        resetDirtyBaselines()
        engine.history.clear()
      }).catch(() => {
        // File no longer exists or failed to load — ignore, canvas stays empty
      })
    }

    return () => {
      engine.destroy()
      engineRef.current = null
      setCanvasEngine(null)
      canvasReady.value = false
    }
  }, [])

  // Autosave timer — reactive to autoSaveIntervalMs changes.
  // Separate from engine mount so the interval recreates when settings change.
  const intervalMs = autoSaveIntervalMs.value
  useEffect(() => {
    const timer = setInterval(() => {
      if (!designDirty.value) return
      const eng = canvasEngine
      if (!eng) return
      const content = writeCanvasIntoDocument(eng, designName.value)
      autosaveDesign(content, designPath.value)
        .then(() => { autosaveFailed.value = false })
        .catch((err) => {
          console.error('Autosave failed:', err)
          autosaveFailed.value = true
        })
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  const hasDesign = currentDesign.value !== null

  // Consume layerPanelOpen / bottomPanelOpen to re-render when they change
  void layerPanelOpen.value
  void bottomPanelOpen.value

  return (
    <div className={styles.canvasPanel}>
      {/* Toolbar + layer panel + bottom panel only visible when a design is active */}
      {hasDesign && <CanvasToolbar />}

      <div className={styles.canvasRow}>
        <div className={styles.canvasColumn}>
          <div className={styles.canvasArea}>
            <div ref={containerRef} className={styles.canvasContainer} />
            {/* Ruler overlay — always in DOM so attachRulersTo() can find it on init.
                Visibility controlled by showCanvasChrome() / hideCanvasChrome(). */}
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />

            {!hasDesign && (
              <div className={styles.canvasEmptyState} role="region" aria-label={t('canvas.emptyWelcome')}>
                <img
                  src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
                  className={styles.emptyLogo}
                  alt="Canopi"
                  aria-hidden="true"
                />

                <h2 className={styles.emptyTitle}>{t('canvas.emptyWelcome')}</h2>
                <p className={styles.emptyHint}>{t('canvas.emptyHint')}</p>

                <div className={styles.emptyActions}>
                  <button
                    className={`${styles.emptyAction} ${styles.emptyActionPrimary}`}
                    type="button"
                    aria-label={t('canvas.emptyNewDesign')}
                    onClick={() => { void newDesignAction() }}
                  >
                    {t('canvas.emptyNewDesign')}
                  </button>
                  <button
                    className={styles.emptyAction}
                    type="button"
                    aria-label={t('canvas.emptyOpenDesign')}
                    onClick={() => { void openDesign() }}
                  >
                    {t('canvas.emptyOpenDesign')}
                  </button>
                </div>
              </div>
            )}

            {/* Bottom panel toggle — only when design is active and panel is collapsed */}
            {hasDesign && !bottomPanelOpen.value && (
              <button
                type="button"
                className={styles.bottomPanelToggle}
                onClick={() => { bottomPanelOpen.value = true }}
                aria-label={t('canvas.bottomPanel.expand')}
                title={t('canvas.bottomPanel.expand')}
              >
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="12" height="12">
                  <path d="M3 11L8 6L13 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
          {hasDesign && <BottomPanel />}
        </div>
        {hasDesign && <LayerPanel />}
      </div>
    </div>
  )
}
