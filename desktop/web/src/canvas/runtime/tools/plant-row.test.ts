import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createToolHarness,
  plantEntity,
  useStubTools,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../__tests__/support/tool-harness'
import type { CanvasPlantRowGuidance } from '../../session-state'
import type { ScenePlantEntity } from '../scene/types'
import type { WorldPoint } from '../view/types'
import type { DraftShape } from './draft'
import { createPlantRowTool } from './plant-row'
import type { ToolSettingsPort } from './tool'
import '../../../__tests__/support/camera-tolerance'

vi.mock('./registry', () => ({ TOOL_REGISTRY: {} }))

const harnesses: ToolHarness[] = []

afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose()
})

interface RowSettings extends ToolSettingsPort {
  intervalM: number
  readonly commitPlantSpacingIntervalM: ReturnType<typeof vi.fn<(metres: number) => void>>
}

function rowSettings(intervalM: number): RowSettings {
  const settings: RowSettings = {
    intervalM,
    plantSpacingIntervalM: () => settings.intervalM,
    commitPlantSpacingIntervalM: vi.fn((metres: number) => {
      settings.intervalM = metres
    }),
  }
  return settings
}

function sourcePlant(position: WorldPoint = { x: 20, y: 30 }, overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return plantEntity('source', 'Malus domestica', position, { commonName: 'Apple', ...overrides })
}

/** Plant a row armed on a harness at `scale` px/m, over `plants` (default the source at (20, 30)), with `intervalM`. */
function rowHarness(options: ToolHarnessOptions & {
  readonly scale?: number
  readonly intervalM?: number
  readonly plants?: readonly ScenePlantEntity[]
} = {}): { readonly h: ToolHarness; readonly settings: RowSettings } {
  const settings = rowSettings(options.intervalM ?? 0.5)
  useStubTools(createPlantRowTool())
  const { scale = 1, intervalM: _intervalM, plants = [sourcePlant()], scene, ...rest } = options
  const h = createToolHarness({ viewport: { x: 0, y: 0, scale }, scene: { plants: [...plants], ...scene }, settings, ...rest })
  harnesses.push(h)
  h.arm('plant-spacing')
  return { h, settings }
}

function row(h: ToolHarness): CanvasPlantRowGuidance {
  const guidance = h.record.guidance.at(-1)?.plantRow
  if (!guidance) throw new Error('Plant a row published no guidance.')
  return guidance
}

function shapesOf<K extends DraftShape['kind']>(h: ToolHarness, kind: K): Extract<DraftShape, { kind: K }>[] {
  return (h.renderer.lastDraft()?.shapes ?? []).filter((shape): shape is Extract<DraftShape, { kind: K }> => shape.kind === kind)
}

function ghostPositions(h: ToolHarness): WorldPoint[] {
  return shapesOf(h, 'ghost').flatMap((ghost) => ghost.entity.kind === 'plant' ? [ghost.entity.plant.position] : [])
}

function lengthLabel(h: ToolHarness): string | undefined {
  return shapesOf(h, 'label').find((label) => label.tone === 'hint-primary')?.text
}

function added(h: ToolHarness): WorldPoint[] {
  return h.store.persisted.plants.filter((plant) => plant.id !== 'source').map((plant) => plant.position)
}

