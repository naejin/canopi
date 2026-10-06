// The canvas interaction end to end through the session, split by the first tool a test arms (canvas v2 plan §4):
// tests that arm Plant stamp or Plant a row, and the three Place plants describes.
// Shared fakes, helpers and fixture: support/canvas-interaction-setup.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gridInterval } from '../canvas/grid'
import {
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import {
  currentCanvasSelection,
  setCanvasToolGuidance,
  type CanvasToolGuidance,
} from '../canvas/session-state'
import { snapToGridEnabled } from '../app/canvas-settings/signals'
import { plantSpacingIntervalM } from '../app/settings/state'
import type { SceneStore } from '../canvas/runtime/scene'
import type {
  SceneInteractionSession,
  SceneInteractionSessionDeps,
} from '../canvas/runtime/interaction-session'
import type { DraftShape } from '../canvas/runtime/tools/draft'
import { createRecordingRenderer, type RecordingRenderer } from './support/recording-renderer'
import type { TestView } from './support/test-view'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './support/canvas-interaction-events'
import {
  contextMenuHost,
  contextMenuCommand,
  createInteractionDeps,
  plantTarget,
  zoneTarget,
  nextAnimationFrame,
  makePlant,
  plantHoverTooltip,
  installSceneInteractionFixture,
} from './support/canvas-interaction-setup'
import './support/camera-tolerance'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let testView: TestView
  let store: SceneStore
  let events: SceneInteractionEventHarness
  /** The session's draft sink: Plant a row's ring, guide, discs and length draw in Pixi (plan §1, exception 2). */
  let drafts: RecordingRenderer

  const {
    createTestSession: createFixtureSession,
    toolCard,
    spacingInput,
    typeSpacing,
    openContextMenu,
  } = installSceneInteractionFixture(
    (f) => {
      ({ container, testView, store, events } = f)
    },
    () => ({ events }),
  )

  beforeEach(() => {
    drafts = createRecordingRenderer()
  })

  function createTestSession(deps: SceneInteractionSessionDeps): SceneInteractionSession {
    return createFixtureSession({ ...deps, renderer: drafts })
  }

  function draftShapes<K extends DraftShape['kind']>(kind: K): Extract<DraftShape, { kind: K }>[] {
    return (drafts.lastDraft()?.shapes ?? []).filter((shape): shape is Extract<DraftShape, { kind: K }> => shape.kind === kind)
  }

  /** Plant a row's ring on the plant it repeats (today's [data-plant-spacing-source]). */
  function rowSource(id: string): boolean {
    const plant = store.persisted.plants.find((entry) => entry.id === id)
    return plant !== undefined && draftShapes('circle-px')
      .some((ring) => ring.center.x === plant.position.x && ring.center.y === plant.position.y)
  }

  /** The row guide's length label (today's [data-plant-spacing-length-label]). */
  function rowLength(): string | undefined {
    return draftShapes('label').find((label) => label.tone === 'hint-primary')?.text
  }

  it('refreshes Plant Spacing translations without resetting its phase, interval, count, or field', () => {
    let language = 'en'
    const translate = (key: string, options?: Readonly<Record<string, unknown>>): string =>
      `${language}:${key}${options?.count === undefined ? '' : `:${String(options.count)}`}`
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const published: CanvasToolGuidance[] = []
    const deps = createInteractionDeps(container, store, testView, {
      translate,
      publishToolGuidance: (guidance) => {
        published.push(guidance)
        setCanvasToolGuidance(guidance)
      },
    })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 })

    typeSpacing('2 m')
    events.pointerMove({ x: 26, y: 30 })
    const input = spacingInput()!
    input.focus()
    input.setSelectionRange(1, 3)
    const ghostCount = draftShapes('ghost').length
    const before = published[published.length - 1]!.plantRow

    expect(before).toMatchObject({ phase: 'row', interval: '2 m', count: 3 })

    language = 'fr'
    session.refreshTranslations()

    expect(published[published.length - 1]!.plantRow).toEqual(before)
    expect(spacingInput()).toBe(input)
    expect(input.value).toBe('2 m')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(3)
    expect(draftShapes('ghost')).toHaveLength(ghostCount)
    expect(draftShapes('polyline')).toHaveLength(1)
  })

  it('does not dispatch a Plant Stamp after synchronous capture loss', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, {
      pointerCapture: { synchronousLossOnSet: true },
    })
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, testView, { onSceneEditCommit }))
    session.setTool('plant-stamp')

    events.pointerDown({ x: 50, y: 70 }, { pointerId: 26 })

    expect(events.pointerCapture.setCalls).toHaveBeenCalledWith(26)
    expect(events.pointerCapture.has(26)).toBe(false)
    expect(store.persisted.plants).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('shows Plant Spacing source picking and samples a plant without mutating selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'plant-1',
        locked: false,
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, testView)
    deps.setSelection([plantTarget('already-selected')])
    vi.mocked(deps.setSelection).mockClear()
    const session = createTestSession(deps)

    session.setTool('plant-spacing')

    const hud = toolCard()
    expect(hud?.textContent).toContain('Click a placed plant to repeat it along a row')
    expect(hud?.textContent).toContain('Esc to go back to Select')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    expect(rowSource('plant-1')).toBe(true)
    expect(toolCard()?.querySelector('b')?.textContent).toBe('Apple')
    expect(hud?.textContent).toContain('Apple')
    expect(hud?.textContent).toContain('Esc to clear the row')
    expect(hud?.textContent).not.toContain('Source selected')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(currentCanvasSelection.value).toEqual(new Set(['already-selected']))
    session.dispose()
  })

  it('preserves same-tool adapter state when selection refresh fails', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    let failSceneRead = false
    const baseDeps = createInteractionDeps(container, store, testView)
    baseDeps.setSelection([zoneTarget('missing-selection')])
    const deps: SceneInteractionSessionDeps = {
      ...baseDeps,
      getSceneStore: () => {
        if (failSceneRead) throw new Error('selection scene read failed')
        return store
      },
    }
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 })
    events.pointerUp({ x: 20, y: 30 })
    expect(rowSource('plant-1')).toBe(true)

    failSceneRead = true
    // Re-arming runs on the ToolHost, whose draft flush reads the scene for the selected zone's chips: its error, as thrown.
    expect(() => session.setTool('plant-spacing'))
      .toThrow('selection scene read failed')
    failSceneRead = false

    expect(rowSource('plant-1')).toBe(true)
    expect(toolCard()?.dataset.toolCard).toBe('plant-spacing')
    session.dispose()
  })

  it('explains Plant a row in the shared tool card, with no runtime card of its own', () => {
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)

    session.setTool('plant-spacing')

    expect(toolCard()!.dataset.toolCard).toBe('plant-spacing')
    expect(document.querySelectorAll('[data-tool-card]')).toHaveLength(1)
    expect(container.querySelector('[data-tool-card]')).toBeNull()
    expect(toolCard()!.textContent).toContain('Click a placed plant to repeat it along a row')
    session.dispose()
  })

  it('cleans up Plant Spacing source and preview when switching tools', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(rowSource('source')).toBe(true)
    expect(draftShapes('polyline')).toHaveLength(1)

    session.setTool('select')

    expect(toolCard()?.dataset.toolCard).toBe('select')
    expect(draftShapes('circle-px')).toHaveLength(0)
    expect(draftShapes('polyline')).toHaveLength(0)
    expect(draftShapes('ghost')).toHaveLength(0)

    session.setTool('plant-spacing')
    expect(spacingInput()).toBeNull()
    expect(draftShapes('circle-px')).toHaveLength(0)
    session.dispose()
  })

  it('removes Plant Spacing overlays on session dispose', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(spacingInput()).not.toBeNull()
    expect(draftShapes('polyline')).toHaveLength(1)

    session.dispose()

    // The session publishes idle guidance, so the card drops the spacing field.
    expect(spacingInput()).toBeNull()
    expect(draftShapes('circle-px')).toHaveLength(0)
    expect(draftShapes('polyline')).toHaveLength(0)
    expect(rowLength()).toBeUndefined()
    expect(draftShapes('ghost')).toHaveLength(0)
  })

  it('focuses Plant Spacing interval input after source sampling and accepts valid values with Enter', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)

    session.setTool('plant-spacing')
    const inputBeforeSource = spacingInput()
    expect(document.activeElement).not.toBe(inputBeforeSource)

    // A tap picks the source; its release focuses the spacing field.
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    expect(input.value).toBe('50 cm')
    expect(document.activeElement).toBe(input)

    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(spacingInput()!.getAttribute('aria-invalid')).toBe('false')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(document.activeElement).toBe(container)
    expect(store.persisted.plants).toHaveLength(1)
    expect(JSON.stringify(store.toCanopiFile())).not.toContain('plant_spacing_interval_m')
    expect(rowSource('plant-1')).toBe(true)
    session.dispose()
  })

  it('applies Plant Spacing interval blur without stealing focus from the next control', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const nextControl = document.createElement('button')
    document.body.appendChild(nextControl)
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    // A tap picks the source; its release focuses the spacing field.
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    nextControl.focus()
    input.dispatchEvent(new FocusEvent('blur'))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(document.activeElement).toBe(nextControl)
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('plant-1')).toBe(true)
    session.dispose()
    nextControl.remove()
  })

  it('keeps invalid Plant Spacing interval blur from stealing focus or mutating', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const nextControl = document.createElement('button')
    document.body.appendChild(nextControl)
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    nextControl.focus()
    input.dispatchEvent(new FocusEvent('blur'))

    expect(spacingInput()!.getAttribute('aria-invalid')).toBe('true')
    expect(plantSpacingIntervalM.value).toBe(0.5)
    expect(document.activeElement).toBe(nextControl)
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('plant-1')).toBe(true)
    session.dispose()
    nextControl.remove()
  })

  it('Plant a row: Esc mid-drag cancels the drag and keeps the source; the next Esc drops it, the third leaves the tool', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const setTool = vi.fn()
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, testView, { setTool, onSceneEditCommit }))
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 60, y: 30 }, { button: 0 })
    // The drag gives the map its focus back.
    expect(document.activeElement).toBe(container)

    events.keyDown({ key: 'Escape', target: container })
    expect(rowSource('source')).toBe(true)
    expect(setTool).not.toHaveBeenCalledWith('select')
    events.pointerUp({ x: 60, y: 30 }, { button: 0 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)

    events.keyDown({ key: 'Escape', target: container })
    expect(rowSource('source')).toBe(false)
    expect(setTool).not.toHaveBeenCalledWith('select')
    events.keyDown({ key: 'Escape', target: container })
    expect(setTool).toHaveBeenLastCalledWith('select')
    session.dispose()
  })

  it('Plant a row\'s preview stays put for the first 3 px, then follows the drag', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(rowSource('source')).toBe(true)

    events.pointerMove({ x: 22, y: 30 }, { button: 0 })
    expect(draftShapes('polyline')).toEqual([])

    events.pointerMove({ x: 60, y: 30 }, { button: 0 })
    const guideEnd = draftShapes('polyline')[0]?.points.at(-1)
    expect(guideEnd?.x).toBeCloseTo(60, 6)
    expect(guideEnd?.y).toBeCloseTo(30, 6)
    events.pointerUp({ x: 60, y: 30 }, { button: 0 })
    session.dispose()
  })

  it('handles Escape from the focused Plant Spacing interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    // A tap picks the source; its release focuses the spacing field.
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    expect(document.activeElement).toBe(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(draftShapes('circle-px')).toHaveLength(0)
    expect(spacingInput()).toBeNull()
    session.dispose()
  })

  it('lets Plant Spacing interval input bubble global shortcut keys', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    }))

    expect(onWindowKeyDown).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', onWindowKeyDown)
    session.dispose()
  })

  it('ignores Plant Spacing HUD pointerdowns while editing the interval input', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 26,
      clientY: 30,
      button: 0,
    }))

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(draftShapes('polyline')).toHaveLength(1)
    expect(rowSource('source')).toBe(true)
    session.dispose()
  })

  it('ignores Plant Spacing HUD pointermoves while editing the interval input', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = spacingInput()!
    const initialGuide = draftShapes('polyline')[0]!.points
    const initialLabel = rowLength()
    const initialGhostCount = draftShapes('ghost').length

    input.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 120,
      clientY: 30,
      button: 0,
    }))

    expect(draftShapes('polyline')[0]!.points).toEqual(initialGuide)
    expect(rowLength()).toBe(initialLabel)
    expect(draftShapes('ghost')).toHaveLength(initialGhostCount)
    session.dispose()
  })

  it('ignores Plant Spacing HUD pointerups during click-hold drag', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.dispatchEvent(new MouseEvent('pointerup', {
      bubbles: true,
      clientX: 120,
      clientY: 30,
      button: 0,
    }))

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('source')).toBe(true)
    session.dispose()
  })

  it('keeps Plant Spacing source alive for invalid interval input', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.value = '0'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(spacingInput()!.getAttribute('aria-invalid')).toBe('true')
    expect(plantSpacingIntervalM.value).toBe(0.5)
    expect(document.activeElement).toBe(input)
    expect(rowSource('plant-1')).toBe(true)
    session.dispose()
  })

  it('snaps Plant Spacing endpoint before computing preview and commit positions', () => {
    plantSpacingIntervalM.value = 2
    snapToGridEnabled.value = true
    testView.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 2, y: 4 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 40 }, { button: 0 })
    events.pointerMove({ x: 51, y: 40 }, { button: 0 })

    expect(draftShapes('ghost')).toHaveLength(2)

    events.pointerDown({ x: 51, y: 40 }, { button: 0 })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ])
    session.dispose()
  })

  it('keeps a Shift row on its 45 degree step, its length then snapped along it', () => {
    plantSpacingIntervalM.value = 1
    snapToGridEnabled.value = true
    testView.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 4, y: 4 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 71, y: 52 }, { button: 0, shiftKey: true })

    // Constrain first, then the length: level with the source, a whole number of grid intervals long.
    const interval = gridInterval(10).interval
    const end = 4 + Math.round(Math.hypot(3.1, 1.2) / interval) * interval
    const xs = Array.from({ length: Math.round(end - 4) }, (_, index) => 5 + index)
    expect(draftShapes('ghost')).toHaveLength(xs.length)

    events.pointerDown({ x: 71, y: 52 }, { button: 0, shiftKey: true })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual(xs.map(() => 4))
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual(xs)
    session.dispose()
  })

  it('clamps Plant Spacing endpoints outside the canvas to the visible edge', () => {
    plantSpacingIntervalM.value = 100
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 500, y: 30 }, { button: 0 })

    expect(rowLength()).toBe('380 m')

    events.pointerDown({ x: 500, y: 30 }, { button: 0 })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 120, y: 30 },
      { x: 220, y: 30 },
      { x: 320, y: 30 },
    ])
    session.dispose()
  })

  it('refreshes Plant Spacing preview after viewport changes', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    const guideOnScreen = (): number => {
      const [start, end] = draftShapes('polyline')[0]!.points
      const a = testView.view().worldToScreen(start!)
      const b = testView.view().worldToScreen(end!)
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    const widthBefore = guideOnScreen()
    const draftsBefore = drafts.calls.length

    // At the still pointer, where the host's re-emit and today's world-fixed endpoint agree (plan §1, exception 1).
    events.wheel({ x: 26, y: 30 }, { deltaY: -120, ctrlKey: true })

    expect(drafts.calls.length).toBeGreaterThan(draftsBefore)
    expect(rowLength()).toBe('6 m')
    expect(guideOnScreen()).not.toBe(widthBefore)
    session.dispose()
  })

  it('shows the plant tooltip and hover over moves held after a Plant a row press that missed', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 80, y: 30 }, { commonName: 'Apple' })]
    })
    const setHoveredTarget = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { setHoveredTarget })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    // The press finds no plant: no source, and today's miss ended the gesture (clearPointerGesture).
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    setHoveredTarget.mockClear()
    events.pointerMove({ x: 50, y: 30 }, { button: 0 })
    events.pointerMove({ x: 80, y: 30 }, { button: 0 })

    // The held moves ran today's hover: the restyle and the plant tooltip.
    expect(setHoveredTarget).toHaveBeenLastCalledWith(plantTarget('plant-1'))
    expect(plantHoverTooltip(container).style.display).toBe('block')
    events.pointerUp({ x: 80, y: 30 }, { button: 0 })
    expect(rowSource('plant-1')).toBe(false)
    session.dispose()
  })

  describe('a held press its tool keeps runs no hover', () => {
    const cases = [
      { name: 'a Select band drag from empty ground', tool: 'select', from: { x: 20, y: 30 } },
      { name: 'a Select move drag of a plant', tool: 'select', from: { x: 20, y: 30 }, pressedPlant: true },
      { name: 'a Text press on empty ground', tool: 'text', from: { x: 20, y: 30 } },
      { name: 'a Place plants press with a species chosen', tool: 'plant-stamp', from: { x: 20, y: 30 }, species: true },
    ] as const

    for (const c of cases) {
      it(`keeps the hover restyle and the plant tooltip off over the moves of ${c.name}`, () => {
        store.updatePersisted((draft) => {
          draft.plants = [
            ...('pressedPlant' in c ? [makePlant('plant-0', 'Pyrus communis', c.from, { commonName: 'Pear' })] : []),
            makePlant('plant-1', 'Malus domestica', { x: 120, y: 30 }, { commonName: 'Apple' }),
          ]
        })
        if ('species' in c) {
          selectPlantStampSource({ canonical_name: 'Pyrus communis', common_name: 'Pear', stratum: 'high', width_max_m: 4 })
        }
        const setHoveredTarget = vi.fn()
        const deps = createInteractionDeps(container, store, testView, { setHoveredTarget })
        const session = createTestSession(deps)
        session.setTool(c.tool)

        // Today's Select, Text and Place plants kept their pointer gesture: _updateHover never ran until the release.
        events.pointerDown(c.from, { button: 0 })
        setHoveredTarget.mockClear()
        events.pointerMove({ x: 70, y: 30 }, { button: 0 })
        events.pointerMove({ x: 120, y: 30 }, { button: 0 })

        expect(setHoveredTarget).not.toHaveBeenCalled()
        const tooltip = container.querySelector<HTMLElement>('[data-canvas-chrome="hover-tooltip"]')
        expect(tooltip?.style.display ?? 'none').not.toBe('block')
        events.pointerUp({ x: 120, y: 30 }, { button: 0 })
        session.dispose()
      })
    }
  })

  it('does not commit Plant Spacing from minor source-click pointer jitter', () => {
    plantSpacingIntervalM.value = 0.5
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 21, y: 30 }, { button: 0 })
    events.pointerUp({ x: 21, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('source')).toBe(true)
    session.dispose()
  })

  it('a Plant a row press that jitters inside the drag slop is a click: no row, and the field takes focus on its release', () => {
    plantSpacingIntervalM.value = 0.5
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const input = spacingInput()!
    events.pointerMove({ x: 22, y: 30 }, { button: 0 })

    expect(draftShapes('polyline')).toEqual([])
    // The field takes focus on the release of the press that picked the source, which a jitter leaves a click.
    expect(document.activeElement).not.toBe(input)
    events.pointerUp({ x: 22, y: 30 }, { button: 0 })
    expect(spacingInput()).toBe(input)
    expect(document.activeElement).toBe(input)

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('source')).toBe(true)
    session.dispose()
  })

  it('commits Plant Spacing from click-hold drag without focusing the interval input mid-drag', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const input = spacingInput()!
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(document.activeElement).not.toBe(input)
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(4)
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    session.dispose()
  })

  it('keeps source and focuses interval input after click-hold Plant Spacing drag with invalid interval', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    typeSpacing('0')
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(rowSource('source')).toBe(true)
    const input = spacingInput()
    expect(document.activeElement).toBe(input)
    session.dispose()
  })

  it('clears Plant Stamp source on session dispose without writing scene data', () => {
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')

    expect(readPlantStampSource()).not.toBeNull()
    session.dispose()

    expect(readPlantStampSource()).toBeNull()
    expect(store.persisted.plants).toHaveLength(0)
  })

  it('snaps plant-stamp placement to the grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m
    testView.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')

    // Screen (53,67) → world (13.25, 16.75) → snaps to (15, 15) at 5m interval
    events.pointerDown({ x: 53, y: 67 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 15, y: 15 })
    session.dispose()
  })

  it('returns to Select and reactivates the canvas after a native plant drop', async () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 30, y: 30 }),
      ]
    })
    const sourceControl = document.createElement('button')
    document.body.appendChild(sourceControl)
    sourceControl.focus()
    expect(document.activeElement).toBe(sourceControl)
    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { setTool })
    const session = createTestSession(deps)
    const originalFocus = container.focus.bind(container)
    let nativeDropInProgress = false
    const focusSpy = vi.spyOn(container, 'focus').mockImplementation((options?: FocusOptions) => {
      if (nativeDropInProgress) return
      originalFocus(options)
    })
    try {
      session.setTool('plant-stamp')
      const dragData = new Map<string, string>()
      const dataTransfer = {
        effectAllowed: 'none',
        setData(type: string, value: string) {
          dragData.set(type, value)
        },
        getData(type: string) {
          return dragData.get(type) ?? ''
        },
      }
      writePlantStampDragData(dataTransfer, {
        canonical_name: 'Pyrus communis',
        common_name: 'Pear',
        stratum: 'mid',
        width_max_m: 3,
      })

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(dropEvent, {
        clientX: { configurable: true, value: 120 },
        clientY: { configurable: true, value: 90 },
        dataTransfer: {
          configurable: true,
          value: dataTransfer,
        },
      })

      nativeDropInProgress = true
      try {
        container.dispatchEvent(dropEvent)
      } finally {
        nativeDropInProgress = false
      }
      const droppedPlant = store.persisted.plants.find((plant) => plant.id !== 'plant-1')

      expect(droppedPlant).toBeDefined()
      expect(currentCanvasSelection.value).toEqual(new Set([droppedPlant!.id]))
      expect(setTool).toHaveBeenCalledWith('select')
      expect(document.activeElement).toBe(sourceControl)
      await nextAnimationFrame()
      expect(document.activeElement).toBe(container)
      expect(focusSpy).toHaveBeenCalledTimes(2)

      sourceControl.focus()
      expect(document.activeElement).toBe(sourceControl)

      const firstDragPointerDown = events.pointerDown({ x: 120, y: 90 }, { button: 0 })
      expect(firstDragPointerDown.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(container)
      events.pointerMove({ x: 140, y: 100 }, { button: 0 })
      events.pointerUp({ x: 140, y: 100 }, { button: 0 })

      expect(store.persisted.plants.find((plant) => plant.id === droppedPlant!.id)?.position)
        .toEqual({ x: 140, y: 100 })
      expect(store.persisted.plants).toHaveLength(2)
    } finally {
      focusSpy.mockRestore()
      session.dispose()
      sourceControl.remove()
    }
  })

  it.each(['window blur', 'Session disposal'] as const)(
    'cancels deferred canvas refocus on %s after a native drop',
    async (interruption) => {
      const sourceControl = document.createElement('button')
      document.body.appendChild(sourceControl)
      const deps = createInteractionDeps(container, store, testView)
      const session = createTestSession(deps)
      const focusSpy = vi.spyOn(container, 'focus')
      try {
        session.setTool('plant-stamp')
        const dragData = new Map<string, string>()
        const dataTransfer = {
          effectAllowed: 'none',
          setData(type: string, value: string) {
            dragData.set(type, value)
          },
          getData(type: string) {
            return dragData.get(type) ?? ''
          },
        }
        writePlantStampDragData(dataTransfer, {
          canonical_name: 'Pyrus communis',
          common_name: 'Pear',
          stratum: 'mid',
          width_max_m: 3,
        })
        const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
        Object.defineProperties(dropEvent, {
          clientX: { configurable: true, value: 120 },
          clientY: { configurable: true, value: 90 },
          dataTransfer: { configurable: true, value: dataTransfer },
        })

        container.dispatchEvent(dropEvent)
        sourceControl.focus()
        if (interruption === 'window blur') events.windowBlur()
        else session.dispose()
        await nextAnimationFrame()

        expect(document.activeElement).toBe(sourceControl)
        expect(focusSpy).toHaveBeenCalledTimes(1)
      } finally {
        focusSpy.mockRestore()
        session.dispose()
        sourceControl.remove()
      }
    },
  )

  describe('Place plants without a species', () => {
    it('places nothing and asks the tool card to point to the species chooser', async () => {
      const published: CanvasToolGuidance[] = []
      const deps = createInteractionDeps(container, store, testView, {
        publishToolGuidance: (guidance) => { published.push(guidance) },
      })
      const session = createTestSession(deps)
      session.setTool('plant-stamp')
      expect(published.at(-1)?.promptSpecies).toBe(false)

      events.pointerDown({ x: 40, y: 40 })
      events.pointerUp({ x: 40, y: 40 })

      expect(store.persisted.plants).toHaveLength(0)
      expect(published.at(-1)?.promptSpecies).toBe(true)

      selectPlantStampSource({ canonical_name: 'Malus domestica', common_name: 'Apple', stratum: null, width_max_m: 6 })
      // The pick reaches Place plants through the session's read model after a microtask (spec §1.4).
      await Promise.resolve()
      events.pointerDown({ x: 40, y: 40 })
      events.pointerUp({ x: 40, y: 40 })

      expect(store.persisted.plants).toHaveLength(1)
      expect(published.at(-1)?.promptSpecies).toBe(false)
      session.dispose()
    })
  })

  describe('Place plants here (right-click on the empty map)', () => {
    const APPLE = { canonical_name: 'Malus domestica', common_name: 'Apple', stratum: null, width_max_m: 6 }

    it('arms Place plants and asks for a species, then places the chosen one at the right-clicked point', async () => {
      const published: CanvasToolGuidance[] = []
      const tools: string[] = []
      const deps = createInteractionDeps(container, store, testView, {
        publishToolGuidance: (guidance) => { published.push(guidance) },
        setTool: (name: string) => { tools.push(name) },
      })
      const session = createTestSession(deps)
      session.setTool('select')

      openContextMenu({ x: 120, y: 80 })
      expect(contextMenuHost.current?.selection).toBeNull()
      contextMenuCommand('place-plants-here').run()

      expect(tools.at(-1)).toBe('plant-stamp')
      expect(store.persisted.plants).toHaveLength(0)
      expect(published.at(-1)?.promptSpecies).toBe(true)

      selectPlantStampSource(APPLE)
      await Promise.resolve()

      expect(store.persisted.plants).toHaveLength(1)
      expect(store.persisted.plants[0]).toMatchObject({ canonicalName: 'Malus domestica', position: { x: 120, y: 80 } })
      expect(store.session.selectedTargets).toEqual([plantTarget(store.persisted.plants[0]!.id)])
      expect(published.at(-1)?.promptSpecies).toBe(false)

      // The pick is spent: choosing another species places nothing more.
      selectPlantStampSource({ ...APPLE, canonical_name: 'Pyrus communis' })
      await Promise.resolve()
      expect(store.persisted.plants).toHaveLength(1)
      session.dispose()
    })

    it('places the species already chosen at once', () => {
      selectPlantStampSource(APPLE)
      const session = createTestSession(createInteractionDeps(container, store, testView))
      session.setTool('plant-stamp')

      openContextMenu({ x: 60, y: 40 })
      contextMenuCommand('place-plants-here').run()

      expect(store.persisted.plants).toHaveLength(1)
      expect(store.persisted.plants[0]!.position).toEqual({ x: 60, y: 40 })
      session.dispose()
    })

    it('a waiting point is no Esc layer: Shift+Esc leaves nothing, and Esc leaves Place plants with the point (U35)', async () => {
      const tools: string[] = []
      const session = createTestSession(createInteractionDeps(container, store, testView, {
        setTool: (name: string) => { tools.push(name) },
      }))
      session.setTool('select')
      openContextMenu({ x: 30, y: 30 })
      contextMenuCommand('place-plants-here').run()
      expect(tools.at(-1)).toBe('plant-stamp')

      // As with no point waiting, leaving the tool takes an Esc with no modifier.
      events.keyDown({ key: 'Escape', shiftKey: true, target: container })
      expect(tools.at(-1)).toBe('plant-stamp')

      events.keyDown({ key: 'Escape', target: container })
      expect(tools.at(-1)).toBe('select')
      session.setTool('plant-stamp')
      selectPlantStampSource(APPLE)
      await Promise.resolve()
      expect(store.persisted.plants).toHaveLength(0)
      session.dispose()
    })

    it('forgets the point when the user leaves Place plants before choosing', async () => {
      const session = createTestSession(createInteractionDeps(container, store, testView))
      session.setTool('select')
      openContextMenu({ x: 30, y: 30 })
      contextMenuCommand('place-plants-here').run()

      session.setTool('select')
      session.setTool('plant-stamp')
      selectPlantStampSource(APPLE)
      await Promise.resolve()

      expect(store.persisted.plants).toHaveLength(0)
      session.dispose()
    })
  })

  it('a finger on Plant a row that jitters 5 px and lifts adds no row (A9)', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-spacing')
    const finger = { pointerType: 'touch', pointerId: 7, isPrimary: true }

    events.pointerDown({ x: 20, y: 30 }, { ...finger, button: 0, buttons: 1 })
    events.pointerMove({ x: 25, y: 30 }, { ...finger, button: -1, buttons: 1 })
    events.pointerUp({ x: 25, y: 30 }, { ...finger, button: 0, buttons: 0 })

    expect(store.persisted.plants.map((plant) => plant.id)).toEqual(['source'])
    session.dispose()
  })
})
