import type { CameraController } from '../camera'
import type {
  PlantPresentationContext,
} from '../plant-presentation'
import type {
  ScenePoint,
  SceneStore,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import {
  createObjectStampTool,
  createObjectStampToolAdapter,
} from './object-stamp-tool'
import {
  createPlantSpacingTool,
  createPlantSpacingToolAdapter,
} from './plant-spacing-tool'
import {
  createPlantStampTool,
  createPlantStampToolAdapter,
} from './plant-stamp-tool'
import type {
  SceneToolAdapter,
  SceneToolCapturedPointerContext,
  SceneToolPointerDownContext,
  SceneToolPointerEvent,
  SceneToolTransientOptions,
} from './tool-adapter'
import {
  createTextAnnotationTool,
  createTextAnnotationToolAdapter,
} from './text-annotation-tool'
import {
  createZoneDrawingTool,
  createZoneDrawingToolAdapters,
} from './zone-drawing-tool'

export interface SceneToolModulesContext {
  readonly container: HTMLElement
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  readonly getSelection: () => ReadonlySet<string>
  readonly clearSelection: () => void
  readonly sceneEdits: SceneEditCoordinator
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly switchTool: (name: string) => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly getContainerRect: () => DOMRect
}

export interface SceneToolModules {
  transitionTo(toolName: string, resetSharedInteraction: () => void): void
  shouldIgnorePointerEvent(target: EventTarget | null): boolean
  shouldIgnorePointerUpWithoutCapture(): boolean
  shouldPreserveTransientOnPan(): boolean
  shouldSuppressHover(): boolean
  shouldSuppressSharedKeyboard(event: KeyboardEvent): boolean
  pointerDown(context: SceneToolPointerDownContext): boolean
  pointerMoveWithoutCapture(context: SceneToolPointerEvent): boolean
  pointerMoveWithCapture(context: SceneToolCapturedPointerContext): boolean
  keyDown(event: KeyboardEvent): boolean
  cancelTransient(options?: SceneToolTransientOptions): void
  refreshViewportDependent(): boolean
  refreshSelectionDependent(): void
  dispose(): void
}

export function createSceneToolModules(context: SceneToolModulesContext): SceneToolModules {
  const textTool = createTextAnnotationTool({
    container: context.container,
    camera: context.camera,
    sceneEdits: context.sceneEdits,
  })
  const zoneDrawingTool = createZoneDrawingTool({
    container: context.container,
    preview: context.preview,
    camera: context.camera,
    getSceneStore: context.getSceneStore,
    getSelection: context.getSelection,
    clearSelection: context.clearSelection,
    sceneEdits: context.sceneEdits,
    render: context.render,
    applySnapping: context.applySnapping,
  })
  const zoneDrawingAdapters = createZoneDrawingToolAdapters(zoneDrawingTool)
  const plantStampTool = createPlantStampTool({
    sceneEdits: context.sceneEdits,
    applySnapping: context.applySnapping,
  })
  const objectStampTool = createObjectStampTool({
    preview: context.preview,
    camera: context.camera,
    getSceneStore: context.getSceneStore,
    getSpeciesCache: context.getSpeciesCache,
    getPlantPresentationContext: context.getPlantPresentationContext,
    sceneEdits: context.sceneEdits,
    applySnapping: context.applySnapping,
  })
  const plantSpacingTool = createPlantSpacingTool({
    container: context.container,
    camera: context.camera,
    getSceneStore: context.getSceneStore,
    getSpeciesCache: context.getSpeciesCache,
    getPlantPresentationContext: context.getPlantPresentationContext,
    getLocalizedCommonNames: context.getLocalizedCommonNames,
    sceneEdits: context.sceneEdits,
    switchTool: context.switchTool,
    applySnapping: context.applySnapping,
    getContainerRect: context.getContainerRect,
  })

  return new SceneToolModuleRegistry(new Map([
    ['plant-stamp', createPlantStampToolAdapter(plantStampTool)],
    ['text', createTextAnnotationToolAdapter(textTool)],
    ['rectangle', zoneDrawingAdapters.rectangle],
    ['ellipse', zoneDrawingAdapters.ellipse],
    ['polygon', zoneDrawingAdapters.polygon],
    ['object-stamp', createObjectStampToolAdapter(objectStampTool, {
      switchTool: context.switchTool,
    })],
    ['plant-spacing', createPlantSpacingToolAdapter(plantSpacingTool)],
  ]))
}

class SceneToolModuleRegistry implements SceneToolModules {
  private activeToolName = 'select'

  constructor(private readonly adapters: ReadonlyMap<string, SceneToolAdapter>) {}

  transitionTo(toolName: string, resetSharedInteraction: () => void): void {
    const previousToolName = this.activeToolName
    this.activeToolName = toolName
    if (previousToolName !== toolName) {
      this.adapterFor(previousToolName)?.onDeactivate?.()
    }
    resetSharedInteraction()
    this.activeAdapter()?.onActivate?.()
  }

  shouldIgnorePointerEvent(target: EventTarget | null): boolean {
    return this.activeAdapter()?.shouldIgnorePointerEvent?.(target) ?? false
  }

  shouldIgnorePointerUpWithoutCapture(): boolean {
    return this.activeAdapter()?.shouldIgnorePointerUpWithoutCapture?.() ?? false
  }

  shouldPreserveTransientOnPan(): boolean {
    return this.activeAdapter()?.shouldPreserveTransientOnPan?.() ?? false
  }

  shouldSuppressHover(): boolean {
    return this.activeAdapter()?.shouldSuppressHover?.() ?? false
  }

  shouldSuppressSharedKeyboard(event: KeyboardEvent): boolean {
    return this.activeAdapter()?.shouldSuppressSharedKeyboard?.(event) ?? false
  }

  pointerDown(context: SceneToolPointerDownContext): boolean {
    return this.activeAdapter()?.pointerDown?.(context) ?? false
  }

  pointerMoveWithoutCapture(context: SceneToolPointerEvent): boolean {
    return this.activeAdapter()?.pointerMoveWithoutCapture?.(context) ?? false
  }

  pointerMoveWithCapture(context: SceneToolCapturedPointerContext): boolean {
    return this.activeAdapter()?.pointerMoveWithCapture?.(context) ?? false
  }

  keyDown(event: KeyboardEvent): boolean {
    return this.activeAdapter()?.keyDown?.(event) ?? false
  }

  cancelTransient(options?: SceneToolTransientOptions): void {
    this.activeAdapter()?.cancelTransient?.(options)
  }

  refreshViewportDependent(): boolean {
    return this.activeAdapter()?.refreshViewportDependent?.() === true
  }

  refreshSelectionDependent(): void {
    for (const adapter of new Set(this.adapters.values())) {
      adapter.refreshSelectionDependent?.()
    }
  }

  dispose(): void {
    for (const adapter of new Set(this.adapters.values())) {
      adapter.dispose?.()
    }
  }

  private activeAdapter(): SceneToolAdapter | null {
    return this.adapterFor(this.activeToolName)
  }

  private adapterFor(toolName: string): SceneToolAdapter | null {
    return this.adapters.get(toolName) ?? null
  }
}
