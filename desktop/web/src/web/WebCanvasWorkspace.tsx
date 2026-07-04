import { useSignalEffect } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  designSessionStore,
  type DesignSessionStore,
} from '../app/document-session/store'
import { locale } from '../app/settings/state'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import type { CanvasDocumentSurface, CanvasRuntimeHost } from '../canvas/runtime/runtime'
import type { CanopiFile } from '../types/design'
import { t } from '../i18n'
import { ZoomControls } from '../components/canvas/ZoomControls'
import panelStyles from '../components/panels/Panels.module.css'
import { browserDesignSessionController, type BrowserDesignSessionController } from './browser-design-session'
import { createBrowserCanvasRuntimeHost } from './browser-canvas-runtime'
import { WebCanvasToolbar } from './WebCanvasToolbar'

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
  const [runtimeReady, setRuntimeReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const canvasArea = canvasAreaRef.current
    if (!container || !canvasArea) return

    let cancelled = false
    const host = createRuntimeHost()
    runtimeRef.current = {
      host,
      detachCanvasSession: () => {},
      resizeObserver: null,
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
      syncCanvasDocument(documents, store.readCurrentDesign())
      installResizeObserver(mounted, canvasArea, documents)
      setRuntimeReady(true)
    }).catch((error: unknown) => {
      console.error('Failed to initialize browser canvas runtime:', error)
    })

    return () => {
      cancelled = true
      const mounted = runtimeRef.current
      runtimeRef.current = null
      mounted?.resizeObserver?.disconnect()
      mounted?.detachCanvasSession()
      host.destroy()
      setCanvasRuntimeSurfaces(null)
      setRuntimeReady(false)
    }
  }, [controller, createRuntimeHost, store])

  useSignalEffect(() => {
    const file = store.currentDesign.value
    if (!runtimeReady) return
    const documents = runtimeRef.current?.host.surfaces.documents
    if (!documents) return
    syncCanvasDocument(documents, file)
  })

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
                <span className={panelStyles.emptyTitle}>{t('webShell.emptyDesign')}</span>
                <span className={panelStyles.emptyHint}>{t('webShell.emptyDesignHint')}</span>
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

function syncCanvasDocument(documents: CanvasDocumentSurface, file: CanopiFile | null): void {
  if (!file) {
    documents.hideCanvasChrome()
    return
  }

  if (documents.hasLoadedDocument()) {
    documents.replaceDocument(file)
  } else {
    documents.loadDocument(file)
  }
  documents.showCanvasChrome()
  documents.zoomToFit()
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
