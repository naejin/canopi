import { useRef, useEffect } from 'preact/hooks'
import { locale, autoSaveIntervalMs } from '../../state/app'
import { canvasReady } from '../../state/canvas'
import {
  currentDesign, designName, designPath, designDirty,
  writeCanvasIntoDocument, loadCanvasFromDocument, autosaveFailed,
  consumeQueuedDocumentLoad,
} from '../../state/document'
import { autosaveDesign } from '../../ipc/design'
import { CanvasEngine, setCanvasEngine, canvasEngine } from '../../canvas/engine'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { ZoomControls } from '../canvas/ZoomControls'
import { DisplayModeControls } from '../canvas/DisplayModeControls'
import { DisplayLegend } from '../canvas/DisplayLegend'
import { BottomPanel } from '../canvas/BottomPanel'
import { BottomPanelLauncher } from '../canvas/BottomPanelLauncher'
import { LayerPanel } from '../canvas/LayerPanel'
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

    engine.initializeViewport()
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

    const cancelQueuedLoad = consumeQueuedDocumentLoad(engine)

    return () => {
      cancelQueuedLoad()
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

      <div className={styles.canvasColumn}>
        <div className={styles.canvasRow}>
          <div className={styles.canvasArea}>
            <div ref={containerRef} className={styles.canvasContainer} />
            <div ref={rulerOverlayRef} className={styles.rulerOverlay} />

            {!hasDesign && <WelcomeScreen />}
            {hasDesign && <DisplayLegend />}
          </div>
          {hasDesign && <LayerPanel />}
        </div>
        {hasDesign && (
          <div className={styles.canvasBar}>
            <BottomPanelLauncher />
            <div className={styles.canvasBarSpacer} />
            <DisplayModeControls />
            <div className={styles.canvasBarDivider} />
            <ZoomControls />
          </div>
        )}
        {hasDesign && <BottomPanel />}
      </div>
    </div>
  )
}
