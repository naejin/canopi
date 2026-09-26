import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { WorkspaceRuntimeComposition } from '../src/app/canvas-map-surface/workspace-runtime-composition'
import { CanvasChrome } from '../src/components/canvas/CanvasChrome'
import { workspaceCanvasCommandProjection } from '../src/app/workspace-commands/canvas-actions'
import panelStyles from '../src/components/panels/Panels.module.css'
import { CanvasRuntimeCleanupError } from '../src/canvas/runtime/cleanup'
import { acquireCanvasRuntimeLifecycle } from '../src/canvas/runtime/lifecycle-owner'
import { getCurrentCanvasSession, setCurrentCanvasSession } from '../src/canvas/session'
import type { CanopiFile } from '../src/types/design'
import {
  createGalleryWorkspaceRuntimeComposition,
  type GalleryWorkspaceRuntimeOptions,
} from './gallery-workspace-runtime'
import { activity } from './memory-backend'
import { specimens } from './fixtures'
import styles from './gallery.module.css'

interface GallerySurfaceSignal {
  readonly value: string
}

interface GalleryCanvasSurfaceProps {
  readonly activeSurface: GallerySurfaceSignal
  readonly design: CanopiFile
  readonly dense: boolean
  readonly cameraState?: 'site' | 'overview' | 'maximum'
  readonly onReadyChange: (ready: boolean) => void
  readonly createRuntimeComposition?: (options: GalleryWorkspaceRuntimeOptions) => WorkspaceRuntimeComposition
}

export function GalleryCanvasSurface({
  activeSurface,
  design,
  dense,
  cameraState = 'site',
  onReadyChange,
  createRuntimeComposition = createGalleryWorkspaceRuntimeComposition,
}: GalleryCanvasSurfaceProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const ready = useSignal(false)

  useEffect(() => {
    const container = canvas.current
    if (!container) return

    let cancelled = false
    let runtime: WorkspaceRuntimeComposition | null = null
    let resize: ResizeObserver | null = null
    let released = false
    let releaseLease: (() => Promise<void>) | null = null
    let runtimeCreationSettlement: Promise<void> | null = null

    const releaseRuntime = async () => {
      if (released) return
      const pendingCreation = runtimeCreationSettlement
      if (pendingCreation) await pendingCreation
      if (released) return
      released = true
      const activeRuntime = runtime
      const errors: unknown[] = []
      try {
        resize?.disconnect()
      } catch (error) {
        errors.push(error)
      }
      try {
        await activeRuntime?.dispose()
      } catch (error) {
        errors.push(error)
      }
      try {
        if (activeRuntime && getCurrentCanvasSession() === activeRuntime.surfaces) {
          setCurrentCanvasSession(null)
        }
      } catch (error) {
        errors.push(error)
      }
      try {
        ready.value = false
        onReadyChange(false)
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) {
        console.error(
          'Unable to release gallery canvas:',
          errors.length === 1
            ? errors[0]
            : new CanvasRuntimeCleanupError('Gallery Canvas runtime cleanup failed', errors),
        )
      }
    }
    const release = () => {
      const releaseCurrentLease = releaseLease
      if (!releaseCurrentLease) return
      void releaseCurrentLease().catch((error: unknown) => {
        console.error('Unable to release gallery canvas:', error)
      })
    }

    onReadyChange(false)
    void (async () => {
      const lease = await acquireCanvasRuntimeLifecycle(releaseRuntime)
      releaseLease = lease.release
      if (cancelled) {
        release()
        return
      }

      let finishRuntimeCreation!: () => void
      runtimeCreationSettlement = new Promise<void>((resolve) => {
        finishRuntimeCreation = resolve
      })
      try {
        runtime = createRuntimeComposition({
          container,
          design,
          onMapStateChange: (state) => {
            if (state.status === 'error') activity.value = `Map unavailable: ${state.errorMessage ?? 'unknown error'}`
          },
          onFailure: (error) => console.error('Gallery workspace failed:', error),
        })
      } finally {
        finishRuntimeCreation()
        runtimeCreationSettlement = null
      }
      const activeRuntime = runtime
      const activeResize = new ResizeObserver(() => {
        activeRuntime.surfaces.documents.resize(container.clientWidth, container.clientHeight)
      })
      resize = activeResize
      const runtimeIsActive = () => !cancelled && !released && runtime === activeRuntime
      if (!runtimeIsActive()) {
        release()
        return
      }

      const outcome = await activeRuntime.start()
      if (outcome === 'cancelled' || outcome === 'no-design') {
        throw new Error(`Gallery workspace did not start (${outcome}).`)
      }
      if (!runtimeIsActive()) return
      activeRuntime.surfaces.documents.loadDocument(design)
      if (!runtimeIsActive()) return
      activeRuntime.surfaces.documents.resize(container.clientWidth, container.clientHeight)
      if (!runtimeIsActive()) return
      activeRuntime.surfaces.documents.zoomToFit()
      if (dense) {
        for (let i = 0; i < 6; i++) {
          if (!runtimeIsActive()) return
          activeRuntime.surfaces.commands.viewport.zoomOut()
        }
      }
      if (cameraState === 'overview') {
        for (let i = 0; i < 100; i++) activeRuntime.surfaces.commands.viewport.zoomOut()
      } else if (cameraState === 'maximum') {
        for (let i = 0; i < 100; i++) activeRuntime.surfaces.commands.viewport.zoomIn()
      }
      if (!runtimeIsActive()) return
      activeRuntime.surfaces.commands.sceneEdits.selectSameSpecies(specimens[0][0])
      if (!runtimeIsActive()) return
      activeResize.observe(container)
      if (!runtimeIsActive()) return
      setCurrentCanvasSession(activeRuntime.surfaces)
      if (!runtimeIsActive() || getCurrentCanvasSession() !== activeRuntime.surfaces) {
        release()
        return
      }
      ready.value = true
      onReadyChange(true)
    })().catch(error => {
      release()
      if (cancelled) return
      activity.value = 'Canvas could not start. See the browser console.'
      console.error('Unable to start gallery canvas:', error)
    })

    return () => {
      cancelled = true
      release()
    }
  }, [cameraState, createRuntimeComposition, dense, design, onReadyChange])

  useEffect(() => {
    if (!ready.value || activeSurface.value !== 'lens') return
    canvas.current?.parentElement?.querySelector<HTMLButtonElement>('button[data-inspection-launcher][aria-expanded="false"]')?.click()
  }, [activeSurface.value, ready.value])

  return (
    <div className={styles.canvasWorkspace}>
      <div className={`${panelStyles.canvasArea} ${styles.canvasArea}`}>
        <div ref={canvas} className={styles.canvas} />
        {ready.value ? (
          <CanvasChrome
            key={activeSurface.value === 'lens' ? 'lens' : 'other'}
            projection={workspaceCanvasCommandProjection.value}
            canvasRef={canvas}
          />
        ) : null}
      </div>
    </div>
  )
}
