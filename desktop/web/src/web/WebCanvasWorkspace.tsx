import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import { useEffect, useRef } from 'preact/hooks'
import {
  designSessionStore,
  type DesignSessionStore,
} from '../app/document-session/store'
import { getCurrentCanvasSession, setCanvasRuntimeSurfaces } from '../canvas/session'
import { CanvasRuntimeCleanupError } from '../canvas/runtime/cleanup'
import type { CanvasDocumentSurface, CanvasRuntimeHost } from '../canvas/runtime/runtime'
import { acquireCanvasRuntimeLifecycle } from '../canvas/runtime/lifecycle-owner'
import { ZoomControls } from '../components/canvas/ZoomControls'
import { InspectionLens } from '../components/canvas/InspectionLens'
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
    let releaseLease: (() => Promise<void>) | null = null
    let host: CanvasRuntimeHost | null = null
    let released = false
    let hostCreationSettlement: Promise<void> | null = null
    let attachmentSettlement: Promise<void> | null = null

    const releaseRuntime = async () => {
      if (released) return
      const pendingCreation = hostCreationSettlement
      if (pendingCreation) await pendingCreation
      if (released) return
      const activeHost = host
      if (!activeHost) {
        released = true
        return
      }

      // A reentrant unmount can happen while browser attachment is still
      // returning its disposer. Keep the lease, then hand off with that exact
      // disposer before destroying the host.
      const pendingAttachment = attachmentSettlement
      if (pendingAttachment) await pendingAttachment
      if (released) return
      const mounted = runtimeRef.current?.host === activeHost ? runtimeRef.current : null

      // Handoff is the loss-prevention boundary. Do it before the first await
      // so a failed capture retains this owner for a later retry.
      mounted?.detachCanvasSession()
      released = true

      const errors: unknown[] = []
      try {
        const observer = mounted?.resizeObserver
        if (mounted) mounted.resizeObserver = null
        observer?.disconnect()
      } catch (error) {
        errors.push(error)
      }
      try {
        await activeHost.destroy()
      } catch (error) {
        errors.push(error)
      }
      if (mounted) runtimeRef.current = null
      try {
        if (getCurrentCanvasSession() === activeHost.surfaces) {
          setCanvasRuntimeSurfaces(null)
        }
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) {
        console.error(
          'Failed to release browser canvas runtime:',
          errors.length === 1
            ? errors[0]
            : new CanvasRuntimeCleanupError('Browser Canvas runtime cleanup failed', errors),
        )
      }
    }
    const release = () => {
      const releaseCurrentLease = releaseLease
      if (!releaseCurrentLease) return
      void releaseCurrentLease().catch((error: unknown) => {
        console.error('Failed to release browser canvas runtime:', error)
      })
    }

    void (async () => {
      const lease = await acquireCanvasRuntimeLifecycle(releaseRuntime)
      releaseLease = lease.release
      if (cancelled) {
        release()
        return
      }

      let finishHostCreation!: () => void
      hostCreationSettlement = new Promise<void>((resolve) => {
        finishHostCreation = resolve
      })
      try {
        host = createRuntimeHost()
      } finally {
        finishHostCreation()
        hostCreationSettlement = null
      }
      const activeHost = host
      runtimeRef.current = {
        host: activeHost,
        detachCanvasSession: () => {},
        resizeObserver: null,
      }
      if (cancelled) {
        release()
        return
      }

      await activeHost.init(container)
      if (cancelled || released || runtimeRef.current?.host !== activeHost) {
        release()
        return
      }

      const mounted = runtimeRef.current
      const runtimeIsActive = () => !cancelled
        && !released
        && runtimeRef.current?.host === activeHost
      const documents = activeHost.surfaces.documents
      documents.initializeViewport()
      if (!runtimeIsActive()) {
        release()
        return
      }
      documents.attachRulersTo(rulerOverlayRef.current ?? canvasArea)
      if (!runtimeIsActive()) {
        release()
        return
      }

      let finishAttachment!: () => void
      attachmentSettlement = new Promise<void>((resolve) => {
        finishAttachment = resolve
      })
      try {
        mounted.detachCanvasSession = controller.attachCanvasSession(documents)
      } finally {
        finishAttachment()
        attachmentSettlement = null
      }
      if (!runtimeIsActive()) {
        release()
        return
      }

      installResizeObserver(mounted, canvasArea, documents, runtimeIsActive)
      if (!runtimeIsActive()) {
        release()
        return
      }
      setCanvasRuntimeSurfaces(activeHost.surfaces)
      if (!runtimeIsActive()) release()
    })().catch((error: unknown) => {
      release()
      if (!cancelled) {
        console.error('Failed to initialize browser canvas runtime:', error)
      }
    })

    return () => {
      cancelled = true
      release()
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
            {hasDesign && <InspectionLens canvasRef={containerRef} />}
          {hasDesign && <SpeciesFocusChip />}
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
