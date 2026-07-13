import { useEffect, useRef } from 'preact/hooks'
import {
  designSessionStore,
  type DesignSessionStore,
} from '../app/document-session/store'
import { locale } from '../app/settings/state'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import type { CanvasDocumentSurface, CanvasRuntimeHost } from '../canvas/runtime/runtime'
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

    let cancelled = false
    let released = false
    const host = createRuntimeHost()
    runtimeRef.current = {
      host,
      detachCanvasSession: () => {},
      resizeObserver: null,
    }

    const releaseRuntime = () => {
      if (released) return
      released = true
      const mounted = runtimeRef.current?.host === host ? runtimeRef.current : null
      if (mounted) runtimeRef.current = null
      try {
        mounted?.resizeObserver?.disconnect()
        mounted?.detachCanvasSession()
      } finally {
        try {
          host.destroy()
        } finally {
          setCanvasRuntimeSurfaces(null)
        }
      }
    }

    void host.init(container).then(() => {
      if (cancelled) return

      const mounted = runtimeRef.current
      if (!mounted) return
      const documents = host.surfaces.documents
      setCanvasRuntimeSurfaces(host.surfaces)
      documents.initializeViewport()
      documents.attachRulersTo(rulerOverlayRef.current ?? canvasArea)
      mounted.detachCanvasSession = controller.attachCanvasSession(documents)
      installResizeObserver(mounted, canvasArea, documents)
    }).catch((error: unknown) => {
      releaseRuntime()
      console.error('Failed to initialize browser canvas runtime:', error)
    })

    return () => {
      cancelled = true
      releaseRuntime()
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
): void {
  const resize = () => {
    documents.resize(canvasArea.clientWidth, canvasArea.clientHeight)
  }
  resize()
  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(resize)
  observer.observe(canvasArea)
  mounted.resizeObserver = observer
}
