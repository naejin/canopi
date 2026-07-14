import { useEffect, useRef } from 'preact/hooks'
import {
  designSessionStore,
  type DesignSessionStore,
} from '../app/document-session/store'
import { locale } from '../app/settings/state'
import { getCurrentCanvasSession, setCanvasRuntimeSurfaces } from '../canvas/session'
import { runCanvasRuntimeCleanups } from '../canvas/runtime/cleanup'
import type { CanvasDocumentSurface, CanvasRuntimeHost } from '../canvas/runtime/runtime'
import {
  CanvasRuntimeLifecycleBusyError,
  claimCanvasRuntimeLifecycle,
  ensureCanvasRuntimeLifecycleAvailable,
} from '../canvas/runtime/lifecycle-owner'
import { ZoomControls } from '../components/canvas/ZoomControls'
import panelStyles from '../components/panels/Panels.module.css'
import { browserDesignSessionController, type BrowserDesignSessionController } from './browser-design-session'
import { createBrowserCanvasRuntimeHost } from './browser-canvas-runtime'
import { WebCanvasToolbar } from './WebCanvasToolbar'
import { WebWelcomeScreen } from './WebWelcomeScreen'

interface WebCanvasWorkspaceProps {
  readonly controller?: BrowserDesignSessionController
  readonly store?: DesignSessionStore
  readonly createRuntimeHost?: () => CanvasRuntimeHost
}

interface MountedRuntime {
  readonly host: CanvasRuntimeHost
  detachCanvasSession: () => void
  resizeObserver: ResizeObserver | null
}

export function WebCanvasWorkspace({
  controller = browserDesignSessionController,
  store = designSessionStore,
  createRuntimeHost = createBrowserCanvasRuntimeHost,
}: WebCanvasWorkspaceProps) {
  void locale.value
  const hasDesign = store.currentDesign.value !== null
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rulerOverlayRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<MountedRuntime | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvasArea = canvasAreaRef.current
    if (!container || !canvasArea) return

    ensureCanvasRuntimeLifecycleAvailable()
    let cancelled = false
    let released = false
    let releasing = false
    let attachmentInProgress = false
    let releaseRuntime = () => {}
    const runtimeLease = claimCanvasRuntimeLifecycle(() => releaseRuntime())
    let host: CanvasRuntimeHost
    try {
      host = createRuntimeHost()
    } catch (error) {
      runtimeLease.release()
      throw error
    }
    runtimeRef.current = {
      host,
      detachCanvasSession: () => {},
      resizeObserver: null,
    }

    releaseRuntime = () => {
      if (released || releasing) return
      if (attachmentInProgress) {
        throw new CanvasRuntimeLifecycleBusyError(
          'Browser Canvas attachment is still in progress',
        )
      }
      releasing = true
      const mounted = runtimeRef.current?.host === host ? runtimeRef.current : null
      try {
        mounted?.detachCanvasSession()
        released = true
        try {
          runCanvasRuntimeCleanups([
            () => {
              const observer = mounted?.resizeObserver
              if (mounted) mounted.resizeObserver = null
              observer?.disconnect()
            },
            () => host.destroy(),
            () => {
              if (mounted) runtimeRef.current = null
            },
            () => {
              if (getCurrentCanvasSession() === host.surfaces) {
                setCanvasRuntimeSurfaces(null)
              }
            },
          ], 'Browser Canvas runtime cleanup failed')
        } catch (error) {
          console.error('Failed to release browser canvas runtime:', error)
        }
      } finally {
        releasing = false
      }
    }

    void host.init(container).then(() => {
      if (cancelled) return

      const mounted = runtimeRef.current
      if (!mounted) return
      const runtimeIsActive = () => !cancelled
        && !released
        && runtimeRef.current?.host === host
      const documents = host.surfaces.documents
      documents.initializeViewport()
      if (!runtimeIsActive()) return
      documents.attachRulersTo(rulerOverlayRef.current ?? canvasArea)
      if (!runtimeIsActive()) return

      let detachCanvasSession: () => void
      attachmentInProgress = true
      try {
        detachCanvasSession = controller.attachCanvasSession(documents)
      } finally {
        attachmentInProgress = false
      }
      mounted.detachCanvasSession = detachCanvasSession
      if (!runtimeIsActive()) {
        runtimeLease.release()
        return
      }

      installResizeObserver(mounted, canvasArea, documents, runtimeIsActive)
      if (!runtimeIsActive()) return
      setCanvasRuntimeSurfaces(host.surfaces)
    }).catch((error: unknown) => {
      try {
        runtimeLease.release()
      } catch (releaseError) {
        console.error('Failed to release browser canvas runtime:', releaseError)
      }
      if (!cancelled) {
        console.error('Failed to initialize browser canvas runtime:', error)
      }
    })

    return () => {
      cancelled = true
      runtimeLease.release()
    }
  }, [controller, createRuntimeHost, store])

  return (
    <div className={panelStyles.canvasPanel} data-testid="web-canvas-workspace">
      {hasDesign && <WebCanvasToolbar />}
      <div className={panelStyles.canvasColumn}>
        <div className={panelStyles.canvasRow}>
          <div ref={canvasAreaRef} className={panelStyles.canvasArea}>
            <div
              ref={containerRef}
              className={panelStyles.canvasContainer}
              data-map-active="false"
              data-testid="web-canvas-runtime-host"
            />
            <div ref={rulerOverlayRef} className={panelStyles.rulerOverlay} />
            {!hasDesign && (
              <div className={panelStyles.canvasEmptyState}>
                <WebWelcomeScreen controller={controller} />
              </div>
            )}
          </div>
        </div>
        {hasDesign && (
          <div className={panelStyles.canvasBar}>
            <div className={panelStyles.canvasBarSpacer} />
            <ZoomControls />
          </div>
        )}
      </div>
    </div>
  )
}

function installResizeObserver(
  mounted: MountedRuntime,
  canvasArea: HTMLElement,
  documents: CanvasDocumentSurface,
  runtimeIsActive: () => boolean,
): void {
  const resize = () => {
    documents.resize(canvasArea.clientWidth, canvasArea.clientHeight)
  }
  resize()
  if (!runtimeIsActive() || typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(resize)
  if (!runtimeIsActive()) {
    observer.disconnect()
    return
  }
  mounted.resizeObserver = observer
  observer.observe(canvasArea)
}
