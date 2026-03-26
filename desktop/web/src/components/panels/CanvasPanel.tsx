import { useRef, useEffect } from 'preact/hooks'
import { locale, autoSaveIntervalMs } from '../../state/app'
import { canvasReady, zoomLevel, zoomReference } from '../../state/canvas'
import {
  currentDesign, designName, designPath, designDirty,
  pendingDesignPath,
  writeCanvasIntoDocument, loadCanvasFromDocument, extractExtra,
  resetDirtyBaselines, autosaveFailed,
} from '../../state/document'
import { autosaveDesign, loadDesign } from '../../ipc/design'
import { CanvasEngine, setCanvasEngine, canvasEngine } from '../../canvas/engine'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { ZoomControls } from '../canvas/ZoomControls'
import { WelcomeScreen } from '../shared/WelcomeScreen'
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
    zoomReference.value = initScale
    // Attach HTML rulers to the overlay div (sits above the Konva canvas)
    if (rulerOverlayRef.current) {
      engine.attachRulersTo(rulerOverlayRef.current)
    }
    // If a design is already loaded (e.g., panel switch back), restore it
    // into the fresh engine. Otherwise hide chrome until new/open.
    if (currentDesign.value) {
      loadCanvasFromDocument(currentDesign.value, engine)
      engine.showCanvasChrome()
    } else {
      engine.hideCanvasChrome()
    }

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

  return (
    <div className={styles.canvasPanel}>
      {hasDesign && <CanvasToolbar />}

      <div className={styles.canvasArea}>
        <div ref={containerRef} className={styles.canvasContainer} />
        <div ref={rulerOverlayRef} className={styles.rulerOverlay} />

        {!hasDesign && <WelcomeScreen />}
        {hasDesign && <ZoomControls />}
      </div>
    </div>
  )
}
