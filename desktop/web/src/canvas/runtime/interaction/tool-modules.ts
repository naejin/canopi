import type { WorkspaceCameraFrameReader } from '../camera'
import type {
  SceneDesignObjectSelection,
  ScenePoint,
  SceneStateReader,
} from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import type {
  SceneToolAdapter,
} from './tool-adapter'

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

export function createSceneToolRegistry(_context: SceneToolRegistryContext): SceneToolRegistry {
  return new DefaultSceneToolRegistry(new Map<string, SceneToolAdapter>())
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
