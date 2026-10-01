// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// the Object and saved stamps end to end through the session: Esc and `[` `]` through the keyboard port, the
// saved-stamp read model through the session's source bridge, and a Favorites drag over a held stamp. The stamp tools' own
// behaviour is tested through the ToolHarness in canvas/runtime/tools/{object-stamp,saved-object-stamp}.test.ts (0B-3 D4).
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  beginSavedObjectStampPlacement,
  clearSavedObjectStampDragSource,
  readSavedObjectStampSource,
  selectSavedObjectStampSourceForTests,
  writeSavedObjectStampDragData,
} from '../canvas/saved-object-stamp-source'
import type { CanvasToolCommandSurface } from '../canvas/runtime/runtime'
import type { CanvasToolGuidance } from '../canvas/session-state'
import { CameraController } from '../canvas/runtime/camera'
import type { DraftPresentation } from '../canvas/runtime/tools/draft'
import { SceneStore } from '../canvas/runtime/scene'
import type { SceneInteractionEventHarness } from './support/scene-interaction-events'
import {
  createInteractionDeps,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  /** A panel drag event over the map at a container point, carrying `data` (by default nothing of ours). */
  function dispatchDrag(type: 'dragover' | 'dragleave' | 'drop', at: { x: number, y: number }, data?: (transfer: DragDataLike) => void): void {
    const dragData = new Map<string, string>()
    const dataTransfer: DragDataLike = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() { return Array.from(dragData.keys()) },
      setData(format: string, value: string) { dragData.set(format, value) },
      getData(format: string) { return dragData.get(format) ?? '' },
    }
    data?.(dataTransfer)
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
    const point = events.clientPoint(at)
    Object.defineProperties(event, {
      clientX: { configurable: true, value: point.x },
      clientY: { configurable: true, value: point.y },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    container.dispatchEvent(event)
  }

  it('clears loaded Object Stamp source and returns to select on Escape', () => {
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
        position: { x: 40, y: 40 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })

    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const session = createTestSession(deps)
    session.setTool('object-stamp')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.keyDown({ key: 'Escape' })
    events.pointerDown({ x: 90, y: 90 }, { button: 0 })

    expect(setTool).toHaveBeenCalledWith('select')
    expect(store.persisted.plants).toHaveLength(1)
    session.dispose()
  })

  it('places a held saved stamp once, then returns to Select and drops the stamp', () => {
    selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [{
        id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, symbol: null,
        position: { x: 0, y: 0 }, rotationDeg: null, scale: null,
      }],
      zones: [],
      annotations: [],
      groups: [],
    })
    const setTool = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setTool })
    const session = createTestSession(deps)
    session.setTool('saved-object-stamp')

    events.pointerMove({ x: 100, y: 100 })
    events.pointerDown({ x: 100, y: 100 }, { button: 0 })
    events.pointerUp({ x: 100, y: 100 }, { button: 0 })

    expect(store.persisted.plants.map((plant) => plant.position)).toEqual([{ x: 100, y: 100 }])
    expect(setTool).toHaveBeenCalledWith('select')
    expect(readSavedObjectStampSource()).toBeNull()
    events.pointerDown({ x: 150, y: 150 }, { button: 0 })
    events.pointerUp({ x: 150, y: 150 }, { button: 0 })
    expect(store.persisted.plants).toHaveLength(1)
    session.dispose()
  })

  it('a Favorites drag over the map hides the held stamp\'s ghost until the pointer moves over the map again', () => {
    selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [{
        id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, symbol: null,
        position: { x: 0, y: 0 }, rotationDeg: null, scale: null,
      }],
      zones: [],
      annotations: [],
      groups: [],
    })
    const drafts: (DraftPresentation | null)[] = []
    const ghostAnchor = () => {
      const shape = drafts.at(-1)?.shapes.find((entry) => entry.kind === 'ghost')
      return shape?.kind === 'ghost' && shape.entity.kind === 'objects' ? shape.entity.anchor : null
    }
    const domGhost = () => container.querySelector('[data-saved-object-stamp-ghost]')
    const session = createTestSession({
      ...createInteractionDeps(container, store, camera),
      renderer: { setDraft: (draft) => { drafts.push(draft) }, setSelectionPreview: () => {} },
    })
    session.setTool('saved-object-stamp')
    events.pointerMove({ x: 100, y: 100 }, { buttons: 0 })
    expect(ghostAnchor()).toEqual({ x: 100, y: 100 })

    try {
      // Another saved stamp dragged from Favorites: its preview takes the held stamp's place, as today's one preview element.
      dispatchDrag('dragover', { x: 60, y: 60 }, (transfer) => writeSavedObjectStampDragData(transfer, PEAR_STAMP))
      expect(drafts.at(-1)).toBeNull()
      expect(domGhost()).not.toBeNull()
      dispatchDrag('dragleave', { x: 60, y: 60 })
      expect(drafts.at(-1)).toBeNull()
      expect(domGhost()).toBeNull()
      events.pointerMove({ x: 120, y: 120 }, { buttons: 0 })
      expect(ghostAnchor()).toEqual({ x: 120, y: 120 })

      // A drop that places nothing leaves the stamp armed: the next move shows its ghost again too.
      dispatchDrag('dragover', { x: 60, y: 60 })
      expect(drafts.at(-1)).toBeNull()
      dispatchDrag('drop', { x: 60, y: 60 })
      expect(drafts.at(-1)).toBeNull()
      expect(store.persisted.plants).toHaveLength(0)
      events.pointerMove({ x: 140, y: 140 }, { buttons: 0 })
      expect(ghostAnchor()).toEqual({ x: 140, y: 140 })
      events.pointerDown({ x: 140, y: 140 }, { button: 0 })
      events.pointerUp({ x: 140, y: 140 }, { button: 0 })
      expect(store.persisted.plants.map((plant) => plant.position)).toEqual([{ x: 140, y: 140 }])
    } finally {
      clearSavedObjectStampDragSource()
      session.dispose()
    }
  })

  it('choosing another saved stamp in Favorites hides the held stamp\'s turned ghost until the next move, which shows the new one upright', () => {
    selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [{
        id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, symbol: null,
        position: { x: 10, y: 0 }, rotationDeg: null, scale: null,
      }],
      zones: [],
      annotations: [],
      groups: [],
    })
    const drafts: (DraftPresentation | null)[] = []
    const ghost = () => {
      const shape = drafts.at(-1)?.shapes.find((entry) => entry.kind === 'ghost')
      if (shape?.kind !== 'ghost' || shape.entity.kind !== 'objects') return null
      const { anchor, rotationDeg, template } = shape.entity
      return { anchor, rotationDeg, plants: template.plants.map(({ entity }) => entity.canonicalName) }
    }
    const session = createTestSession({
      ...createInteractionDeps(container, store, camera),
      renderer: { setDraft: (draft) => { drafts.push(draft) }, setSelectionPreview: () => {} },
    })
    session.setTool('saved-object-stamp')
    events.pointerMove({ x: 100, y: 100 }, { buttons: 0 })
    events.keyDown({ key: ']', target: container })
    expect(ghost()).toEqual({ anchor: { x: 100, y: 100 }, rotationDeg: 15, plants: ['Malus domestica'] })

    // Favorites' click: the read model takes the stamp, then arms the tool again (today's setTool ran the cancellation).
    const commands = { setTool: (name: string) => session.setTool(name) } as CanvasToolCommandSurface
    expect(beginSavedObjectStampPlacement(PEAR_STAMP, commands)).toBe(true)
    expect(ghost()).toBeNull()

    events.pointerMove({ x: 120, y: 120 }, { buttons: 0 })
    expect(ghost()).toEqual({ anchor: { x: 120, y: 120 }, rotationDeg: 0, plants: ['Pyrus communis'] })
    session.dispose()
  })

  describe('stamp rotation', () => {
    function holdSavedStamp(): void {
      selectSavedObjectStampSourceForTests({
        version: 2,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple', color: null, symbol: null,
          position: { x: 10, y: 0 }, rotationDeg: null, scale: null,
        }],
        zones: [{
          id: 'zone-1', name: null, zoneType: 'rect', rotationDeg: 0, fillColor: null,
          points: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }],
        }],
        annotations: [{
          id: 'annotation-1', annotationType: 'text', position: { x: 0, y: 10 }, text: 'Mulch', fontSize: 16, rotationDeg: null,
        }],
        groups: [],
      })
    }

    function rotationSession(overrides: Parameters<typeof createInteractionDeps>[3] = {}) {
      const published: CanvasToolGuidance[] = []
      const deps = createInteractionDeps(container, store, camera, {
        publishToolGuidance: (guidance) => { published.push(guidance) },
        ...overrides,
      })
      return { session: createTestSession(deps), angle: () => published.at(-1)?.stampRotationDeg }
    }

    it('keeps ] and [ to the stamp while one is held, and leaves them to the shortcuts otherwise', () => {
      const bubbled = vi.fn()
      document.addEventListener('keydown', bubbled)
      try {
        const { session, angle } = rotationSession()
        session.setTool('object-stamp')
        // Nothing held yet: ] is still Bring to front.
        expect(events.keyDown({ key: ']', target: container }).defaultPrevented).toBe(false)
        expect(bubbled).toHaveBeenCalledOnce()

        store.updatePersisted((draft) => {
          draft.plants = [{
            kind: 'plant', locked: false, id: 'plant-1', canonicalName: 'Malus domestica', commonName: 'Apple',
            color: null, stratum: null, canopySpreadM: 2, position: { x: 50, y: 60 }, rotationDeg: null,
            notes: null, plantedDate: null, quantity: 1,
          }]
        })
        events.pointerDown({ x: 54, y: 63 }, { button: 0 })
        const held = events.keyDown({ key: ']', target: container })
        expect(held.defaultPrevented).toBe(true)
        expect(bubbled).toHaveBeenCalledOnce()
        expect(angle()).toBe(15)
        // Modified brackets and brackets typed in a field are not stamp turns.
        events.keyDown({ key: ']', ctrlKey: true, target: container })
        const field = document.createElement('input')
        container.appendChild(field)
        events.keyDown({ key: ']', target: field })
        expect(angle()).toBe(15)

        for (let turn = 0; turn < 5; turn += 1) events.keyDown({ key: ']', target: container })
        // The sampled plant was picked 4 m east and 3 m south of its centre; at 90° that offset turns too.
        events.pointerDown({ x: 100, y: 120 }, { button: 0 })
        expect(store.persisted.plants[1]?.position).toEqual({ x: 103, y: 116 })
        session.dispose()
      } finally {
        document.removeEventListener('keydown', bubbled)
      }
    })

    it('with single-key shortcuts off, turns the stamp only while the map has focus', () => {
      holdSavedStamp()
      const { session, angle } = rotationSession({ readSingleKeyShortcuts: () => false })
      session.setTool('saved-object-stamp')
      events.pointerMove({ x: 100, y: 100 }, { button: 0 })

      expect(events.keyDown({ key: ']' }).defaultPrevented).toBe(false)
      expect(angle()).toBe(0)
      events.keyDown({ key: ']', target: container })
      expect(angle()).toBe(15)
      session.dispose()
    })

    it('starts each new stamp upright', () => {
      holdSavedStamp()
      const { session, angle } = rotationSession()
      session.setTool('saved-object-stamp')
      events.keyDown({ key: ']', target: container })
      expect(angle()).toBe(15)
      holdSavedStamp()
      events.pointerMove({ x: 100, y: 100 }, { button: 0 })
      expect(angle()).toBe(0)
      session.setTool('select')
      expect(angle()).toBeNull()
      session.dispose()
    })
  })
})

/** A saved stamp record as Favorites drags it. */
const PEAR_STAMP = {
  id: 'stamp-pear',
  name: 'Pear',
  sort_order: 0,
  created_at: '2026-06-19T09:00:00Z',
  updated_at: '2026-06-19T09:00:00Z',
  payload_json: JSON.stringify({
    version: 2,
    anchor: { x: 0, y: 0 },
    plants: [{
      id: 'plant-1', canonicalName: 'Pyrus communis', commonName: 'Pear', color: null, symbol: null,
      position: { x: 0, y: 0 }, rotationDeg: null,
    }],
    zones: [],
    annotations: [],
    groups: [],
  }),
}

interface DragDataLike {
  effectAllowed: string
  dropEffect: string
  readonly types: readonly string[]
  setData(format: string, value: string): void
  getData(format: string): string
}
