import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { createAppCanvasRuntimeAppAdapter } from '../src/app/canvas-runtime/app-adapter'
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import { InspectionLens } from '../src/components/canvas/InspectionLens'
import { CanvasOverview } from '../src/components/canvas/CanvasOverview'
import { SpeciesFocusChip } from '../src/components/canvas/SpeciesFocusChip'
import { ZoomControls } from '../src/components/canvas/ZoomControls'
import { createSceneCanvasRuntimeHost } from '../src/canvas/runtime/host'
import { CanvasRuntimeCleanupError } from '../src/canvas/runtime/cleanup'
import { acquireCanvasRuntimeLifecycle } from '../src/canvas/runtime/lifecycle-owner'
import type { CanvasRuntimeHost } from '../src/canvas/runtime/runtime'
import { SceneCanvasRuntime } from '../src/canvas/runtime/scene-runtime'
import { getCurrentCanvasSession, setCurrentCanvasSession } from '../src/canvas/session'
import type { CanopiFile } from '../src/types/design'
import { WebCanvasToolbar } from '../src/web/WebCanvasToolbar'
import { activity } from './memory-backend'
import { specimens, species } from './fixtures'
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
  readonly createRuntimeHost?: (design: CanopiFile) => CanvasRuntimeHost
}

export function GalleryCanvasSurface({
  activeSurface,
  design,
  dense,
  cameraState = 'site',
  onReadyChange,
  createRuntimeHost = createGalleryRuntimeHost,
}: GalleryCanvasSurfaceProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const ready = useSignal(false)

  useEffect(() => {
    const container = canvas.current
    if (!container) return

    let cancelled = false
    let runtime: CanvasRuntimeHost | null = null
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
        await activeRuntime?.destroy()
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
        runtime = createRuntimeHost(design)
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

      await activeRuntime.init(container)
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
  }, [cameraState, createRuntimeHost, dense, design, onReadyChange])

  useEffect(() => {
    if (!ready.value || activeSurface.value !== 'lens') return
    canvas.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
  }, [activeSurface.value, ready.value])

  return (
    <div className={styles.canvasWorkspace}>
      {ready.value && <WebCanvasToolbar />}
      <div className={styles.canvasArea}>
        <div ref={canvas} className={styles.canvas} />
        {ready.value ? (
          <>
            <InspectionLens key={activeSurface.value === 'lens' ? 'lens' : 'other'} canvasRef={canvas} />
            <SpeciesFocusChip />
            <CanvasOverview />
            <div className={styles.canvasZoom}><ZoomControls /></div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function createGalleryRuntimeHost(design: CanopiFile): CanvasRuntimeHost {
  const names = new Map(design.plants.map(plant => [plant.canonical_name, plant.common_name]))
  return createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
    appAdapter: createAppCanvasRuntimeAppAdapter({
      presentationData: {
        plantLabels: { getLocaleSnapshot: () => names, ensureEntries: async () => false },
        speciesCache: {
          getCache: () => new Map(species.map(plant => [plant.canonical_name, { ...plant }])),
          ensureEntries: async () => false,
          getSuggestedPlantColor: () => '#E9D28B',
        },
      },
      savedObjectStamps: {
        saveCurrentSelection: capture => savedObjectStampWorkbench.saveSelection(capture),
      },
    }),
  }))
}
