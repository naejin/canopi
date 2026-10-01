import type { WorkspaceCameraFrameReader } from '../camera'
import type {
  PlantPresentationContext,
} from '../plant-presentation'
import type {
  SceneDesignObjectSelection,
  ScenePoint,
  SceneStateReader,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createMeasurementGuideTool,
  createMeasurementGuideToolAdapter,
} from './measurement-guide-tool'
import type {
  SceneToolAdapter,
} from './tool-adapter'
import type { CanvasRuntimeTranslator } from '../app-adapter'
import {
  createTextAnnotationTool,
  createTextAnnotationToolAdapter,
} from './text-annotation-tool'
import {
  createZoneDrawingTool,
  createZoneDrawingToolAdapters,
} from './zone-drawing-tool'

export interface SceneToolRegistryContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  readonly translate: CanvasRuntimeTranslator
  readonly getSelection: () => SceneDesignObjectSelection
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly switchTool: (name: string) => void
  /** Focus the map host, as after a gesture ends from a field it opened. */
  readonly focusHost: () => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly notifyTransientHistoryChange: () => void
  /** A tool's guidance changed outside a map event (a note field closed). */
  readonly notifyGuidanceChange: () => void
}

export interface SceneToolRegistry {
  readonly activeAdapter: SceneToolAdapter | null
  select(toolName: string): SceneToolAdapter | null
  forEachAdapter(visit: (adapter: SceneToolAdapter) => void): void
}

export function createSceneToolRegistry(context: SceneToolRegistryContext): SceneToolRegistry {
  const rollback: Array<() => void> = []
  const own = <T>(resource: T, dispose: (resource: T) => void): T => {
    rollback.push(() => dispose(resource))
    return resource
  }

  try {
    const textTool = own(createTextAnnotationTool({
      container: context.container,
      focusHost: context.focusHost,
      notifyGuidanceChange: context.notifyGuidanceChange,
      translate: context.translate,
      camera: context.camera,
      getSceneStore: context.getSceneStore,
      sceneEdits: context.sceneEdits,
    }), (tool) => tool.dispose())
    const zoneDrawingTool = own(createZoneDrawingTool({
      container: context.container,
      preview: context.preview,
      camera: context.camera,
      getSceneStore: context.getSceneStore,
      getSelection: context.getSelection,
      clearSelection: context.clearSelection,
      sceneEdits: context.sceneEdits,
      render: context.render,
      applySnapping: context.applySnapping,
      notifyTransientHistoryChange: context.notifyTransientHistoryChange,
    }), (tool) => tool.dispose())
    const zoneDrawingAdapters = createZoneDrawingToolAdapters(zoneDrawingTool)
    const measurementGuideTool = own(createMeasurementGuideTool({
      container: context.container,
      preview: context.preview,
      camera: context.camera,
      getSceneStore: context.getSceneStore,
      sceneEdits: context.sceneEdits,
      applySnapping: context.applySnapping,
    }), (tool) => tool.dispose())

    const registry = new DefaultSceneToolRegistry(new Map([
      ['text', createTextAnnotationToolAdapter(textTool)],
      ['line', zoneDrawingAdapters.line],
      ['measurement-guide', createMeasurementGuideToolAdapter(measurementGuideTool)],
      ['rectangle', zoneDrawingAdapters.rectangle],
      ['ellipse', zoneDrawingAdapters.ellipse],
      ['polygon', zoneDrawingAdapters.polygon],
    ]))
    rollback.length = 0
    return registry
  } catch (error) {
    for (const cleanup of rollback.reverse()) {
      try {
        cleanup()
      } catch {
        // Preserve the construction failure after best-effort tool cleanup.
      }
    }
    throw error
  }
}

class DefaultSceneToolRegistry implements SceneToolRegistry {
  private _activeToolName = 'select'

  constructor(private readonly adapters: ReadonlyMap<string, SceneToolAdapter>) {}

  get activeAdapter(): SceneToolAdapter | null {
    return this.adapterFor(this._activeToolName)
  }

  select(toolName: string): SceneToolAdapter | null {
    this._activeToolName = toolName
    return this.activeAdapter
  }

  forEachAdapter(visit: (adapter: SceneToolAdapter) => void): void {
    for (const adapter of new Set(this.adapters.values())) visit(adapter)
  }

  private adapterFor(toolName: string): SceneToolAdapter | null {
    return this.adapters.get(toolName) ?? null
  }
}
