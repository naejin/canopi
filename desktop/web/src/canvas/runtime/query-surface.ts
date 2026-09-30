import { buildCanvasPrintSnapshot } from './print-snapshot'
import { getCanvasPlantNameLabels } from './automatic-detail'
import { worldToScreen } from './annotation-layout'
import { getSceneLayerStyle } from './scene-visuals'
import { isWorkspaceOverviewScale } from '../workspace-camera-policy'
import type { PlacedPlant } from '../../types/design'
import type { SelectedPlantColorContext } from '../plant-color-context'
import type { SelectedPlantSymbolContext } from '../plant-symbol-context'
import type { WorkspaceCameraFrameReader, WorkspaceCameraOwner } from './camera'
import type {
  CanvasDesignObjects,
  CanvasDesignObjectSelectionModel,
  CanvasPlantLabelCoverage,
  CanvasQueryRevision,
  CanvasQuerySurface,
  CanvasViewSceneRequest,
} from './runtime'
import type {
  SceneDocumentReader,
  SceneDesignObjectTarget,
  ScenePersistedState,
  SceneStateReader,
} from './scene'
import type { SceneRuntimeMutationController } from './scene-runtime/mutations'
import type { SceneRuntimePresentationController } from './scene-runtime/presentation'
import { getDesignObjectSelectionModel } from './scene-runtime/selection'
import type { SettledSceneReader } from './scene-runtime/transactions'
import { createViewReadSurface } from './view/frame-source'
import type { ViewReadSurface } from './view/read-surface'
import type { WorldPoint } from './view/types'

type PointerWorldListener = (point: WorldPoint | null) => void
/** The interaction session's ToolHost.subscribePointerWorld. */
export type PointerWorldSource = (listener: PointerWorldListener) => () => void

interface SceneCanvasQuerySurfaceOptions {
  readonly revision: CanvasQueryRevision
  readonly sceneStore: SceneStateReader & SceneDocumentReader
  /** The legacy camera shim; its driver host is unwrapped for `view` and the frame's scale (0A to the end of 0D2). */
  readonly camera: Pick<WorkspaceCameraFrameReader, 'snapshot'> & Pick<WorkspaceCameraOwner, 'host'>
  /** The live frame's px/m, which sizes screen-sized notes in the selection model (INV-XF-27). Default: the host's frame. */
  readonly readViewScale?: () => number
  readonly settledReader: SettledSceneReader
  readonly mutations: Pick<
    SceneRuntimeMutationController,
    'getSelectedPlantColorContext' | 'getSelectedPlantSymbolContext'
  >
  readonly presentation: Pick<
    SceneRuntimePresentationController,
    | 'createPlantPresentationContext'
    | 'getLocalizedCommonNames'
    | 'getEnglishFallbackNames'
    | 'buildViewCaptureSnapshot'
    | 'buildRendererSnapshot'
  >
}

export function createSceneCanvasQuerySurface(
  options: SceneCanvasQuerySurfaceOptions,
): CanvasQuerySurface {
  return new SceneCanvasQueryRole(options)
}

/**
 * The query surface outlives interaction sessions (the map can unmount and mount again): subscribePointerWorld listeners
 * stay with the surface, and scene-runtime.ts binds the live session's ToolHost here (null when it ends).
 */
export function bindQuerySurfacePointerWorld(surface: CanvasQuerySurface, source: PointerWorldSource | null): void {
  if (surface instanceof SceneCanvasQueryRole) surface.bindPointerWorld(source)
}

class SceneCanvasQueryRole implements CanvasQuerySurface {
  readonly view: ViewReadSurface
  private readonly pointerWorldListeners = new Set<PointerWorldListener>()
  private stopPointerWorld: (() => void) | null = null
  private readonly readViewScale: () => number

  constructor(private readonly options: SceneCanvasQuerySurfaceOptions) {
    const { frames } = options.camera.host
    // The frames place the Scene's metres; their ground is read on the Scene's plane.
    this.view = createViewReadSurface(frames, () => options.sceneStore.sessionPlane)
    this.readViewScale = options.readViewScale ?? (() => frames.viewFrame.peek().view.pixelsPerMetre)
  }

  subscribePointerWorld(listener: PointerWorldListener): () => void {
    this.pointerWorldListeners.add(listener)
    return () => {
      this.pointerWorldListeners.delete(listener)
    }
  }

