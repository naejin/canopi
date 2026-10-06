// canvas/runtime/tools/plant-row.ts
//
// Owns Plant a row ('plant-spacing', key W; spec §1.4, §3.2, §3.7): a press on a placed plant picks it as the row's source
// (the tool card's spacing field asks for focus on that press's release, unless it became a drag), then every hover and every move of a held press previews the row from it, and a press or a drag's release commits it, one
// Scene Edit that selects the source and the new plants. The recogniser reports a held press's moves at once (slop 0) and
// the tool keeps today's 4 px itself: a move 4 px from the press on screen makes it a drag, else its release is a click.
// The row's plants repeat the source at the spacing interval of the tool card's field (the spacing commands; Settings keeps
// the interval). Shift turns the row to 45° steps from the source and turns snapping off (the host's constraint and
// noSnap), and the host clamps the pointer to the view (clampsToView). A pan, a blur and a tool re-arm keep the source; Esc
// drops it first, then leaves the tool (today's order, even mid-drag). The draft is the source ring at the plant's
// presented radius, the dashed row guide, a disc for each plant the row would add (at most 250) and the guide's length.

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
import type { CanvasPlantRowGuidance } from '../../session-state'
import { createUuid } from '../../../utils/ids'
import { isSceneObjectGroupMemberTarget } from '../scene/group-members'
import { isSceneDesignObjectLocked } from '../scene/locks'
import { resolvePlantSymbolForPlant } from '../scene/plant-symbols'
import type { ScenePlantEntity } from '../scene/types'
import type { WorldPoint } from '../view/types'
import type { DraftShape, DraftStroke } from './draft'
import type { CanvasTool, ToolCommand, ToolContext, ToolPoint } from './tool'

const PLANT_ROW_DENSE_WARNING_THRESHOLD = 100
const PLANT_ROW_PREVIEW_POSITION_LIMIT = 250
const PLANT_ROW_COMMIT_POSITION_LIMIT = 5_000
/** Today's drag start, on screen from the press; the tool measures it, so the moves inside it still preview. */
const PLANT_ROW_DRAG_PX = 4
const PLANT_ROW_GHOST_OPACITY = 0.35
/** Two points closer than this on screen are the same pointer position (today's 0.001 px). */
const SAME_POINTER_SCREEN_PX = 0.001
const SOURCE_RING_STROKE: DraftStroke = Object.freeze({ token: 'selection', widthPx: 2 })
/** Today's 2 px CSS dashed border, drawn as dashes and gaps of 3 × its width (convention). */
const ROW_GUIDE_STROKE: DraftStroke = Object.freeze({ token: 'selection', widthPx: 2, dash: Object.freeze([6, 6]) })

interface PlantRowSource {
  readonly sourceId: string
  /** The picked plant as the row repeats it, taken when it was picked; its position follows the session plane. */
  plant: ScenePlantEntity
  readonly label: string
  /** The picked plant's symbol and colour, read once when it is picked. */
  readonly glyph: NonNullable<CanvasPlantRowGuidance['glyph']>
}

/** The last preview's pointer: a Shift release on the same spot commits the Shift-constrained row it showed. */
interface PreviewPointer {
  world: WorldPoint
  readonly constrained: boolean
}

