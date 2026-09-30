// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm Plant stamp or Plant a row, and the three Place plants describes.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'
import {
  selectedObjectIds,
  setCanvasToolGuidance,
  type CanvasToolGuidance,
} from '../canvas/session-state'
import { snapToGridEnabled } from '../app/canvas-settings/signals'
import { plantSpacingIntervalM } from '../app/settings/state'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import type { SceneInteractionSessionDeps } from '../canvas/runtime/scene-interaction'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './support/scene-interaction-events'
import {
  createPlantPresentationContext,
  contextMenuHost,
  contextMenuCommand,
  createInteractionDeps,
  plantTarget,
  zoneTarget,
  nextAnimationFrame,
  makePlant,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const {
    createTestSession,
    toolCard,
    spacingInput,
    typeSpacing,
    openContextMenu,
  } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('refreshes Plant Spacing translations without resetting its phase, interval, count, or field', () => {
    let language = 'en'
    const translate = (key: string, options?: Readonly<Record<string, unknown>>): string =>
      `${language}:${key}${options?.count === undefined ? '' : `:${String(options.count)}`}`
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('source', 'Malus domestica', { x: 20, y: 30 })]
    })
    const published: CanvasToolGuidance[] = []
    const deps = createInteractionDeps(container, store, camera, {
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
    const ghostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length
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
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(ghostCount)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
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
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
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

    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    expect(toolCard()?.querySelector('b')?.textContent).toBe('Apple')
    expect(hud?.textContent).toContain('Apple')
    expect(hud?.textContent).toContain('Esc to cancel')
    expect(hud?.textContent).not.toContain('Source selected')
    expect(hud?.textContent).not.toContain('Plant Spacing')
    expect(hud?.querySelector('button')).toBeNull()
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(selectedObjectIds.value).toEqual(new Set(['already-selected']))
    session.dispose()
  })

  it('preserves same-tool adapter state when selection refresh fails', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    let failSceneRead = false
    const baseDeps = createInteractionDeps(container, store, camera)
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
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    failSceneRead = true
    expect(() => session.setTool('plant-spacing'))
      .toThrow('Scene Interaction tool transition failed')
    failSceneRead = false

    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    expect(toolCard()?.dataset.toolCard).toBe('plant-spacing')
    session.dispose()
  })

  it('explains Plant a row in the shared tool card, with no runtime card of its own', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)

    session.setTool('plant-spacing')

    expect(toolCard()!.dataset.toolCard).toBe('plant-spacing')
    expect(document.querySelectorAll('[data-tool-card]')).toHaveLength(1)
    expect(container.querySelector('[data-tool-card]')).toBeNull()
    expect(toolCard()!.textContent).toContain('Click a placed plant to repeat it along a row')
    session.dispose()
  })

  it('keeps Plant Spacing in source-picking mode on missed clicks without clearing selection', () => {
    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection([plantTarget('already-selected')])
    vi.mocked(deps.setSelection).mockClear()
    vi.mocked(deps.clearSelection).mockClear()
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 200, y: 200 }, { button: 0 })

    expect(spacingInput()).toBeNull()
    expect(toolCard()?.textContent).toContain('Click a visible, unlocked placed plant')
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(deps.clearSelection).not.toHaveBeenCalled()
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(selectedObjectIds.value).toEqual(new Set(['already-selected']))
    session.dispose()
  })

  it('does not sample grouped or locked Plant Spacing source candidates', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        {
          kind: 'plant',
          id: 'grouped-plant',
          locked: false,
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 20, y: 30 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
        {
          kind: 'plant',
          id: 'locked-plant',
          locked: true,
          canonicalName: 'Pyrus communis',
          commonName: 'Pear',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 80, y: 30 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Grouped row',
        members: [{ kind: 'plant', id: 'grouped-plant' }],
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    events.pointerDown({ x: 80, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    session.dispose()
  })

  it('does not sample Plant Spacing sources on hidden or locked plant layers', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: false, locked: false } : layer
      )
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, visible: true, locked: true } : layer
      )
    })

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    session.dispose()
  })

  it('clears Plant Spacing source state with Escape and exits when no source exists', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()

    events.keyDown({ key: 'Escape' })
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(spacingInput()).toBeNull()
    expect(setTool).not.toHaveBeenCalled()

    events.keyDown({ key: 'Escape' })
    expect(setTool).toHaveBeenCalledWith('select')
    expect(toolCard()?.dataset.toolCard).toBe('select')
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()

    session.setTool('select')

    expect(toolCard()?.dataset.toolCard).toBe('select')
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)

    session.setTool('plant-spacing')
    expect(spacingInput()).toBeNull()
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    expect(spacingInput()).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()

    session.dispose()

    // The session publishes idle guidance, so the card drops the spacing field.
    expect(spacingInput()).toBeNull()
    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-length-label]')).toBeNull()
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)

    session.setTool('plant-spacing')
    const inputBeforeSource = spacingInput()
    expect(document.activeElement).not.toBe(inputBeforeSource)

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

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
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
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
        stratum: null,
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
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    input.value = '0,75m'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    nextControl.focus()
    input.dispatchEvent(new FocusEvent('blur'))

    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(document.activeElement).toBe(nextControl)
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
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
        stratum: null,
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
    const deps = createInteractionDeps(container, store, camera)
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
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    session.dispose()
    nextControl.remove()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    const input = spacingInput()!
    expect(document.activeElement).toBe(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
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
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    const input = spacingInput()!
    const guide = container.querySelector<HTMLElement>('[data-plant-spacing-guide]')!
    const label = container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')!
    const initialGuideWidth = guide.style.width
    const initialLabel = label.textContent
    const initialGhostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length

    input.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 120,
      clientY: 30,
      button: 0,
    }))

    expect(guide.style.width).toBe(initialGuideWidth)
    expect(label.textContent).toBe(initialLabel)
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(initialGhostCount)
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
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
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
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
    expect(container.querySelector('[data-plant-spacing-source="plant-1"]')).not.toBeNull()
    session.dispose()
  })

  it('previews and commits a normal Plant Spacing sequence as one scene edit', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#884422',
        stratum: 'tree',
        canopySpreadM: 3,
        position: { x: 20, y: 30 },
        rotationDeg: 15,
        notes: 'Do not copy',
        plantedDate: '2026-03-01',
        quantity: 4,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    events.pointerMove({ x: 26, y: 30 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)
    const ghost = container.querySelector<HTMLElement>('[data-plant-spacing-ghost]')!
    expect(Number.parseFloat(ghost.style.width)).toBeCloseTo(4.43, 2)
    expect(Number.parseFloat(ghost.style.height)).toBeCloseTo(4.43, 2)
    expect(toolCard()?.textContent).toContain('3')

    events.pointerDown({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(4)
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    expect(store.persisted.plants[1]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#884422',
      stratum: 'tree',
      canopySpreadM: 3,
      rotationDeg: 15,
      notes: null,
      plantedDate: null,
      quantity: 1,
    })
    expect(store.persisted.groups).toEqual([])
    expect(selectedObjectIds.value).toEqual(new Set(store.persisted.plants.map((plant) => plant.id)))
    expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
    expect(spacingInput()).toBeNull()
    session.dispose()
  })

  it('does not commit Plant Spacing when the sampled source becomes unavailable before commit', () => {
    const runBlockedCommit = (blockCommit: () => void, expectedPlantCount = 1): void => {
      store = new SceneStore()
      plantSpacingIntervalM.value = 2
      store.updatePersisted((draft) => {
        draft.plants = [{
          kind: 'plant',
          id: 'source',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 20, y: 30 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
          locked: false,
        }]
      })
      const onSceneEditCommit = vi.fn()
      const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
      const session = createTestSession(deps)
      session.setTool('plant-spacing')
      events.pointerDown({ x: 20, y: 30 }, { button: 0 })
      events.pointerMove({ x: 26, y: 30 }, { button: 0 })

      blockCommit()
      events.pointerDown({ x: 26, y: 30 }, { button: 0 })

      expect(onSceneEditCommit).not.toHaveBeenCalled()
      expect(store.persisted.plants).toHaveLength(expectedPlantCount)
      expect(container.querySelector('[data-plant-spacing-guide]')).toBeNull()
      expect(container.querySelector('[data-plant-spacing-source]')).toBeNull()
      expect(spacingInput()).toBeNull()
      expect(toolCard()?.textContent).toContain('Click a visible, unlocked placed plant')
      session.dispose()
    }

    runBlockedCommit(function lockSourcePlant() {
      store.updatePersisted((draft) => {
        draft.plants = draft.plants.map((plant) =>
          plant.id === 'source' ? { ...plant, locked: true } : plant,
        )
      })
    })
    runBlockedCommit(function removeSourcePlant() {
      store.updatePersisted((draft) => {
        draft.plants = []
      })
    }, 0)
    runBlockedCommit(function lockPlantsLayer() {
      store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) =>
          layer.name === 'plants' ? { ...layer, locked: true } : layer
        )
      })
    })
    runBlockedCommit(function hidePlantsLayer() {
      store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) =>
          layer.name === 'plants' ? { ...layer, visible: false } : layer
        )
      })
    })
  })

  it('caps dense Plant Spacing preview ghosts while keeping the generated count', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 22, y: 30 }, { button: 0 })

    expect(toolCard()?.textContent).toContain('2000')
    const ghostCount = container.querySelectorAll('[data-plant-spacing-ghost]').length
    expect(ghostCount).toBeGreaterThan(0)
    expect(ghostCount).toBeLessThan(2000)
    session.dispose()
  })

  it('blocks Plant Spacing commits above the hard safety cap without creating plants', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 20, y: 10 }, { button: 0 })

    const count = toolCard()!.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(count.textContent).toContain('10000')
    expect(count.dataset.density).toBe('blocked')

    events.pointerDown({ x: 20, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    expect(toolCard()?.textContent).toContain(
      'Increase interval or shorten the line',
    )
    session.dispose()
  })

  it('commits Plant Spacing at the hard safety cap without confirmation', () => {
    plantSpacingIntervalM.value = 0.001
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 15, y: 10 }, { button: 0 })

    const count = toolCard()!.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(count.textContent).toContain('5000')
    expect(count.dataset.density).toBe('dense')
    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()

    events.pointerDown({ x: 15, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(5001)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 15, y: 10 })
    session.dispose()
  })

  it('sizes Plant Spacing preview ghosts from the symbolic plant presentation', () => {
    plantSpacingIntervalM.value = 2
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 4,
        position: { x: 2, y: 3 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getPlantPresentationContext: createPlantPresentationContext,
    })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 60, y: 30 }, { button: 0 })

    const ghosts = container.querySelectorAll<HTMLElement>('[data-plant-spacing-ghost]')
    expect(ghosts).toHaveLength(2)
    expect(parseFloat(ghosts[0]?.style.width ?? '')).toBeCloseTo(7.0645, 4)
    expect(parseFloat(ghosts[0]?.style.height ?? '')).toBeCloseTo(7.0645, 4)

    events.wheel({ x: 0, y: 0 }, { deltaY: -120, ctrlKey: true })

    const resizedGhost = container.querySelector<HTMLElement>('[data-plant-spacing-ghost]')!
    expect(parseFloat(resizedGhost.style.width)).not.toBeCloseTo(7.0645, 4)
    expect(parseFloat(resizedGhost.style.height)).not.toBeCloseTo(7.0645, 4)
    session.dispose()
  })

  it('keeps Plant Spacing preview active without a scene edit when no plants fit', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 21, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('1 m')
    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(0)

    events.pointerDown({ x: 21, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-guide]')).not.toBeNull()
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
    session.dispose()
  })

  it('formats a zero-length Plant Spacing guide as 0 cm while preserving the interval input fallback', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 20, y: 30 }, { button: 0 })

    expect(spacingInput()?.value).toBe('50 cm')
    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('0 cm')
    expect(toolCard()!.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')?.textContent).toContain('0')
    session.dispose()
  })

  it('snaps Plant Spacing endpoint before computing preview and commit positions', () => {
    plantSpacingIntervalM.value = 2
    snapToGridEnabled.value = true
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 2, y: 4 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 40 }, { button: 0 })
    events.pointerMove({ x: 51, y: 40 }, { button: 0 })

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(2)

    events.pointerDown({ x: 51, y: 40 }, { button: 0 })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 4, y: 4 },
      { x: 6, y: 4 },
    ])
    session.dispose()
  })

  it('gives Shift direction constraint priority over Plant Spacing snapping', () => {
    plantSpacingIntervalM.value = 1
    snapToGridEnabled.value = true
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 4, y: 4 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 71, y: 52 }, { button: 0, shiftKey: true })

    expect(container.querySelectorAll('[data-plant-spacing-ghost]')).toHaveLength(3)

    events.pointerDown({ x: 71, y: 52 }, { button: 0, shiftKey: true })
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual([4, 4, 4])
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual([5, 6, 7])
    session.dispose()
  })

  it('commits a Plant Spacing click-hold drag from the latest Shift-constrained preview endpoint', () => {
    plantSpacingIntervalM.value = 1
    camera.setViewport({ x: 0, y: 0, scale: 10 })
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 4, y: 4 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 71, y: 52 }, { button: 0, shiftKey: true })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-guide]')?.style.transform).toBe('rotate(0rad)')

    events.pointerUp({ x: 71, y: 52 }, { button: 0, shiftKey: false })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.y)).toEqual([4, 4, 4])
    expect(store.persisted.plants.slice(1).map((plant) => plant.position.x)).toEqual([5, 6, 7])
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 500, y: 30 }, { button: 0 })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('380 m')

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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    const guide = container.querySelector<HTMLElement>('[data-plant-spacing-guide]')!
    const widthBefore = guide.style.width

    events.wheel({ x: 0, y: 0 }, { deltaY: -120, ctrlKey: true })

    expect(container.querySelector<HTMLElement>('[data-plant-spacing-length-label]')?.textContent).toBe('6 m')
    expect(guide.style.width).not.toBe(widthBefore)
    session.dispose()
  })

  it('commits exactly 100 generated Plant Spacing plants without confirmation', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 110, y: 10 }, { button: 0 })
    events.pointerDown({ x: 110, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(101)
    session.dispose()
  })

  it('emphasizes dense Plant Spacing counts and commits them directly', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 111, y: 10 }, { button: 0 })

    const count = toolCard()!.querySelector<HTMLElement>('[data-plant-spacing-generated-count]')!
    expect(toolCard()!.textContent).toContain('101')
    expect(toolCard()!.textContent).not.toContain('Confirm')
    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(container.querySelector('[data-plant-spacing-cancel-confirm]')).toBeNull()
    expect(count.dataset.density).toBe('dense')

    events.pointerDown({ x: 111, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(102)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 111, y: 10 })
    session.dispose()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 21, y: 30 }, { button: 0 })
    events.pointerUp({ x: 21, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
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

  it('commits Plant Spacing click-hold drag from the pointerup endpoint when release moves past the preview', () => {
    plantSpacingIntervalM.value = 2
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 25, y: 30 }, { button: 0 })
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants.slice(1).map((plant) => plant.position)).toEqual([
      { x: 22, y: 30 },
      { x: 24, y: 30 },
      { x: 26, y: 30 },
    ])
    session.dispose()
  })

  it('commits dense Plant Spacing from click-hold drag directly', () => {
    plantSpacingIntervalM.value = 1
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        locked: false,
        id: 'source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: null,
        stratum: null,
        canopySpreadM: 2,
        position: { x: 10, y: 10 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 111, y: 10 }, { button: 0 })
    events.pointerUp({ x: 111, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-plant-spacing-confirm]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-plant-spacing')
    expect(store.persisted.plants).toHaveLength(102)
    expect(store.persisted.plants[store.persisted.plants.length - 1]?.position).toEqual({ x: 111, y: 10 })
    expect(spacingInput()).toBeNull()
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
        stratum: null,
        canopySpreadM: 2,
        position: { x: 20, y: 30 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('plant-spacing')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    typeSpacing('0')
    events.pointerMove({ x: 26, y: 30 }, { button: 0 })
    events.pointerUp({ x: 26, y: 30 }, { button: 0 })

    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(store.persisted.plants).toHaveLength(1)
    expect(container.querySelector('[data-plant-spacing-source="source"]')).not.toBeNull()
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

    const session = createTestSession(createInteractionDeps(container, store, camera))
    session.setTool('plant-stamp')

    expect(readPlantStampSource()).not.toBeNull()
    session.dispose()

    expect(readPlantStampSource()).toBeNull()
    expect(store.persisted.plants).toHaveLength(0)
  })

  it('snaps plant-stamp placement to the grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    selectPlantStampSource({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    const session = createTestSession(createInteractionDeps(container, store, camera))
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
    const deps = createInteractionDeps(container, store, camera, { setTool })
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
      expect(selectedObjectIds.value).toEqual(new Set([droppedPlant!.id]))
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
      const deps = createInteractionDeps(container, store, camera)
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
      const deps = createInteractionDeps(container, store, camera, {
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
      const deps = createInteractionDeps(container, store, camera, {
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
      const session = createTestSession(createInteractionDeps(container, store, camera))
      session.setTool('plant-stamp')

      openContextMenu({ x: 60, y: 40 })
      contextMenuCommand('place-plants-here').run()

      expect(store.persisted.plants).toHaveLength(1)
      expect(store.persisted.plants[0]!.position).toEqual({ x: 60, y: 40 })
      session.dispose()
    })

    it('forgets the point when the user leaves Place plants before choosing', async () => {
      const session = createTestSession(createInteractionDeps(container, store, camera))
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
})
