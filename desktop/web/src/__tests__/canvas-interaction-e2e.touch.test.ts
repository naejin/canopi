// The canvas interaction end to end through the session with touch input (canvas v2 phase 3, spec §2.2 "Touch" and
// §3.4): the recogniser holds every touch press until 8 px, the lift or 500 ms, so a tap acts at the lift at the down
// point and a pinch never reaches a tool. Real tools, the real recogniser and the real DOM source, in jsdom.
// Shared fakes, helpers and fixture: support/canvas-interaction-setup.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectPlantStampSource } from '../canvas/plant-stamp-source'
import { currentCanvasSelection } from '../canvas/session-state'
import type { SceneStore } from '../canvas/runtime/scene'
import type { ScenePoint } from '../canvas/runtime/scene'
import type {
  SceneInteractionSession,
  SceneInteractionSessionDeps,
} from '../canvas/runtime/interaction-session'
import { createRecordingRenderer, type RecordingRenderer } from './support/recording-renderer'
import type { SceneInteractionEventHarness } from './support/canvas-interaction-events'
import type { TestView } from './support/test-view'
import {
  contextMenuHost,
  createInteractionDeps,
  installSceneInteractionFixture,
  makePlant,
  makeRectZone,
  plantTarget,
} from './support/canvas-interaction-setup'
import './support/camera-tolerance'

