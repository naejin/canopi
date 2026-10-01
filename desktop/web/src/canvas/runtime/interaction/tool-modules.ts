import type { WorkspaceCameraFrameReader } from '../camera'
import type {
  SceneDesignObjectSelection,
  ScenePoint,
  SceneStateReader,
} from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createMeasurementGuideTool,
  createMeasurementGuideToolAdapter,
} from './measurement-guide-tool'
import type {
  SceneToolAdapter,
} from './tool-adapter'
import {
  createZoneDrawingTool,
  createZoneDrawingToolAdapters,
} from './zone-drawing-tool'

export interface SceneToolRegistryContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getSelection: () => SceneDesignObjectSelection
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly notifyTransientHistoryChange: () => void
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
