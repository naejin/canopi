import {
  formatPlantSpacingGuideLength,
  formatPlantSpacingIntervalInput,
  parsePlantSpacingIntervalInput,
} from '../../plant-spacing-interval'
import {
  computePlantSpacingCount,
  computePlantSpacingPositions,
  createPlantSpacingGeneratedPlants,
} from '../../plant-spacing-sequence'
import { createUuid } from '../../../utils/ids'
import type { WorkspaceCameraFrameReader } from '../camera'
import {
  getPlantWorldBounds,
  resolvePlantDisplayColor,
  type PlantPresentationContext,
} from '../plant-presentation'
import type { ScenePlantEntity, ScenePoint, SceneStateReader } from '../scene'
import {
  isSceneDesignObjectLocked,
  isSceneObjectGroupMemberTarget,
  resolvePlantSymbolForPlant,
  type PlantSymbolId,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { hitTestTopLevel } from './hit-testing'
import {
  createPlantSpacingOverlay,
  type PlantSpacingOverlayController,
} from './plant-spacing-overlay'
import { constrainPointTo45Degrees, isEditableTarget } from './pointer-utils'
import type { SceneToolAdapter } from './tool-adapter'
import type { CanvasPlantRowGuidance } from '../../session-state'
import type { CanvasPlantRowSpacingField } from '../runtime'

const PLANT_SPACING_DENSE_WARNING_THRESHOLD = 100
const PLANT_SPACING_PREVIEW_POSITION_LIMIT = 250
const PLANT_SPACING_COMMIT_POSITION_LIMIT = 5_000
const PLANT_SPACING_DRAG_START_PX = 4

interface PlantSpacingSource {
  sourceId: string
  plant: ScenePlantEntity
  label: string
  /** The picked plant's symbol and colour, read once when it is picked. */
  glyph: { symbol: PlantSymbolId; color: string }
}

interface PlantSpacingPointerDownResult {
  readonly clearPointerGesture: boolean
}

export interface PlantSpacingToolContext {
  readonly container: HTMLElement
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  readonly readPlantSpacingIntervalMeters: () => number
  readonly commitPlantSpacingIntervalMeters: (meters: number) => void
  readonly sceneEdits: SceneEditCoordinator
  readonly switchTool: (name: string) => void
  readonly focusHost: () => void
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly getContainerRect: () => DOMRect
}

export interface PlantSpacingTool {
  readonly hasSource: () => boolean
  /** What the tool card shows: the step, the picked plant, the spacing field and the row's count. */
  readonly describe: () => CanvasPlantRowGuidance
  /** The tool card's spacing field. */
  readonly spacingField: CanvasPlantRowSpacingField
  readonly isToolCardTarget: (target: EventTarget | null) => boolean
  readonly showState: () => void
  readonly clear: () => void
  readonly cancel: () => void
  readonly pointerDown: (
    event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>,
    world: ScenePoint,
  ) => PlantSpacingPointerDownResult
  readonly updatePreviewFromEvent: (event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>) => void
  readonly shouldBeginDrag: (screen: ScenePoint, startScreen: ScenePoint) => boolean
  readonly beginDrag: () => void
  readonly commitDragFromEvent: (event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>) => void
  readonly refreshViewportDependent: () => void
  readonly dispose: () => void
}

export function createPlantSpacingTool(context: PlantSpacingToolContext): PlantSpacingTool {
  let source: PlantSpacingSource | null = null
  let intervalText = formatPlantSpacingIntervalInput(context.readPlantSpacingIntervalMeters())
  let intervalValid = true
  let endpoint: ScenePoint | null = null
  let previewPointer: { screen: ScenePoint; shiftKey: boolean } | null = null
  let generatedPositions: ScenePoint[] = []
  let generatedCount = 0
  let missed = false
  let shownCount: { readonly count: number; readonly density: CanvasPlantRowGuidance['density'] } | null = null
  let focusRequest = 0

  const overlay: PlantSpacingOverlayController = createPlantSpacingOverlay(context.container)

  const spacingField: CanvasPlantRowSpacingField = {
    input: (value) => handleIntervalInput(value),
    commit: (value) => commitIntervalInput(value),
    blur: (value) => commitIntervalInput(value, { focusCanvasOnValid: false, focusInputOnInvalid: false }),
    cancel: () => {
      cancel()
      context.focusHost()
    },
  }

  function describe(): CanvasPlantRowGuidance {
    return {
      phase: source ? 'row' : missed ? 'missed' : 'pick',
      plantName: source?.label ?? null,
      glyph: source?.glyph ?? null,
      interval: intervalText,
      intervalValid,
      count: source ? shownCount?.count ?? null : null,
      density: source ? shownCount?.density ?? 'normal' : 'normal',
      focusRequest,
    }
  }

  function showSourcePicking(reason: 'select-source' | 'source-missed' = 'select-source'): void {
    missed = reason === 'source-missed'
    shownCount = null
    overlay.hide()
  }

  function setGeneratedCount(count: number, options: { dense?: boolean; blocked?: boolean }): void {
    shownCount = { count, density: options.blocked ? 'blocked' : options.dense ? 'dense' : 'normal' }
  }

  function focusIntervalInput(): void {
    focusRequest += 1
  }

  function pointerDown(
    event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>,
    world: ScenePoint,
  ): PlantSpacingPointerDownResult {
    if (source) {
      commitPreview(endpointFromEvent(event))
      return { clearPointerGesture: false }
    }

    const scene = context.getSceneStore().persisted
    const hit = hitTestTopLevel(
      scene,
      world,
      context.camera.viewport.scale,
      context.getSpeciesCache(),
      context.getPlantPresentationContext,
      context.getSceneStore().session.selectedTargets,
      context.getSceneStore().session.hoveredTarget,
    )

    if (!hit || hit.kind !== 'plant' || isSceneDesignObjectLocked(scene, hit)) {
      showSourcePicking('source-missed')
      return { clearPointerGesture: true }
    }

    const plant = scene.plants.find((entry) => entry.id === hit.id)
    if (!plant) {
      showSourcePicking('source-missed')
      return { clearPointerGesture: true }
    }

    source = {
      sourceId: plant.id,
      plant: clonePlantForPlantSpacing(plant),
      label: labelForPlant(plant),
      glyph: sourceGlyph(plant),
    }
    intervalText = formatPlantSpacingIntervalInput(context.readPlantSpacingIntervalMeters())
    intervalValid = true
    missed = false
    shownCount = null
    showState()
    focusIntervalInput()
    return { clearPointerGesture: false }
  }

  function cancel(): void {
    if (source) {
      clear()
      return
    }
    context.switchTool('select')
  }

  function clear(): void {
    source = null
    endpoint = null
    previewPointer = null
    generatedPositions = []
    generatedCount = 0
    showSourcePicking()
  }

  function showState(): void {
    if (!source) {
      showSourcePicking()
      return
    }
    overlay.showSource(sourceView(source), context.camera)
  }

  function updatePreviewFromEvent(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>): void {
    const screen = clampedScreenPoint(event)
    previewPointer = { screen, shiftKey: event.shiftKey }
    updatePreview(endpointFromScreen(screen, event.shiftKey))
  }

  function updatePreview(nextEndpoint: ScenePoint): void {
    if (!source) return

    endpoint = nextEndpoint
    const parsed = parsePlantSpacingIntervalInput(intervalText)
    intervalValid = parsed.valid
    generatedCount = parsed.valid
      ? computePlantSpacingCount(source.plant.position, nextEndpoint, parsed.meters)
      : 0
    generatedPositions = parsed.valid
      ? computePlantSpacingPositions(source.plant.position, nextEndpoint, parsed.meters, {
          limit: PLANT_SPACING_PREVIEW_POSITION_LIMIT,
        })
      : []
    const length = Math.hypot(
      nextEndpoint.x - source.plant.position.x,
      nextEndpoint.y - source.plant.position.y,
    )
    setGeneratedCount(generatedCount, {
      dense: generatedCount > PLANT_SPACING_DENSE_WARNING_THRESHOLD,
      blocked: generatedCount > PLANT_SPACING_COMMIT_POSITION_LIMIT,
    })
    overlay.showPreview({
      start: source.plant.position,
      end: nextEndpoint,
      lengthLabel: formatPlantSpacingGuideLength(length),
      ghostPositions: generatedPositions,
      ghostColor: ghostColor(source.plant),
      ghostRadiusPx: ghostRadiusPx(source.plant),
    }, context.camera)
  }

  function commitPreview(nextEndpoint: ScenePoint): void {
    if (!source) return

    if (!canUseSource(source)) {
      clearUnavailableSource()
      return
    }

    updatePreview(nextEndpoint)
    const parsed = parsePlantSpacingIntervalInput(intervalText)
    if (!intervalValid || !parsed.valid) {
      focusIntervalInput()
      return
    }

    if (generatedCount === 0) return
    if (generatedCount > PLANT_SPACING_COMMIT_POSITION_LIMIT) {
      setGeneratedCount(generatedCount, { blocked: true })
      return
    }

    const positions = generatedCount > generatedPositions.length
      ? computePlantSpacingPositions(source.plant.position, nextEndpoint, parsed.meters)
      : generatedPositions
    commitPositions(positions)
  }

  function shouldBeginDrag(screen: ScenePoint, startScreen: ScenePoint): boolean {
    return Math.hypot(screen.x - startScreen.x, screen.y - startScreen.y) >= PLANT_SPACING_DRAG_START_PX
  }

  function beginDrag(): void {
    focusCanvasContainer()
  }

  function commitDragFromEvent(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>): void {
    commitPreview(dragCommitEndpoint(event))
  }

  function dragCommitEndpoint(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>): ScenePoint {
    const releaseScreen = clampedScreenPoint(event)
    if (
      endpoint
      && previewPointer?.shiftKey
      && !event.shiftKey
      && Math.abs(previewPointer.screen.x - releaseScreen.x) < 0.001
      && Math.abs(previewPointer.screen.y - releaseScreen.y) < 0.001
    ) {
      return endpoint
    }
    return endpointFromScreen(releaseScreen, event.shiftKey)
  }

  function commitPositions(positions: readonly ScenePoint[]): void {
    const activeSource = source
    if (!activeSource) return

    const generatedIds: string[] = []
    context.sceneEdits.run('interaction-plant-spacing', (tx) => {
      tx.mutate((draft) => {
        const generated = createPlantSpacingGeneratedPlants(activeSource.plant, positions, () => {
          const id = createUuid()
          generatedIds.push(id)
          return id
        })
        draft.plants = [...draft.plants, ...generated]
      })
      tx.setSelection([activeSource.sourceId, ...generatedIds].map((id) => ({ kind: 'plant', id })))
    }, { onCommitted: () => clear() })
  }

  function canUseSource(candidate: PlantSpacingSource): boolean {
    const scene = context.getSceneStore().persisted
    if (isSceneDesignObjectLocked(scene, { kind: 'plant', id: candidate.sourceId })) return false
    const layer = scene.layers.find((entry) => entry.name === 'plants')
    if (layer?.visible === false || layer?.locked === true) return false
    if (!scene.plants.some((plant) => plant.id === candidate.sourceId)) return false
    return !scene.groups.some((group) =>
      group.members.some((member) =>
        isSceneObjectGroupMemberTarget(member, { kind: 'plant', id: candidate.sourceId }),
      ),
    )
  }

  function clearUnavailableSource(): void {
    clear()
    showSourcePicking('source-missed')
  }

  function handleIntervalInput(value: string): void {
    intervalText = value
    intervalValid = parsePlantSpacingIntervalInput(value).valid
    if (endpoint) updatePreview(endpoint)
  }

  function commitIntervalInput(
    value: string,
    options: { focusCanvasOnValid?: boolean; focusInputOnInvalid?: boolean } = {},
  ): void {
    const focusCanvasOnValid = options.focusCanvasOnValid ?? true
    const focusInputOnInvalid = options.focusInputOnInvalid ?? true
    intervalText = value
    const parsed = parsePlantSpacingIntervalInput(value)
    intervalValid = parsed.valid

    if (!parsed.valid) {
      if (focusInputOnInvalid) focusIntervalInput()
      return
    }

    context.commitPlantSpacingIntervalMeters(parsed.meters)
    intervalText = formatPlantSpacingIntervalInput(parsed.meters)
    if (endpoint) updatePreview(endpoint)
    if (focusCanvasOnValid) focusCanvasContainer()
  }

  function refreshViewportDependent(): void {
    overlay.refreshSourceHighlight(source ? sourceView(source) : null, context.camera)
    if (endpoint) updatePreview(endpoint)
  }

  function sourceView(candidate: PlantSpacingSource): { id: string; bounds: { x: number; y: number; width: number; height: number } } {
    return {
      id: candidate.sourceId,
      bounds: getPlantWorldBounds(
        candidate.plant,
        context.getPlantPresentationContext(context.camera.viewport.scale),
      ),
    }
  }

  function labelForPlant(plant: ScenePlantEntity): string {
    return context.getLocalizedCommonNames().get(plant.canonicalName)
      ?? plant.commonName
      ?? plant.canonicalName
  }

  function sourceGlyph(plant: ScenePlantEntity): { symbol: PlantSymbolId; color: string } {
    return {
      symbol: resolvePlantSymbolForPlant(plant, context.getSceneStore().persisted.plantSpeciesSymbols),
      color: resolvePlantDisplayColor(plant, context.getSpeciesCache()),
    }
  }

  function ghostColor(plant: ScenePlantEntity): string {
    const plantContext = context.getPlantPresentationContext(context.camera.viewport.scale)
    return resolvePlantDisplayColor(plant, plantContext.speciesCache)
  }

  function ghostRadiusPx(plant: ScenePlantEntity): number {
    const plantContext = context.getPlantPresentationContext(context.camera.viewport.scale)
    const bounds = getPlantWorldBounds(plant, plantContext)
    return Math.max(bounds.width, bounds.height) * context.camera.viewport.scale / 2
  }

  function endpointFromEvent(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'shiftKey'>): ScenePoint {
    return endpointFromScreen(clampedScreenPoint(event), event.shiftKey)
  }

  function endpointFromScreen(screen: ScenePoint, shiftKey: boolean): ScenePoint {
    const rawWorld = context.camera.screenToWorld(screen)
    if (!source) return rawWorld

    if (shiftKey) {
      return constrainPointTo45Degrees(source.plant.position, rawWorld)
    }

    return context.applySnapping(rawWorld)
  }

  function clampedScreenPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): ScenePoint {
    const rect = context.getContainerRect()
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    }
  }

  function focusCanvasContainer(): void {
    if (context.container.tabIndex < 0) context.container.tabIndex = -1
    context.container.focus({ preventScroll: true })
  }

  function dispose(): void {
    overlay.dispose()
  }

  return {
    hasSource: () => source !== null,
    describe,
    spacingField,
    isToolCardTarget,
    showState,
    clear,
    cancel,
    pointerDown,
    updatePreviewFromEvent,
    shouldBeginDrag,
    beginDrag,
    commitDragFromEvent,
    refreshViewportDependent,
    dispose,
  }
}