describe('SceneInteractionSession: touch', () => {
  let container: HTMLDivElement
  let testView: TestView
  let store: SceneStore
  let events: SceneInteractionEventHarness
  let renderer: RecordingRenderer

  const fixture = installSceneInteractionFixture(
    (f) => {
      ({ container, testView, store, events } = f)
    },
    () => ({ events }),
  )

  beforeEach(() => {
    renderer = createRecordingRenderer()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createTestSession(deps: SceneInteractionSessionDeps): SceneInteractionSession {
    return fixture.createTestSession({ ...deps, renderer })
  }

  /** A finger, as a browser sends it: pointerType touch, the primary button, contact while it moves. */
  const finger = (id: number, timeStamp?: number) => ({ pointerType: 'touch', pointerId: id, isPrimary: id === 1, timeStamp })
  const touchDown = (at: ScenePoint, id = 1, timeStamp?: number) => events.pointerDown(at, { ...finger(id, timeStamp), button: 0, buttons: 1 })
  const touchMove = (at: ScenePoint, id = 1, timeStamp?: number) => events.pointerMove(at, { ...finger(id, timeStamp), button: -1, buttons: 1 })
  const touchUp = (at: ScenePoint, id = 1, timeStamp?: number) => events.pointerUp(at, { ...finger(id, timeStamp), button: 0, buttons: 0 })

  /** Two fingers spread apart, then lifted: a pinch with nothing armed for it. */
  function pinch(first: ScenePoint, second: ScenePoint): void {
    touchDown(first, 1, 0)
    touchDown(second, 2, 40)
    touchMove({ x: first.x - 10, y: first.y }, 1, 60)
    touchMove({ x: second.x + 20, y: second.y }, 2, 70)
    touchMove({ x: first.x - 20, y: first.y }, 1, 80)
    touchMove({ x: second.x + 40, y: second.y }, 2, 90)
    touchUp({ x: second.x + 40, y: second.y }, 2, 100)
    touchUp({ x: first.x - 20, y: first.y }, 1, 110)
  }

  /** The polygon draft's corner markers. */
  function draftCorners(): number {
    return (renderer.lastDraft()?.shapes ?? []).filter((shape) => shape.kind === 'circle-px').length
  }

  function choosePlant(): void {
    selectPlantStampSource({ canonical_name: 'Malus domestica', common_name: 'Apple', stratum: 'high', width_max_m: 4 })
  }

  it('a touch tap with Plant stamp places one plant at the down point', () => {
    choosePlant()
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')

    // A rolling tap: the finger moves 5 px and lifts 4 px from where it landed, within the 8 px touch slop.
    touchDown({ x: 100, y: 100 })
    touchMove({ x: 104, y: 103 })
    touchUp({ x: 103, y: 104 })

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]!.position).toEqual({ x: 100, y: 100 })
    session.dispose()
  })

  it('a finger that slides past 8 px with Plant stamp places one plant at the press point', () => {
    choosePlant()
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')

    touchDown({ x: 100, y: 100 })
    expect(store.persisted.plants).toHaveLength(0)
    touchMove({ x: 112, y: 100 })
    touchUp({ x: 112, y: 100 })

    expect(store.persisted.plants.map((plant) => plant.position)).toEqual([{ x: 100, y: 100 }])
    session.dispose()
  })

  it('E13 a pinch with Plant stamp places nothing', () => {
    choosePlant()
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')
    const scale = testView.view().pixelsPerMetre

    pinch({ x: 100, y: 100 }, { x: 200, y: 100 })

    expect(store.persisted.plants).toHaveLength(0)
    // The fingers spread from 100 px to 160 px apart: the view zooms in by their ratio.
    expect(testView.view().pixelsPerMetre / scale).toBeCloseTo(1.6, 6)
    session.dispose()
  })

  it('E13 a pinch during a Polygon draft adds no corner', () => {
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('polygon')
    events.pointerDown({ x: 20, y: 20 }, { timeStamp: 0 })
    events.pointerUp({ x: 20, y: 20 }, { timeStamp: 10 })
    events.pointerDown({ x: 80, y: 20 }, { timeStamp: 1000 })
    events.pointerUp({ x: 80, y: 20 }, { timeStamp: 1010 })
    expect(draftCorners()).toBe(2)

    pinch({ x: 150, y: 150 }, { x: 250, y: 150 })

    expect(draftCorners()).toBe(2)
    expect(store.persisted.zones).toHaveLength(0)
    session.dispose()
  })

  it('E13 a pinch from empty ground with Select keeps the selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const deps = createInteractionDeps(container, store, testView)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1')])

    pinch({ x: 200, y: 200 }, { x: 300, y: 200 })

    expect(currentCanvasSelection.value).toEqual(new Set(['plant-1']))
    session.dispose()
  })

  it('E14 a long press with Plant stamp opens the menu at the finger and places nothing, the lift included', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    choosePlant()
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('plant-stamp')

    touchDown({ x: 100, y: 100 })
    vi.advanceTimersByTime(499)
    expect(contextMenuHost.current).toBeNull()
    vi.advanceTimersByTime(101)
    expect(contextMenuHost.current?.world).toEqual({ x: 100, y: 100 })
    touchMove({ x: 104, y: 100 })
    touchUp({ x: 104, y: 100 })

    expect(store.persisted.plants).toHaveLength(0)
    expect(contextMenuHost.opened).toHaveLength(1)
    session.dispose()
  })

  it('E14 a long press during a Polygon draft opens the menu and adds no corner', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('polygon')
    events.pointerDown({ x: 20, y: 20 }, { timeStamp: 0 })
    events.pointerUp({ x: 20, y: 20 }, { timeStamp: 10 })
    events.pointerDown({ x: 80, y: 20 }, { timeStamp: 1000 })
    events.pointerUp({ x: 80, y: 20 }, { timeStamp: 1010 })

    touchDown({ x: 150, y: 150 })
    vi.advanceTimersByTime(600)
    touchUp({ x: 150, y: 150 })

    expect(contextMenuHost.current).not.toBeNull()
    expect(draftCorners()).toBe(2)
    session.dispose()
  })

  it('a Text tap with a finger opens the note field focused at once, within the tap, so iOS shows its keyboard (A15)', () => {
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('text')

    touchDown({ x: 120, y: 90 })
    touchUp({ x: 121, y: 90 })

    const field = container.querySelector<HTMLTextAreaElement>('[data-canvas-text-entry]')
    expect(field).not.toBeNull()
    expect(document.activeElement).toBe(field)
    session.dispose()
  })

  it('blur during a pinch-twist keeps the view: the turn ends where it is, never restored (A6)', () => {
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('select')
    const at = (deg: number, sign: 1 | -1) => ({
      x: 200 + sign * 50 * Math.cos((deg * Math.PI) / 180),
      y: 150 + sign * 50 * Math.sin((deg * Math.PI) / 180),
    })

    touchDown(at(0, 1), 1, 0)
    touchDown(at(0, -1), 2, 10)
    touchMove(at(40, 1), 1, 20)
    touchMove(at(40, -1), 2, 30)
    const turned = testView.view().camera.bearingDeg
    expect(turned).toBeGreaterThan(300)
    expect(turned).toBeLessThan(353)

    events.windowBlur()

    expect(testView.view().camera.bearingDeg).toBeCloseTo(turned, 6)
    session.dispose()
  })

  it('a pinch out across the overview threshold keeps zooming to the fingers\' end', () => {
    // 0.12 px/m is just above overview (0.1 px/m): the pinch's first step enters it, and the camera publishes that frame mid-pinch.
    testView.setViewport({ x: 200, y: 150, scale: 0.12 })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('select')

    touchDown({ x: 100, y: 150 }, 1, 0)
    touchDown({ x: 300, y: 150 }, 2, 10)
    touchMove({ x: 140, y: 150 }, 1, 20)
    expect(testView.frames.viewFrame.peek().mode).toBe('overview')
    touchMove({ x: 260, y: 150 }, 2, 30)
    touchMove({ x: 150, y: 150 }, 1, 40)
    touchUp({ x: 150, y: 150 }, 1, 50)
    touchUp({ x: 260, y: 150 }, 2, 60)

    // 200 px apart to 110: the scale follows the fingers the whole way.
    expect(testView.viewport().scale).toBeCloseTo(0.12 * (110 / 200), 6)
    session.dispose()
  })

  it('a finger\'s tap on a polygon gives it 44 px handle boxes and dots on 132 px edges; a mouse move makes them 20 px again (Q1, Q2, Q4)', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone', locked: false, id: 'polygon-1', name: 'polygon-1', zoneType: 'polygon', rotationDeg: 0,
        points: [{ x: 40, y: 60 }, { x: 240, y: 60 }, { x: 240, y: 160 }, { x: 40, y: 160 }], fillColor: null, notes: null,
      }]
    })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('select')
    const box = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)].map((element) =>
      `${element.style.width}×${element.style.height}`)

    touchDown({ x: 140, y: 110 })
    touchUp({ x: 141, y: 111 })

    expect(currentCanvasSelection.value).toEqual(new Set(['polygon-1']))
    expect(box('[data-canvas-handle^="vertex:"]')).toEqual(['44px×44px', '44px×44px', '44px×44px', '44px×44px'])
    // The 200 px edges show their 44 px dots; the 100 px ones are under 132 px.
    expect(box('[data-canvas-handle^="edge-mid:"]')).toEqual(['44px×44px', '44px×44px'])
    const rotate = container.querySelector<HTMLElement>('[data-canvas-handle="rotate"]')!
    expect(`${rotate.style.width}×${rotate.style.height}`).toBe('44px×44px')
    expect((rotate.firstElementChild as HTMLElement).style.width).toBe('28px')

    events.pointerMove({ x: 300, y: 250 }, { pointerType: 'mouse', buttons: 0 })

    expect(box('[data-canvas-handle^="vertex:"]')).toEqual(['20px×20px', '20px×20px', '20px×20px', '20px×20px'])
    expect(box('[data-canvas-handle^="edge-mid:"]')).toEqual(['16px×16px', '16px×16px', '16px×16px', '16px×16px'])
    expect(rotate.style.width).toBe('28px')
    session.dispose()
  })

  it('a long press 15 px from a rectangle\'s edge offers Turn view to this edge (A11)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [{ x: 40, y: 60 }, { x: 240, y: 60 }, { x: 240, y: 160 }, { x: 40, y: 160 }])]
    })
    const session = createTestSession(createInteractionDeps(container, store, testView))
    session.setTool('select')

    touchDown({ x: 140, y: 45 })
    vi.advanceTimersByTime(600)
    touchUp({ x: 140, y: 45 })

    expect(contextMenuHost.current?.turnViewToEdge).toBeTypeOf('function')
    session.dispose()
  })
})
