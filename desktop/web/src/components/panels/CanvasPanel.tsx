import { useRef, useEffect } from 'preact/hooks'
import { autoSaveIntervalMs } from '../../state/app'
import {
  currentDesign, designName, designPath, designDirty,
  writeCanvasIntoDocument, loadCanvasFromDocument, autosaveFailed,
  consumeQueuedDocumentLoad,
  snapshotCanvasIntoCurrentDocument,
  disposeDocumentWorkflows,
  installConsortiumSync,
} from '../../state/document'
import { autosaveDesign } from '../../ipc/design'
import { CanvasSession, getCurrentCanvasSession, setCurrentCanvasSession } from '../../canvas/session'
import { SceneCanvasRuntime } from '../../canvas/runtime/scene-runtime'
import { CanvasToolbar } from '../canvas/CanvasToolbar'
import { ZoomControls } from '../canvas/ZoomControls'
import { DisplayModeControls } from '../canvas/DisplayModeControls'
import { DisplayLegend } from '../canvas/DisplayLegend'
import { BottomPanel } from '../canvas/BottomPanel'
import { BottomPanelLauncher } from '../canvas/BottomPanelLauncher'
import { LayerPanel } from '../canvas/LayerPanel'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import { canvasDirty, markCanvasDetachedDirty } from '../../state/design'
import styles from './Panels.module.css'

// Autosave interval is now configurable via Rust settings (autoSaveIntervalMs signal)

export function CanvasPanel() {
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<CanvasSession | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvasArea = canvasAreaRef.current
    if (!container || !canvasArea) return

    const runtime = new SceneCanvasRuntime()
    const session = new CanvasSession(runtime)
    sessionRef.current = session
    let cancelled = false
    let cancelQueuedLoad = () => {}
    let resizeObserver: ResizeObserver | null = null

    void runtime.init(container).then(() => {
      if (cancelled) return

      setCurrentCanvasSession(session)
      session.initializeViewport()
      if (rulerOverlayRef.current) {
        session.attachRulersTo(rulerOverlayRef.current)
      }
      if (currentDesign.value) {
        loadCanvasFromDocument(currentDesign.value, session)
        session.showCanvasChrome()
      } else {
        // Install consortium sync unconditionally — queued document loads
        // (OS file-open) call applyDocumentReplacement which does not go
        // through loadCanvasFromDocument, so the sync must already be active.
        installConsortiumSync()
        session.hideCanvasChrome()
      }

      resizeObserver = new ResizeObserver(() => {
        runtime.resize(canvasArea.clientWidth, canvasArea.clientHeight)
      })
      resizeObserver.observe(canvasArea)
      cancelQueuedLoad = consumeQueuedDocumentLoad(session)
    }).catch((error) => {
      console.error('Failed to initialize scene canvas runtime:', error)
    })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      cancelQueuedLoad()
      if (currentDesign.value) {
        try {
          snapshotCanvasIntoCurrentDocument(session, designName.value)
          markCanvasDetachedDirty(canvasDirty.value)
        } catch (error) {
          console.error('Failed to snapshot canvas before teardown:', error)
        }
      }
      disposeDocumentWorkflows()
      session.destroy()
      sessionRef.current = null
      setCurrentCanvasSession(null)
    }
  }, [])

  // Autosave timer — reactive to autoSaveIntervalMs changes.
  // Separate from engine mount so the interval recreates when settings change.
  const intervalMs = autoSaveIntervalMs.value
  useEffect(() => {
    const timer = setInterval(() => {
      if (!designDirty.value) return
      const session = getCurrentCanvasSession()
      if (!session) return
      const content = writeCanvasIntoDocument(session, designName.value)
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
          <div ref={canvasAreaRef} className={styles.canvasArea}>
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