export function createPlantSpacingToolAdapter(tool: PlantSpacingTool): SceneToolAdapter {
  return {
    onActivate() {
      tool.showState()
    },
    onDeactivate() {
      tool.clear()
    },
    describeGuidance: () => ({ gesture: tool.hasSource(), plantRow: tool.describe() }),
    spacingField: tool.spacingField,
    shouldIgnorePointerEvent: tool.isToolCardTarget,
    shouldSuppressHover: tool.hasSource,
    pointerDown({ event, rawWorld, clearPointerGesture }) {
      event.preventDefault()
      const result = tool.pointerDown(event, rawWorld)
      if (result.clearPointerGesture) clearPointerGesture()
      return true
    },
    pointerMoveWithoutCapture({ event }) {
      if (!tool.hasSource()) return false
      tool.updatePreviewFromEvent(event)
      return true
    },
    pointerMoveWithCapture({ event, screen, startScreen, beginDrag }) {
      if (!tool.hasSource()) return false
      if (!tool.shouldBeginDrag(screen, startScreen)) {
        tool.updatePreviewFromEvent(event)
        return true
      }

      beginDrag({
        update: ({ event }) => tool.updatePreviewFromEvent(event),
        commit: ({ event }) => {
          if (!tool.isToolCardTarget(event.target)) {
            tool.commitDragFromEvent(event)
          }
        },
      })
      tool.beginDrag()
      tool.updatePreviewFromEvent(event)
      return true
    },
    keyDown(event) {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return false
      event.preventDefault()
      tool.cancel()
      return true
    },
    refreshViewportDependent: tool.refreshViewportDependent,
    dispose: tool.dispose,
  }
}

function clonePlantForPlantSpacing(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...plant,
    pinnedName: false,
    position: { ...plant.position },
  }
}

/** The shared tool card, which holds the spacing field: pointer events there are not map input. */
function isToolCardTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('[data-tool-card]') !== null
}