describe('Plant a row tool', () => {
  it('a press that misses a plant keeps picking and leaves the selection alone', () => {
    const { h } = rowHarness({ plants: [] })
    h.store.setSelection([{ kind: 'plant', id: 'already-selected' }])

    h.click({ x: 200, y: 200 })

    expect(row(h)).toMatchObject({ phase: 'missed', plantName: null })
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.record.selections).toEqual([])
    expect(h.store.session.selectedTargets).toEqual([{ kind: 'plant', id: 'already-selected' }])
  })

  it('a grouped or locked plant is not picked', () => {
    const { h } = rowHarness({
      plants: [
        sourcePlant({ x: 20, y: 30 }, { id: 'grouped-plant' }),
        sourcePlant({ x: 80, y: 30 }, { id: 'locked-plant', locked: true }),
      ],
      scene: { groups: [{ kind: 'group', id: 'group-1', locked: false, name: 'Grouped row', members: [{ kind: 'plant', id: 'grouped-plant' }] }] },
    })

    h.click({ x: 20, y: 30 })
    expect(row(h).phase).toBe('missed')
    h.click({ x: 80, y: 30 })
    expect(row(h).phase).toBe('missed')
    expect(h.renderer.lastDraft()).toBeNull()
  })

  it('a plant on a hidden or locked plants layer is not picked', () => {
    const { h } = rowHarness()
    const setPlantsLayer = (visible: boolean, locked: boolean): void => {
      h.store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) => (layer.name === 'plants' ? { ...layer, visible, locked } : layer))
      })
    }

    setPlantsLayer(false, false)
    h.click({ x: 20, y: 30 })
    expect(row(h).phase).not.toBe('row')

    setPlantsLayer(true, true)
    h.click({ x: 20, y: 30 })
    expect(row(h).phase).not.toBe('row')
    expect(h.renderer.lastDraft()).toBeNull()
  })

  it('Esc drops the row source first, then leaves', () => {
    const { h } = rowHarness()
    h.click({ x: 20, y: 30 })
    expect(row(h).phase).toBe('row')
    expect(h.host.escapeHint()).toBe('drop-transient')
    expect(h.host.activeToolHasTransient()).toBe(true)

    expect(h.host.command({ kind: 'escape' })).toBe('handled')
    expect(row(h).phase).toBe('pick')
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.host.activeTool.peek()).toBe('plant-spacing')
    expect(h.host.escapeHint()).toBe('leave-tool')

    // Today's order: the source goes first even while a drag from it is live.
    h.press({ x: 20, y: 30 })
    h.move({ x: 26, y: 30 })
    expect(h.host.hasLiveGesture()).toBe(true)
    expect(h.host.command({ kind: 'escape' })).toBe('handled')
    expect(row(h).phase).toBe('pick')
    h.release({ x: 26, y: 30 })
    expect(added(h)).toEqual([])

    expect(h.host.command({ kind: 'escape' })).toBe('handled')
    expect(h.host.activeTool.peek()).toBe('select')
  })

  it('a blur keeps the row source and its preview', () => {
    const { h } = rowHarness({ intervalM: 2 })
    h.click({ x: 20, y: 30 })
    h.hover({ x: 26, y: 30 })

    h.blur()

    expect(row(h)).toMatchObject({ phase: 'row', count: 3 })
    expect(ghostPositions(h)).toHaveLength(3)
  })

  it('a hover previews the row and a press commits it as one Scene Edit', () => {
    const { h } = rowHarness({
      intervalM: 2,
      plants: [sourcePlant({ x: 20, y: 30 }, {
        color: '#884422',
        canopySpreadM: 3,
        rotationDeg: 15,
        notes: 'Do not copy',
        plantedDate: '2026-03-01',
        quantity: 4,
      })],
    })
    h.click({ x: 20, y: 30 })

    h.hover({ x: 26, y: 30 })

    const start = { x: 20, y: 30 }
    const end = { x: 26, y: 30 }
    expect(row(h)).toMatchObject({ phase: 'row', plantName: 'Apple', count: 3, density: 'normal' })
    expect(shapesOf(h, 'circle-px')).toMatchObject([{ center: start, style: { token: 'selection', widthPx: 2 } }])
    expect(shapesOf(h, 'polyline')).toEqual([{ kind: 'polyline', points: [start, end], style: { token: 'selection', widthPx: 2, dash: [6, 6] } }])
    expect(ghostPositions(h)).toEqual([{ x: 22, y: 30 }, { x: 24, y: 30 }, { x: 26, y: 30 }])
    expect(shapesOf(h, 'label')).toEqual([{ kind: 'label', anchor: { x: 23, y: 30 }, offsetPx: { x: 0, y: 0 }, text: '6 m', tone: 'hint-primary' }])
    // The ring and the guide under the discs, the length on top; the row replaces the hover restyle.
    expect(h.renderer.lastDraft()!.shapes.map((shape) => shape.kind)).toEqual(['circle-px', 'polyline', 'ghost', 'ghost', 'ghost', 'label'])
    expect(h.chrome.tooltip).toBeNull()

    h.click(end)

    expect(added(h)).toEqual([{ x: 22, y: 30 }, { x: 24, y: 30 }, { x: 26, y: 30 }])
    expect(h.store.persisted.plants[1]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#884422',
      canopySpreadM: 3,
      rotationDeg: 15,
      notes: null,
      plantedDate: null,
      quantity: 1,
      pinnedName: false,
    })
    expect(h.store.persisted.groups).toEqual([])
    expect(h.store.session.selectedTargets.map((target) => target.id)).toEqual(h.store.persisted.plants.map((plant) => plant.id))
    expect(row(h).phase).toBe('pick')
    expect(h.renderer.lastDraft()).toBeNull()
    h.undo()
    expect(h.store.persisted.plants.map((plant) => plant.id)).toEqual(['source'])
  })

  it('a row whose source became unavailable commits nothing and returns to picking', () => {
    const blockers: Record<string, (h: ToolHarness) => void> = {
      'a locked source': (h) => h.store.updatePersisted((draft) => {
        draft.plants = draft.plants.map((plant) => (plant.id === 'source' ? { ...plant, locked: true } : plant))
      }),
      'a removed source': (h) => h.store.updatePersisted((draft) => {
        draft.plants = []
      }),
      'a locked plants layer': (h) => h.store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) => (layer.name === 'plants' ? { ...layer, locked: true } : layer))
      }),
      'a hidden plants layer': (h) => h.store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) => (layer.name === 'plants' ? { ...layer, visible: false } : layer))
      }),
    }
    for (const [name, block] of Object.entries(blockers)) {
      const { h } = rowHarness({ intervalM: 2 })
      h.click({ x: 20, y: 30 })
      h.hover({ x: 26, y: 30 })

      block(h)
      h.click({ x: 26, y: 30 })

      expect(added(h), name).toEqual([])
      expect(h.history.canUndo.value, name).toBe(false)
      expect(row(h).phase, name).toBe('missed')
      expect(h.renderer.lastDraft(), name).toBeNull()
    }
  })

  it('a dense row previews at most 250 discs and counts them all', () => {
    const { h } = rowHarness({ intervalM: 0.001 })
    h.click({ x: 20, y: 30 })

    h.hover({ x: 22, y: 30 })

    expect(row(h)).toMatchObject({ count: 2000, density: 'dense' })
    expect(ghostPositions(h)).toHaveLength(250)
  })

  it('a row above 5000 plants is blocked', () => {
    const { h } = rowHarness({ intervalM: 0.001, plants: [sourcePlant({ x: 10, y: 10 })] })
    h.click({ x: 10, y: 10 })
    h.hover({ x: 20, y: 10 })
    expect(row(h)).toMatchObject({ count: 10000, density: 'blocked' })

    h.click({ x: 20, y: 10 })

    expect(added(h)).toEqual([])
    expect(row(h)).toMatchObject({ phase: 'row', density: 'blocked' })
    expect(shapesOf(h, 'polyline')).toHaveLength(1)
    expect(shapesOf(h, 'circle-px')).toHaveLength(1)
  })

  it('a row of exactly 5000 plants commits', () => {
    const { h } = rowHarness({ intervalM: 0.001, plants: [sourcePlant({ x: 10, y: 10 })] })
    h.click({ x: 10, y: 10 })
    h.hover({ x: 15, y: 10 })
    expect(row(h)).toMatchObject({ count: 5000, density: 'dense' })

    h.click({ x: 15, y: 10 })

    expect(h.store.persisted.plants).toHaveLength(5001)
    expect(added(h).at(-1)).toEqual({ x: 15, y: 10 })
  })

  it('the row\'s discs take their size from the source\'s presentation', () => {
    const { h } = rowHarness({ scale: 10, intervalM: 2, plants: [sourcePlant({ x: 2, y: 3 }, { canopySpreadM: 4 })] })
    h.click({ x: 20, y: 30 })
    h.hover({ x: 60, y: 30 })

    const ghosts = shapesOf(h, 'ghost')
    expect(ghosts).toHaveLength(2)
    for (const ghost of ghosts) {
      expect(ghost).toMatchObject({ opacity: 0.35, entity: { kind: 'plant', mark: 'dot', sizeFrom: { x: 2, y: 3 } } })
    }

    // A zoom at the pointer redraws the row, whose discs the renderer sizes at the new scale.
    const drafts = h.renderer.calls.length
    h.wheelZoom({ x: 60, y: 30 }, 2)
    expect(h.renderer.calls.length).toBeGreaterThan(drafts)
    expect(shapesOf(h, 'ghost').every((ghost) => ghost.entity.kind === 'plant' && ghost.entity.sizeFrom?.x === 2)).toBe(true)
  })

  it('a row with no room for a plant previews and commits nothing', () => {
    const { h } = rowHarness({ intervalM: 2 })
    h.click({ x: 20, y: 30 })
    h.hover({ x: 21.5, y: 30 })
    expect(lengthLabel(h)).toBe('1.5 m')
    expect(ghostPositions(h)).toEqual([])

    h.click({ x: 21, y: 30 })

    expect(added(h)).toEqual([])
    expect(h.history.canUndo.value).toBe(false)
    expect(shapesOf(h, 'polyline')).toHaveLength(1)
    expect(row(h).phase).toBe('row')
  })

  it('a zero-length row reads 0 cm and keeps the interval', () => {
    const { h } = rowHarness()
    h.click({ x: 20, y: 30 })

    h.hover({ x: 20, y: 30 })

    expect(row(h)).toMatchObject({ interval: '50 cm', count: 0 })
    expect(lengthLabel(h)).toBe('0 cm')
  })

  it('a drag released without Shift on the spot of a Shift preview commits the constrained row', () => {
    const { h } = rowHarness({ scale: 10, intervalM: 1, plants: [sourcePlant({ x: 4, y: 4 })] })

    h.press({ x: 40, y: 40 })
    h.move({ x: 71, y: 52 }, { shift: true })
    const guide = shapesOf(h, 'polyline')[0]!
    expect(guide.points[1]!.y).toBeCloseTo(4, 9)
    h.release({ x: 71, y: 52 }, { shift: false })

    expect(added(h).map((point) => point.y)).toEqual([4, 4, 4])
    expect(added(h).map((point) => point.x)).toEqual([5, 6, 7])
  })

  it('Shift keeps 45 degrees on screen at 30', () => {
    const { h } = rowHarness({ camera: { bearingDeg: 30 }, intervalM: 1 })
    const source = h.view.view().worldToScreen({ x: 20, y: 30 })

    h.press(source)
    // 31 px right and 12 px down on screen: Shift lays the row level on screen, not level with the world.
    h.move({ x: source.x + 31, y: source.y + 12 }, { shift: true })

    const end = h.view.view().worldToScreen(shapesOf(h, 'polyline')[0]!.points[1]!)
    expect(end.y).toBeCloseTo(source.y, 6)
    expect(end.x - source.x).toBeCloseTo(Math.hypot(31, 12), 6)
  })

  it('a row of 100 plants commits without confirmation', () => {
    const { h } = rowHarness({ intervalM: 1, plants: [sourcePlant({ x: 10, y: 10 })] })
    h.click({ x: 10, y: 10 })
    h.hover({ x: 110, y: 10 })
    expect(row(h)).toMatchObject({ count: 100, density: 'normal' })

    h.click({ x: 110, y: 10 })

    expect(h.store.persisted.plants).toHaveLength(101)
  })

  it('a row above 100 plants reads dense and commits directly', () => {
    const { h } = rowHarness({ intervalM: 1, plants: [sourcePlant({ x: 10, y: 10 })] })
    h.click({ x: 10, y: 10 })
    h.hover({ x: 111, y: 10 })
    expect(row(h)).toMatchObject({ count: 101, density: 'dense' })

    h.click({ x: 111, y: 10 })

    expect(h.store.persisted.plants).toHaveLength(102)
    expect(added(h).at(-1)).toEqual({ x: 111, y: 10 })
  })

  it('a drag commits the row at its release point', () => {
    const { h } = rowHarness({ intervalM: 2 })

    h.press({ x: 20, y: 30 })
    h.move({ x: 25, y: 30 })
    h.release({ x: 26, y: 30 })

    expect(added(h)).toEqual([{ x: 22, y: 30 }, { x: 24, y: 30 }, { x: 26, y: 30 }])
  })

  it('a dense drag commits directly', () => {
    const { h } = rowHarness({ intervalM: 1, plants: [sourcePlant({ x: 10, y: 10 })] })

    h.press({ x: 10, y: 10 })
    h.move({ x: 111, y: 10 })
    h.release({ x: 111, y: 10 })

    expect(h.store.persisted.plants).toHaveLength(102)
    expect(added(h).at(-1)).toEqual({ x: 111, y: 10 })
    expect(row(h).phase).toBe('pick')
  })

  it('the spacing field asks for focus on the release of the press that picked the source, never during its drag', () => {
    const { h } = rowHarness({ intervalM: 2 })

    // A fast press and drag: the field would take focus after the map did, and Esc, Enter and letters would go to it.
    h.press({ x: 20, y: 30 })
    expect(row(h)).toMatchObject({ phase: 'row', focusRequest: 0 })
    const focus = h.record.focus.length
    h.move({ x: 25, y: 30 })
    expect(h.record.focus.slice(focus)).toEqual(['map:tool-requested'])
    h.release({ x: 26, y: 30 })
    expect(added(h)).toEqual([{ x: 22, y: 30 }, { x: 24, y: 30 }, { x: 26, y: 30 }])
    expect(row(h).focusRequest).toBe(0)

    // A tap picks the source and the field takes focus on its release, as today.
    h.press({ x: 20, y: 30 })
    expect(row(h).focusRequest).toBe(0)
    h.release({ x: 20, y: 30 })
    expect(row(h)).toMatchObject({ phase: 'row', focusRequest: 1 })
  })

  it('a drag from the source takes the map\'s focus', () => {
    const { h } = rowHarness({ intervalM: 2 })

    h.press({ x: 20, y: 30 })
    const focusBeforeDrag = h.record.focus.length
    h.move({ x: 25, y: 30 })

    expect(h.record.focus.slice(focusBeforeDrag)).toEqual(['map:tool-requested'])
  })

  it('the spacing field\'s commands reach the row', () => {
    const { h, settings } = rowHarness({ intervalM: 1.25 })
    h.click({ x: 20, y: 30 })
    expect(row(h)).toMatchObject({ phase: 'row', interval: '1.25 m', intervalValid: true, focusRequest: 1 })
    h.hover({ x: 26, y: 30 })
    expect(row(h).count).toBe(4)

    // Typing: the preview follows a valid spacing, and an invalid one leaves the row empty.
    h.host.command({ kind: 'spacing-input', text: '2 m' })
    expect(row(h)).toMatchObject({ interval: '2 m', count: 3 })
    h.host.command({ kind: 'spacing-input', text: '0' })
    expect(row(h)).toMatchObject({ interval: '0', intervalValid: false, count: 0 })

    // Enter keeps the field until the spacing is valid; leaving it moves no focus.
    const focus = h.record.focus.length
    h.host.command({ kind: 'spacing-commit', via: 'enter' })
    expect(row(h)).toMatchObject({ intervalValid: false, focusRequest: 2 })
    h.host.command({ kind: 'spacing-commit', via: 'blur' })
    expect(row(h).focusRequest).toBe(2)
    expect(settings.commitPlantSpacingIntervalM).not.toHaveBeenCalled()
    expect(h.record.focus.slice(focus)).toEqual([])

    h.host.command({ kind: 'spacing-input', text: '0.75m' })
    h.host.command({ kind: 'spacing-commit', via: 'enter' })
    expect(settings.commitPlantSpacingIntervalM).toHaveBeenCalledWith(0.75)
    expect(row(h)).toMatchObject({ phase: 'row', interval: '75 cm', intervalValid: true })
    expect(h.record.focus.slice(focus)).toEqual(['map:tool-requested'])
    expect(h.store.persisted.plants).toHaveLength(1)

    // Esc in the field drops the source and gives the map its focus back; the tool stays armed.
    h.host.command({ kind: 'spacing-cancel' })
    expect(row(h).phase).toBe('pick')
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.record.focus.at(-1)).toBe('map:tool-requested')
    expect(h.host.activeTool.peek()).toBe('plant-spacing')
  })

  it('a clamped endpoint stays at the view\'s edge', () => {
    const { h } = rowHarness({ intervalM: 100 })
    h.click({ x: 20, y: 30 })

    h.hover({ x: 500, y: 30 })

    expect(lengthLabel(h)).toBe('380 m')
    expect(shapesOf(h, 'polyline')[0]!.points[1]).toEqual({ x: 400, y: 30 })

    h.click({ x: 500, y: 30 })

    expect(added(h)).toEqual([{ x: 120, y: 30 }, { x: 220, y: 30 }, { x: 320, y: 30 }])
  })

  it('a picked source holds re-origin until Esc drops it', () => {
    const { h } = rowHarness({ intervalM: 1 })
    expect(h.host.holdsReorigin()).toBe(false)

    h.click({ x: 20, y: 30 })
    expect(row(h).phase).toBe('row')
    expect(h.host.holdsReorigin()).toBe(true)

    h.host.command({ kind: 'escape' })
    expect(h.host.holdsReorigin()).toBe(false)
  })
})
