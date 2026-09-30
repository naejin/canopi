import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubTool, useStubTools } from '../../__tests__/support/tool-harness'
import { createInteractionDeps, makePlant, plantTarget } from '../../__tests__/support/scene-interaction-setup'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from '../../__tests__/support/scene-interaction-events'
import { createTestView } from '../../__tests__/support/test-view'
import { clearPlantStampSource, readPlantStampSource, selectPlantStampSource } from '../plant-stamp-source'
import {
  clearSavedObjectStampSource,
  readSavedObjectStampDragPreviewSource,
  writeSavedObjectStampDragData,
} from '../saved-object-stamp-source'
import { setCanvasTool } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import type { InputPlatform } from './input/platform'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from './interaction-session'
import type { CameraController } from './camera'
import { SceneStore } from './scene'
import type { DraftPresentation } from './tools/draft'
import type { ToolSource } from './tools/tool'

vi.mock('./tools/registry', () => ({ TOOL_REGISTRY: {} }))

const PLATFORM: InputPlatform = { os: 'linux', engine: 'webkitgtk', gestureEvents: false }
const SPECIES = { canonical_name: 'Malus domestica', common_name: 'Apple', stratum: 'mid', width_max_m: 4 }
const SAVED_STAMP_MIME = 'application/x.canopi.saved-object-stamp+json'

let container: HTMLDivElement
let events: SceneInteractionEventHarness
let camera: CameraController
let store: SceneStore
let sessions: SceneInteractionSession[]

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  events = createSceneInteractionEventHarness(container)
  camera = createTestView({ screen: { width: 400, height: 300 }, viewport: { x: 0, y: 0, scale: 1 } }).legacyCamera
  store = new SceneStore()
  sessions = []
  clearPlantStampSource()
  clearSavedObjectStampSource()
})

afterEach(() => {
  for (const session of sessions.splice(0).reverse()) session.dispose()
  events.dispose()
  container.remove()
  useStubTools()
  setCanvasTool('select')
  document.documentElement.removeAttribute('data-story-presenting')
  clearPlantStampSource()
  clearSavedObjectStampSource()
})

function recordingRenderer() {
  const drafts: (DraftPresentation | null)[] = []
  return {
    drafts,
    lastDraft: () => drafts.at(-1) ?? null,
    setDraft: (draft: DraftPresentation | null) => { drafts.push(draft) },
    setSelectionPreview: () => {},
  }
}

function createSession(overrides: Partial<SceneInteractionSessionDeps> = {}): { session: SceneInteractionSession, deps: SceneInteractionSessionDeps } {
  const deps: SceneInteractionSessionDeps = { ...createInteractionDeps(container, store, camera), platform: PLATFORM, ...overrides }
  const session = createSceneInteractionSession(deps)
  sessions.push(session)
  return { session, deps }
}