export function createPlantRowTool(): CanvasTool {
  let ctx: ToolContext | null = null
  let source: PlantRowSource | null = null
  let intervalText = ''
  let intervalValid = true
  let endpoint: WorldPoint | null = null
  let previewPointer: PreviewPointer | null = null
  let generatedPositions: WorldPoint[] = []
  let generatedCount = 0
  let missed = false
  let shownCount: { readonly count: number; readonly density: CanvasPlantRowGuidance['density'] } | null = null
  let focusRequest = 0
  /** A move of the held press went PLANT_ROW_DRAG_PX out: its release commits (today's drag), else it is a click. */
  let dragging = false
  /** The held press picked the source: its field asks for focus on the release, unless the press became a drag (the map
   *  took focus then; a field focused on the next render would take Esc, Enter and letters from it). */
  let fieldFocusOnRelease = false

  function context(): ToolContext {
    if (!ctx) throw new Error('Plant a row is not active.')
    return ctx
  }

  // ── What the tool card and the map show ─────────────────────────────────────────────────────────────────────────

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

  /** The card, then the map: every change of state ends here. */
  function publish(): void {
    const tool = ctx
    if (!tool) return
    tool.effects.setGuidance({ gesture: source !== null, plantRow: describe() })
    tool.effects.setDraft(source ? { shapes: draftShapes(tool, source) } : null)
  }

  function draftShapes(tool: ToolContext, picked: PlantRowSource): DraftShape[] {
    const start = picked.plant.position
    // The ring sits at the radius the scene presents the plant with now (the plant in the scene, for its crowding).
    const presented = tool.scene.persisted.plants.find((plant) => plant.id === picked.sourceId) ?? picked.plant
    const radiusPx = tool.scene.plantPresentation(presented)?.radiusPx ?? 0
    const shapes: DraftShape[] = [{ kind: 'circle-px', center: start, radiusPx, style: SOURCE_RING_STROKE }]
    const end = endpoint
    if (!end) return shapes
    // The guide and the ring under the row's discs, the length on top.
    shapes.push({ kind: 'polyline', points: [start, end], style: ROW_GUIDE_STROKE })
    const ghosts = createPlantSpacingGeneratedPlants(picked.plant, generatedPositions, (index) => `plant-row-ghost-${index}`)
    for (const plant of ghosts) {
      shapes.push({ kind: 'ghost', entity: { kind: 'plant', plant, mark: 'dot', sizeFrom: start }, opacity: PLANT_ROW_GHOST_OPACITY })
    }
    shapes.push({
      kind: 'label',
      anchor: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      offsetPx: { x: 0, y: 0 },
      text: formatPlantSpacingGuideLength(Math.hypot(end.x - start.x, end.y - start.y)),
      tone: 'hint-primary',
    })
    return shapes
  }

  function focusIntervalInput(): void {
    focusRequest += 1
  }

  /** The release of the press that picked the source: the field asks for focus now. */
  function focusFieldOnRelease(): boolean {
    if (!fieldFocusOnRelease) return false
    fieldFocusOnRelease = false
    if (source) focusIntervalInput()
    return true
  }

  // ── Source ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function showSourcePicking(reason: 'select-source' | 'source-missed' = 'select-source'): void {
    missed = reason === 'source-missed'
    shownCount = null
  }

  function clear(): void {
    source = null
    endpoint = null
    previewPointer = null
    generatedPositions = []
    generatedCount = 0
    showSourcePicking()
  }

  /** A press with no source: the plant under it, if it can repeat (not locked, not grouped away). */
  function pickSource(point: ToolPoint): void {
    const tool = context()
    const persisted = tool.scene.persisted
    // Today's hitTestTopLevel: object locks come back and are refused here.
    const hit = tool.scene.hitAt(point.world)
    const target = hit?.kind === 'object' ? hit.target : null
    const plant = target?.kind === 'plant' && !isSceneDesignObjectLocked(persisted, target)
      ? persisted.plants.find((entry) => entry.id === target.id)
      : undefined
    if (!plant) {
      showSourcePicking('source-missed')
      return
    }
    const presentation = tool.scene.plantPresentation(plant)
    source = {
      sourceId: plant.id,
      plant: { ...plant, pinnedName: false, position: { ...plant.position } },
      label: presentation?.commonName ?? plant.commonName ?? plant.canonicalName,
      glyph: {
        symbol: resolvePlantSymbolForPlant(plant, persisted.plantSpeciesSymbols),
        color: presentation?.color ?? plant.color ?? '',
      },
    }
    intervalText = formatPlantSpacingIntervalInput(tool.settings.plantSpacingIntervalM())
    intervalValid = true
    missed = false
    shownCount = null
    fieldFocusOnRelease = true
  }

  function canUseSource(candidate: PlantRowSource): boolean {
    const persisted = context().scene.persisted
    const target = { kind: 'plant', id: candidate.sourceId } as const
    if (isSceneDesignObjectLocked(persisted, target)) return false
    const layer = persisted.layers.find((entry) => entry.name === 'plants')
    if (layer?.visible === false || layer?.locked === true) return false
    if (!persisted.plants.some((plant) => plant.id === candidate.sourceId)) return false
    return !persisted.groups.some((group) => group.members.some((member) => isSceneObjectGroupMemberTarget(member, target)))
  }

  // ── Row ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  function setGeneratedCount(count: number, options: { dense?: boolean; blocked?: boolean }): void {
    shownCount = { count, density: options.blocked ? 'blocked' : options.dense ? 'dense' : 'normal' }
  }

  function updatePreview(nextEndpoint: WorldPoint): void {
    if (!source) return
    endpoint = nextEndpoint
    const start = source.plant.position
    const parsed = parsePlantSpacingIntervalInput(intervalText)
    intervalValid = parsed.valid
    generatedCount = parsed.valid ? computePlantSpacingCount(start, nextEndpoint, parsed.meters) : 0
    generatedPositions = parsed.valid
      ? computePlantSpacingPositions(start, nextEndpoint, parsed.meters, { limit: PLANT_ROW_PREVIEW_POSITION_LIMIT })
      : []
    setGeneratedCount(generatedCount, {
      dense: generatedCount > PLANT_ROW_DENSE_WARNING_THRESHOLD,
      blocked: generatedCount > PLANT_ROW_COMMIT_POSITION_LIMIT,
    })
  }

  /** The row follows the pointer: its snapped point, which the host constrained under Shift. */
  function previewAt(point: ToolPoint): void {
    previewPointer = { world: point.world, constrained: point.modifiers.constrain }
    updatePreview(point.snapped)
  }

  /** A move of the held press: the row follows it, and the first move 4 px out starts the drag and focuses the map. */
  function followDrag(point: ToolPoint, start: ToolPoint): void {
    const tool = context()
    if (!dragging && tool.view.screenDistance(start.world, point.world) >= PLANT_ROW_DRAG_PX) {
      dragging = true
      fieldFocusOnRelease = false
      tool.effects.requestFocus('map')
    }
    previewAt(point)
  }

  function commitPreview(nextEndpoint: WorldPoint): void {
    if (!source) return
    if (!canUseSource(source)) {
      clear()
      showSourcePicking('source-missed')
      return
    }
    updatePreview(nextEndpoint)
    const parsed = parsePlantSpacingIntervalInput(intervalText)
    if (!intervalValid || !parsed.valid) {
      focusIntervalInput()
      return
    }
    if (generatedCount === 0) return
    if (generatedCount > PLANT_ROW_COMMIT_POSITION_LIMIT) {
      setGeneratedCount(generatedCount, { blocked: true })
      return
    }
    const positions = generatedCount > generatedPositions.length
      ? computePlantSpacingPositions(source.plant.position, nextEndpoint, parsed.meters)
      : generatedPositions
    commitPositions(source, positions)
  }

  function commitPositions(picked: PlantRowSource, positions: readonly WorldPoint[]): void {
    const generatedIds: string[] = []
    context().effects.edits.run('interaction-plant-spacing', (tx) => {
      tx.mutate((draft) => {
        const generated = createPlantSpacingGeneratedPlants(picked.plant, positions, () => {
          const id = createUuid()
          generatedIds.push(id)
          return id
        })
        draft.plants = [...draft.plants, ...generated]
      })
      tx.setSelection([picked.sourceId, ...generatedIds].map((id) => ({ kind: 'plant', id })))
    }, {
      onCommitted: () => {
        clear()
        publish()
      },
    })
  }

  /**
   * A drag's release: a Shift release on the spot of a Shift preview commits the row the preview showed (today's), else
   * the release point's row.
   */
  function dragCommitEndpoint(point: ToolPoint): WorldPoint {
    const last = previewPointer
    if (
      endpoint
      && last?.constrained
      && !point.modifiers.constrain
      && context().view.screenDistance(last.world, point.world) < SAME_POINTER_SCREEN_PX
    ) {
      return endpoint
    }
    return point.snapped
  }

  // ── The tool card's spacing field ───────────────────────────────────────────────────────────────────────────────

  function spacingCommand(c: Extract<ToolCommand, { kind: 'spacing-input' | 'spacing-commit' | 'spacing-cancel' }>): void {
    const tool = context()
    if (c.kind === 'spacing-input') {
      intervalText = c.text
      intervalValid = parsePlantSpacingIntervalInput(c.text).valid
      if (endpoint) updatePreview(endpoint)
      return
    }
    if (c.kind === 'spacing-cancel') {
      // Esc in the field drops the source and gives the map its focus back.
      const hadSource = source !== null
      if (hadSource) clear()
      tool.effects.requestFocus('map')
      if (!hadSource) tool.effects.requestTool('select')
      return
    }
    const parsed = parsePlantSpacingIntervalInput(intervalText)
    intervalValid = parsed.valid
    if (!parsed.valid) {
      // Enter keeps the field until the spacing is valid; leaving it moves no focus.
      if (c.via === 'enter') focusIntervalInput()
      return
    }
    tool.settings.commitPlantSpacingIntervalM(parsed.meters)
    intervalText = formatPlantSpacingIntervalInput(parsed.meters)
    if (endpoint) updatePreview(endpoint)
    if (c.via === 'enter') tool.effects.requestFocus('map')
  }

  return {
    id: 'plant-spacing',
    // The recogniser reports the drag at once, so the moves inside today's 4 px preview too (followDrag measures them).
    dragSlopPx: 0,
    clampsToView: true,
    constraint() {
      return source ? { kind: 'direction', origin: source.plant.position, stepDeg: 45 } : null
    },
    activate(next) {
      ctx = next
      intervalText = formatPlantSpacingIntervalInput(next.settings.plantSpacingIntervalM())
      publish()
    },
    gesture(g) {
      switch (g.kind) {
        case 'press':
          dragging = false
          fieldFocusOnRelease = false
          if (source) commitPreview(g.point.snapped)
          else pickSource(g.point)
          break
        case 'drag-start':
        case 'drag-move':
          if (!source) return 'pass'
          followDrag(g.point, g.start)
          break
        case 'drag-end':
          if (!source) return 'pass'
          // A release that never went 4 px out is a click: its press did all a click does but focus the field, and the
          // preview stays.
          if (dragging) commitPreview(dragCommitEndpoint(g.point))
          else focusFieldOnRelease()
          break
        case 'tap':
          // The tap itself stays the host's, as before; only the field's focus request is published.
          if (focusFieldOnRelease()) publish()
          return 'pass'
        case 'cancel':
          fieldFocusOnRelease = false
          return 'pass'
        case 'hover':
          if (!source) return 'pass'
          previewAt(g.point)
          publish()
          // While a source is picked the row replaces the hover restyle and the plant tooltip.
          return 'handled'
        default:
          // A click adds nothing more than its press; a cancelled drag keeps the source and its preview.
          return 'pass'
      }
      publish()
      return 'handled'
    },
    command(c) {
      switch (c.kind) {
        case 'escape':
          // Today's order: the source first, even mid-drag, then the tool itself.
          if (source) {
            clear()
            publish()
          } else {
            context().effects.requestTool('select')
          }
          return 'handled'
        case 'spacing-input':
        case 'spacing-commit':
        case 'spacing-cancel':
          spacingCommand(c)
          publish()
          return 'handled'
        default:
          return 'pass'
      }
    },
    sceneChanged: publish,
    viewChanged: publish,
    hasTransient: () => source !== null,
    escapeHint: () => source ? 'drop-transient' : 'leave-tool',
    cancelTransient(reason) {
      if (reason !== 'escape' || !source) return
      clear()
      publish()
    },
    deactivate() {
      clear()
      ctx?.effects.setDraft(null)
      ctx = null
    },
  }
}