  bindPointerWorld(source: PointerWorldSource | null): void {
    this.stopPointerWorld?.()
    this.stopPointerWorld = source?.((point) => {
      for (const listener of [...this.pointerWorldListeners]) listener(point)
    }) ?? null
  }

  get revision(): CanvasQueryRevision { return this.options.revision }
  get viewport(): WorkspaceCameraFrameReader['snapshot'] { return this.options.camera.snapshot }
  get sessionPlane() { return this.options.sceneStore.sessionPlaneSignal }
  capturePrintSnapshot() {
    void this.options.settledReader.revision.value
    return this.options.settledReader.readWhenSettled(() => {
      const scene = this.options.sceneStore.persisted
      return buildCanvasPrintSnapshot(
        scene,
        this.options.presentation.createPlantPresentationContext(1, scene.plants),
      )
    }, null)
  }
  captureViewScene(request: CanvasViewSceneRequest) {
    void this.options.settledReader.revision.value
    const overview = isWorkspaceOverviewScale(request.viewport.scale, this.options.camera.snapshot.peek())
    return this.options.settledReader.readWhenSettled(
      () => this.options.presentation.buildViewCaptureSnapshot({ ...request, overview }),
      null,
    )
  }
  getScenePhysicalExtentMeters(): number | null { return this.options.sceneStore.physicalExtentMeters }
  getSceneSnapshot(): ScenePersistedState { return this.options.sceneStore.persisted }
  getSpeciesFocus() { return this.options.sceneStore.session.speciesFocus }
  getPlantLabelCoverage(): CanvasPlantLabelCoverage {
    const frame = this.options.camera.snapshot.peek()
    const { width, height } = frame.screenSize
    if (frame.mode === 'overview' || width <= 0 || height <= 0) return { labelled: 0, inView: 0 }
    const snapshot = this.options.presentation.buildRendererSnapshot()
    if (!getSceneLayerStyle(snapshot.scene, 'plants').visible) return { labelled: 0, inView: 0 }
    const inView = new Set<string>()
    for (const plant of snapshot.scene.plants) {
      const point = worldToScreen(plant.position, snapshot.viewport)
      if (point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height) inView.add(plant.id)
    }
    const labelled = new Set(getCanvasPlantNameLabels(snapshot)
      .filter((label) => inView.has(label.plantId))
      .map((label) => label.plantId))
    return { labelled: labelled.size, inView: inView.size }
  }
  getSelection(): SceneDesignObjectTarget[] {
    return this.options.sceneStore.session.selectedTargets.map((target) => ({ ...target }))
  }
  getDesignObjectSelection(): CanvasDesignObjectSelectionModel {
    const selectedTargets = this.options.sceneStore.session.selectedTargets
    if (selectedTargets.length === 0) {
      return {
        editableTargets: [], lockedTargets: [], blockedTargets: [], bounds: null,
        sameSpeciesReferenceCanonicalName: null,
        plantNamePinning: { plantIds: [], allPinned: false },
      }
    }
    const viewportScale = this.readViewScale()
    const scene = this.options.sceneStore.persisted
    return getDesignObjectSelectionModel(
      scene,
      selectedTargets,
      {
        annotationViewportScale: viewportScale,
        plantContext: this.options.presentation.createPlantPresentationContext(viewportScale, scene.plants),
      },
    )
  }
  getSelectedPlantColorContext(): SelectedPlantColorContext {
    return this.options.mutations.getSelectedPlantColorContext()
  }
  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext {
    return this.options.mutations.getSelectedPlantSymbolContext()
  }
  getPlacedPlants(): PlacedPlant[] { return this.options.sceneStore.toCanopiFile().plants }
  getSettledPlacedPlants(): PlacedPlant[] | null {
    void this.options.settledReader.revision.value
    return this.options.settledReader.readWhenSettled(
      () => this.options.sceneStore.toCanopiFile().plants,
      null,
    )
  }
  getSettledDesignObjects(): CanvasDesignObjects | null {
    return this.options.settledReader.readWhenSettled(() => {
      const file = this.options.sceneStore.toCanopiFile()
      return {
        plants: file.plants,
        zones: file.zones,
        annotations: file.annotations,
        measurementGuides: file.measurement_guides ?? [],
        groups: file.groups,
      }
    }, null)
  }
  getLocalizedCommonNames(): ReadonlyMap<string, string | null> {
    return this.options.presentation.getLocalizedCommonNames()
  }
  getEnglishFallbackNames(): ReadonlyMap<string, string> {
    return this.options.presentation.getEnglishFallbackNames()
  }
}