/** The microtask after a species pick (the plant source reaches the tool once the picker's own update is done). */
async function afterPick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('the interaction session', () => {
  it('a registered armed tool\'s input goes to the host and a bridged one\'s to the bridge', () => {
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()

    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 20 })
    events.pointerMove({ x: 80, y: 60 })
    events.pointerUp({ x: 80, y: 60 })
    // The host's tool drew it; the legacy rectangle adapter never ran.
    expect(rectangle.gestures.map((gesture) => gesture.kind)).toEqual(['press', 'drag-start', 'drag-end'])
    expect(store.persisted.zones).toHaveLength(0)

    session.setTool('ellipse')
    events.pointerDown({ x: 120, y: 120 })
    events.pointerMove({ x: 180, y: 160 })
    events.pointerUp({ x: 180, y: 160 })
    // Ellipse is not registered: today's adapter on the bridge made the zone, and the host's tool heard nothing more.
    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]?.zoneType).toBe('ellipse')
    expect(rectangle.gestures).toHaveLength(3)
    expect(rectangle.calls).toContain('deactivate:switch')
  })

  it('every raw pointerdown on the map host reaches rawPress before it is routed', () => {
    const order: string[] = []
    const select = stubTool('select', {
      gesture: (gesture) => {
        if (gesture.kind === 'press') order.push('press')
        return 'pass'
      },
    })
    useStubTools(select)
    const focus: CanvasFocusPort = {
      focusMap: vi.fn(() => { order.push('focus') }),
      focusToolCardField: vi.fn(),
    }
    const nudge = { nudgeSelected: vi.fn(() => true), endNudge: vi.fn() }
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 200, y: 200 })]
    })
    const { deps } = createSession({ focus, nudge })
    deps.setSelection([plantTarget('plant-1')])
    container.focus()
    events.keyDown({ key: 'ArrowRight', target: container })
    expect(nudge.nudgeSelected).toHaveBeenCalledOnce()

    // A right press never reaches the host as a gesture, yet it commits the nudge series.
    events.pointerDown({ x: 10, y: 10 }, { button: 2 })
    events.pointerUp({ x: 10, y: 10 }, { button: 2 })
    expect(nudge.endNudge).toHaveBeenCalledExactlyOnceWith()
    expect(focus.focusMap).not.toHaveBeenCalled()

    // A middle press pans, and still moves focus to the map.
    events.pointerDown({ x: 10, y: 10 }, { button: 1 })
    events.pointerUp({ x: 10, y: 10 }, { button: 1 })
    expect(focus.focusMap).toHaveBeenCalledExactlyOnceWith('tool-requested')
    expect(select.count('press')).toBe(0)

    order.length = 0
    events.pointerDown({ x: 30, y: 30 })
    expect(order).toEqual(['focus', 'press'])
  })

  it('a window blur feeds the recogniser, then calls interrupted', () => {
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 20 })
    events.pointerMove({ x: 60, y: 40 })
    rectangle.calls.length = 0
    events.windowBlur()
    // The recogniser ended the live drag (cancel 'blur'), then the host's interruption reached the tool.
    expect(rectangle.last('cancel')).toEqual({ kind: 'cancel', reason: 'blur' })
    expect(rectangle.calls).toEqual(['cancelTransient:navigate'])
    events.pointerUp({ x: 60, y: 40 })
    expect(rectangle.count('drag-end')).toBe(0)

    // Space held before the blur is released by it: the next primary drag draws instead of panning.
    events.holdSpace()
    events.windowBlur()
    const before = camera.viewport
    events.pointerDown({ x: 100, y: 100 })
    events.pointerMove({ x: 140, y: 120 })
    expect(rectangle.last('drag-start')).toBeDefined()
    expect(camera.viewport).toEqual(before)
  })

  it('the active tool\'s slop reaches configure', () => {
    const row = stubTool('plant-spacing', { dragSlopPx: 4 })
    useStubTools(row)
    const { session } = createSession()
    session.setTool('plant-spacing')

    events.pointerDown({ x: 100, y: 100 })
    events.pointerMove({ x: 103, y: 100 })
    expect(row.count('drag-start')).toBe(0)
    events.pointerMove({ x: 104, y: 100 })
    expect(row.count('drag-start')).toBe(1)
  })

  it('a plant source chosen while armed reaches sourceChanged', async () => {
    const sources: (ToolSource | null)[] = []
    const stamp = stubTool('plant-stamp', {
      activate: (_ctx, source) => { sources.push(source) },
      sourceChanged: (source) => { sources.push(source) },
    })
    useStubTools(stamp)
    const { session } = createSession()
    session.setTool('plant-stamp')
    expect(sources).toEqual([null])

    const chosen = selectPlantStampSource(SPECIES)
    // The pick reaches the tool after the chooser's own update (a microtask), as today's Place plants here.
    expect(stamp.calls).not.toContain('sourceChanged')
    await afterPick()
    expect(sources).toEqual([null, { kind: 'species', species: chosen }])

    // Armed again with a source, the tool gets it at activation.
    session.setTool('select')
    selectPlantStampSource(SPECIES)
    session.setTool('plant-stamp')
    expect(sources.at(-1)).toEqual({ kind: 'species', species: readPlantStampSource() })
  })

  it('leaving Place plants clears its source', () => {
    useStubTools(stubTool('plant-stamp'))
    const { session } = createSession()
    selectPlantStampSource(SPECIES)
    session.setTool('plant-stamp')
    expect(readPlantStampSource()).not.toBeNull()

    session.setTool('select')
    expect(readPlantStampSource()).toBeNull()
  })

  it('a presented story shows no draft or handles', async () => {
    const draft: DraftPresentation = {
      shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], style: { token: 'draft', widthPx: 2 } }],
    }
    const rectangle = stubTool('rectangle', {
      gesture: (gesture) => {
        if (gesture.kind === 'drag-move') rectangle.ctx().effects.setDraft(draft)
        return 'pass'
      },
    })
    useStubTools(rectangle)
    const renderer = recordingRenderer()
    const { session } = createSession({ renderer })
    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 20 })
    events.pointerMove({ x: 40, y: 40 })
    events.pointerMove({ x: 60, y: 60 })
    expect(renderer.lastDraft()).toEqual(draft)

    // Today's CSS hid every DOM preview while a story is presented (html[data-story-presenting]).
    document.documentElement.setAttribute('data-story-presenting', '')
    await Promise.resolve()
    expect(renderer.lastDraft()).toBeNull()
    events.pointerMove({ x: 80, y: 80 })
    expect(renderer.lastDraft()).toBeNull()

    document.documentElement.removeAttribute('data-story-presenting')
    await Promise.resolve()
    expect(renderer.lastDraft()).toEqual(draft)
  })

  it('a handled saved-stamp drop clears the drag source', () => {
    createSession()
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() { return Array.from(dragData.keys()) },
      setData(type: string, value: string) { dragData.set(type, value) },
      getData(type: string) { return dragData.get(type) ?? '' },
    }
    writeSavedObjectStampDragData(dataTransfer, {
      id: 'stamp-1',
      name: 'Apple',
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
      payload_json: JSON.stringify({
        version: 2,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          symbol: null,
          position: { x: 0, y: 0 },
          rotationDeg: null,
        }],
        zones: [],
        annotations: [],
        groups: [],
      }),
    })
    // During a drag the browser shows the drop target the type only: the preview reads the drag source.
    const hiddenData = { types: [SAVED_STAMP_MIME], getData: () => '' }
    expect(readSavedObjectStampDragPreviewSource(hiddenData)).not.toBeNull()

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    const point = events.clientPoint({ x: 120, y: 90 })
    Object.defineProperties(drop, {
      clientX: { configurable: true, value: point.x },
      clientY: { configurable: true, value: point.y },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    container.dispatchEvent(drop)

    expect(store.persisted.plants).toHaveLength(1)
    expect(readSavedObjectStampDragPreviewSource(hiddenData)).toBeNull()
  })
})
