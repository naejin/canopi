import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { createAppCanvasRuntimeAppAdapter } from '../src/app/canvas-runtime/app-adapter'
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import { InspectionLens } from '../src/components/canvas/InspectionLens'
import { SpeciesFocusChip } from '../src/components/canvas/SpeciesFocusChip'
import { ZoomControls } from '../src/components/canvas/ZoomControls'
import { createSceneCanvasRuntimeHost } from '../src/canvas/runtime/host'
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
  readonly onReadyChange: (ready: boolean) => void
  readonly createRuntimeHost?: (design: CanopiFile) => CanvasRuntimeHost
}

export function GalleryCanvasSurface({
  activeSurface,
  design,
  dense,
  onReadyChange,
  createRuntimeHost = createGalleryRuntimeHost,
}: GalleryCanvasSurfaceProps) {
  const canvas = useRef<HTMLDivElement>(null)
  const ready = useSignal(false)

  useEffect(() => {
    const container = canvas.current
    if (!container) return

    let cancelled = false
    let released = false
    const runtime = createRuntimeHost(design)
    const resize = new ResizeObserver(() => {
      runtime.surfaces.documents.resize(container.clientWidth, container.clientHeight)
    })

    const release = () => {
      if (released) return
      released = true
      resize.disconnect()
      try {
        runtime.destroy()
      } finally {
        if (getCurrentCanvasSession() === runtime.surfaces) {
          setCurrentCanvasSession(null)
        }
        ready.value = false
        onReadyChange(false)
      }
    }

    onReadyChange(false)
    void runtime.init(container).then(() => {
      if (cancelled) return
      runtime.surfaces.documents.loadDocument(design)
      runtime.surfaces.documents.resize(container.clientWidth, container.clientHeight)
      runtime.surfaces.documents.zoomToFit()
      if (dense) {
        for (let i = 0; i < 6; i++) runtime.surfaces.commands.viewport.zoomOut()
      }
      runtime.surfaces.commands.sceneEdits.selectSameSpecies(specimens[0][0])
      resize.observe(container)
      setCurrentCanvasSession(runtime.surfaces)
      ready.value = true
      onReadyChange(true)
    }).catch(error => {
      try {
        release()
      } catch (releaseError) {
        console.error('Unable to release failed gallery canvas:', releaseError)
      }
      if (cancelled) return
      activity.value = 'Canvas could not start. See the browser console.'
      console.error('Unable to start gallery canvas:', error)
    })

    return () => {
      cancelled = true
      release()
    }
  }, [createRuntimeHost, dense, design, onReadyChange])

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
            <ZoomControls />
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
