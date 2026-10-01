import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubTool, useStubTools, type StubTool } from '../../__tests__/support/tool-harness'
import {
  captureWindowErrors,
  contextMenuHost,
  createInteractionDeps,
  dispatchContextMenu,
  makePlant,
  plantTarget,
} from '../../__tests__/support/scene-interaction-setup'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from '../../__tests__/support/scene-interaction-events'
import { createTestView } from '../../__tests__/support/test-view'
import {
  clearPlantStampSource,
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../plant-stamp-source'
import {
  clearSavedObjectStampSource,
  readSavedObjectStampDragPreviewSource,
  selectSavedObjectStampSourceForTests,
  writeSavedObjectStampDragData,
} from '../saved-object-stamp-source'
import { setCanvasTool } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import { createRulerOverlay, type RulerOverlay } from './chrome/rulers'
import type { InputPlatform } from './input/platform'
import type { ToolHost, ToolHostDeps } from './interaction-ports'
import type { SceneToolAdapter } from './interaction/tool-adapter'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from './interaction-session'
import type { CameraController, CameraViewportSnapshot } from './camera'
import { SceneStore } from './scene'
import type { SceneEditTransaction } from './scene-runtime/transactions'
import type { DraftPresentation } from './tools/draft'
import type { ToolSource } from './tools/tool'
import type { WorldPoint } from './view/types'

vi.mock('./tools/registry', () => ({ TOOL_REGISTRY: {} }))

/** The legacy bridge's adapters while a test stubs them; with none set, interaction/tool-modules.ts builds its own. */
const bridgeAdapters = vi.hoisted(() => new Map<string, SceneToolAdapter>())
vi.mock('./interaction/tool-modules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./interaction/tool-modules')>()
  return {
    ...actual,
    createSceneToolRegistry: (context: Parameters<typeof actual.createSceneToolRegistry>[0]) => {
      if (bridgeAdapters.size === 0) return actual.createSceneToolRegistry(context)
      let active: SceneToolAdapter | null = null
      return {
        get activeAdapter() { return active },
        select: (name: string) => (active = bridgeAdapters.get(name) ?? null),
        forEachAdapter: (visit: (adapter: SceneToolAdapter) => void) => bridgeAdapters.forEach((adapter) => visit(adapter)),
      }
    },
  }
})

/** Each ToolHost the sessions build, so a test can watch the calls the session makes on it. */
const builtHosts = vi.hoisted(() => [] as ToolHost[])
vi.mock('./tools/tool-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools/tool-host')>()
  return {
    ...actual,
    createToolHost: (deps: ToolHostDeps) => {
      const host = actual.createToolHost(deps)
      builtHosts.push(host)
      return host
    },
  }
})

const PLATFORM: InputPlatform = { os: 'linux', engine: 'webkitgtk', gestureEvents: false }
const SPECIES = { canonical_name: 'Malus domestica', common_name: 'Apple', stratum: 'mid', width_max_m: 4 }
const SAVED_STAMP_MIME = 'application/x.canopi.saved-object-stamp+json'

let container: HTMLDivElement
let events: SceneInteractionEventHarness
let camera: CameraController
let store: SceneStore
let sessions: SceneInteractionSession[]
let mountedRulers: MountedRulers[]

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  events = createSceneInteractionEventHarness(container)
  camera = createTestView({ screen: { width: 400, height: 300 }, viewport: { x: 0, y: 0, scale: 1 } }).legacyCamera
  store = new SceneStore()
  sessions = []
  mountedRulers = []
  clearPlantStampSource()
  clearSavedObjectStampSource()
})

afterEach(() => {
  for (const session of sessions.splice(0).reverse()) session.dispose()
  builtHosts.length = 0
  bridgeAdapters.clear()
  for (const rulers of mountedRulers.splice(0)) rulers.unmount()
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

function rulerCamera(viewport: { readonly x?: number, readonly y?: number, readonly scale?: number, readonly revision?: number } = {}): CameraViewportSnapshot {
  const scale = viewport.scale ?? 8
  return {
    viewport: { x: viewport.x ?? 12, y: viewport.y ?? 34, scale },
    screenSize: { width: 400, height: 300 },
    devicePixelRatio: 1,
    referenceScale: 8,
    scaleBounds: { minimum: 0.00001, maximum: 2000 },
    overviewScaleThreshold: 0.1,
    mode: scale < 0.1 ? 'overview' : 'site',
    groundMetersPerCssPixel: null,
    revision: viewport.revision ?? 1,
  }
}

interface MountedRulers {
  readonly host: HTMLElement
  readonly overlay: RulerOverlay
  readonly onGuideCreate: ReturnType<typeof vi.fn>
  readonly horizontal: HTMLCanvasElement
  readonly vertical: HTMLCanvasElement
  show(camera: CameraViewportSnapshot, rulersVisible?: boolean): void
  unmount(): void
}

/** Today's ruler overlay beside the map host (a sibling, as the workspace mounts it), showing the rulers at `camera`. */
function mountRulers(camera = rulerCamera()): MountedRulers {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onGuideCreate = vi.fn()
  const overlay = createRulerOverlay(host, { onGuideCreate })
  const part = (name: string) => host.querySelector<HTMLCanvasElement>(`[data-ruler-overlay-part="${name}"]`)!
  const rulers: MountedRulers = {
    host,
    overlay,
    onGuideCreate,
    horizontal: part('horizontal'),
    vertical: part('vertical'),
    show: (next, rulersVisible = true) => overlay.update({ camera: next, chromeVisible: true, rulersVisible }),
    unmount: () => {
      overlay.destroy()
      host.remove()
      getContext.mockRestore()
    },
  }
  rulers.show(camera)
  mountedRulers.push(rulers)
  return rulers
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
    const bridgedPresses: string[] = []
    for (const id of ['rectangle', 'line']) {
      bridgeAdapters.set(id, { pointerDown: ({ screen }) => { bridgedPresses.push(`${id} ${screen.x},${screen.y}`); return true } })
    }
    const { session } = createSession()

    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 20 })
    events.pointerMove({ x: 80, y: 60 })
    events.pointerUp({ x: 80, y: 60 })
    // The host's tool drew it; the bridge's rectangle adapter (stubbed here) never ran.
    expect(rectangle.gestures.map((gesture) => gesture.kind)).toEqual(['press', 'drag-start', 'drag-end'])
    expect(bridgedPresses).toEqual([])
    expect(store.persisted.zones).toHaveLength(0)

    // An unregistered tool's press goes to the bridge's adapter (stubbed here), and the host's tool hears nothing more.
    session.setTool('line')
    events.pointerDown({ x: 120, y: 120 })
    events.pointerUp({ x: 120, y: 120 })
    expect(bridgedPresses).toEqual(['line 120,120'])
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

  it('a raw press carries its pointer id to rawPress', () => {
    useStubTools(stubTool('select'))
    createSession()
    const rawPress = vi.spyOn(builtHosts.at(-1)!, 'rawPress')

    events.pointerDown({ x: 30, y: 30 }, { pointerId: 7 })
    events.pointerDown({ x: 60, y: 30 }, { pointerId: 9, button: 1 })
    // The host skips the menu close and focus only for a live press from another pointer (today's _onPointerDown).
    expect(rawPress.mock.calls).toEqual([
      ['primary', { kind: 'surface' }, 7],
      ['middle', { kind: 'surface' }, 9],
    ])
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

  it('a registered tool\'s transient history and spacing field go through the host', () => {
    const row = stubTool('plant-spacing', {
      canUndoTransient: () => true,
      canRedoTransient: () => false,
      command: (command) => command.kind === 'undo-transient' ? 'handled' : 'pass',
    })
    useStubTools(row)
    const { session } = createSession()
    session.setTool('plant-spacing')

    expect(session.canUndoTransientHistory()).toBe(true)
    expect(session.canRedoTransientHistory()).toBe(false)
    expect(session.undoTransientHistory()).toBe(true)
    expect(session.redoTransientHistory()).toBe(false)
    session.plantRowSpacing.input('2')
    session.plantRowSpacing.commit('2.5')
    session.plantRowSpacing.blur('3')
    session.plantRowSpacing.cancel()
    expect(row.commands).toEqual([
      { kind: 'undo-transient' },
      { kind: 'spacing-input', text: '2' },
      { kind: 'spacing-input', text: '2.5' },
      { kind: 'spacing-commit', via: 'enter' },
      { kind: 'spacing-input', text: '3' },
      { kind: 'spacing-commit', via: 'blur' },
      { kind: 'spacing-cancel' },
    ])
  })

  it('Space and a pointer pan show the navigation cursor over a registered tool\'s', () => {
    useStubTools(stubTool('rectangle'))
    const { session } = createSession()
    session.setTool('rectangle')
    expect(container.style.cursor).toBe('crosshair')

    container.focus()
    events.holdSpace()
    expect(container.style.cursor).toBe('grab')
    const before = camera.viewport
    events.pointerDown({ x: 100, y: 100 })
    expect(container.style.cursor).toBe('grabbing')
    events.pointerMove({ x: 130, y: 110 })
    expect(camera.viewport).toEqual({ x: before.x + 30, y: before.y + 10, scale: before.scale })
    events.pointerUp({ x: 130, y: 110 })
    // Today's cancel after a pan: the tool's cursor comes back even with Space still held.
    expect(container.style.cursor).toBe('crosshair')
    events.releaseSpace()
    expect(container.style.cursor).toBe('crosshair')
  })

  it('Esc cancels a registered tool\'s live press after the tool passes it', () => {
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')
    container.focus()

    events.pointerDown({ x: 20, y: 20 })
    events.pointerMove({ x: 60, y: 60 })
    const escape = events.keyDown({ key: 'Escape', cancelable: true, target: container })
    expect(escape.defaultPrevented).toBe(true)
    expect(rectangle.commands).toEqual([{ kind: 'escape' }])
    expect(rectangle.last('cancel')).toEqual({ kind: 'cancel', reason: 'escape' })
    events.pointerUp({ x: 60, y: 60 })
    expect(rectangle.count('drag-end')).toBe(0)
  })

  it('a saved stamp chosen while armed reaches sourceChanged at once', () => {
    const sources: (ToolSource | null)[] = []
    useStubTools(stubTool('saved-object-stamp', { sourceChanged: (source) => { sources.push(source) } }))
    const { session } = createSession()
    session.setTool('saved-object-stamp')

    const stamp = selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [],
      zones: [],
      annotations: [],
      groups: [],
    } as unknown as Parameters<typeof selectSavedObjectStampSourceForTests>[0])
    expect(sources).toEqual([{ kind: 'saved-stamp', stamp }])
    session.setTool('select')
    expect(sources).toHaveLength(1)
  })

  it('the keyboard port\'s zoom and view keys move the camera through today\'s navigation', () => {
    const render = vi.fn()
    const { session } = createSession({ render })
    const scale = camera.viewport.scale

    expect(session.keyboard.command({ kind: 'zoom-step', direction: 1 })).toBe(true)
    expect(camera.viewport.scale).toBeGreaterThan(scale)
    expect(render).toHaveBeenCalledWith('viewport')
    session.keyboard.command({ kind: 'zoom-step', direction: -1 })
    expect(camera.viewport.scale).toBeCloseTo(scale, 9)
    // North stays up under LEGACY: the view commands answer and leave the camera's bearing alone.
    expect(session.keyboard.command({ kind: 'reset-north' })).toBe(true)
    expect(session.keyboard.command({ kind: 'rotate-view', direction: 1 })).toBe(true)
  })

  it('a move with a button held and no press on the map publishes no pointer world point', () => {
    const { session } = createSession()
    const points: (WorldPoint | null)[] = []
    session.subscribePointerWorld((point) => { points.push(point) })

    events.pointerMove({ x: 100, y: 100 }, { target: container, buttons: 0 })
    expect(points).toHaveLength(1)
    // A press on a panel or a map control dragged across the map: today's lens skipped every move with a button held (the
    // held-button move that inspection-lens-ui.test.tsx dispatched on the host before the lens read subscribePointerWorld).
    events.pointerMove({ x: 120, y: 120 }, { target: container, buttons: 1 })
    // Under LEGACY a right press opens no session, so its moves are hovers; the lens keeps its point through them too.
    events.pointerDown({ x: 140, y: 140 }, { button: 2 })
    events.pointerMove({ x: 180, y: 160 }, { target: container, buttons: 2 })
    events.pointerUp({ x: 180, y: 160 }, { button: 2 })
    expect(points).toHaveLength(1)
    // A pen hovering with its barrel or eraser held: LEGACY ignores both as presses, yet today's lens saw the button.
    events.pointerMove({ x: 130, y: 130 }, { target: container, pointerType: 'pen', pointerId: 9, buttons: 2 })
    events.pointerMove({ x: 135, y: 130 }, { target: container, pointerType: 'pen', pointerId: 9, buttons: 32 })
    expect(points).toHaveLength(1)
    events.pointerMove({ x: 150, y: 150 }, { target: container, buttons: 0 })
    expect(points).toHaveLength(2)

    // A registered tool still hears such a move as a hover (today's hover ran), and the lens still keeps its point.
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    session.setTool('rectangle')
    events.pointerMove({ x: 160, y: 150 }, { target: container, buttons: 1 })
    expect(rectangle.count('hover')).toBe(1)
    expect(points).toHaveLength(2)
    events.pointerMove({ x: 170, y: 150 }, { target: container, buttons: 0 })
    expect(rectangle.count('hover')).toBe(2)
    expect(points).toHaveLength(3)
  })

  it('a pen drag that ends on the barrel commits its move, as today', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const { session } = createSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')
    const pen = { pointerId: 40, pointerType: 'pen' } as const

    events.pointerDown({ x: 20, y: 30 }, { ...pen, button: 0, buttons: 1 })
    // The barrel goes down mid-drag and the tip lifts first: the pointerup reports the barrel (button 2), which
    // LEGACY ignores as a press, yet today's pointerup ended the drag whatever its button.
    events.pointerMove({ x: 35, y: 45 }, { ...pen, buttons: 3 })
    events.pointerMove({ x: 35, y: 45 }, { ...pen, buttons: 2 })
    events.pointerUp({ x: 35, y: 45 }, { ...pen, button: 2, buttons: 0 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    const released = { ...store.persisted.plants[0]!.position }
    expect(released).not.toEqual({ x: 20, y: 30 })

    // The pen hovers on, then the browser's implicit capture release arrives: the move stays where it was released.
    events.pointerMove({ x: 80, y: 90 }, { ...pen, buttons: 0 })
    events.lostPointerCapture(40)
    expect(store.persisted.plants[0]?.position).toEqual(released)
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
  })

  it('a hover that throws leaves the move to the rest of the app, under a bridged and a registered tool', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 100, y: 100 })]
    })
    let broken = false
    const { session } = createSession({
      setHoveredTarget: () => {
        if (broken) throw new Error('hover failed')
      },
    })
    const panel = document.createElement('div')
    document.body.appendChild(panel)
    const panelMoves = vi.fn()
    panel.addEventListener('pointermove', panelMoves)
    /** A hover over the plant (its restyle throws), then a move over a panel beside the map. */
    const failingHover = (x: number): unknown[] => {
      broken = true
      try {
        return captureWindowErrors(() => {
          events.pointerMove({ x, y: 100 }, { buttons: 0 })
          events.pointerMove({ x, y: 100 }, { target: panel, buttons: 0 })
        })
      } finally {
        broken = false
      }
    }

    try {
      // Today's pointermove had no quarantine: a failing hover never stopped the app's other pointer listeners.
      expect(failingHover(100)).toHaveLength(2)
      expect(panelMoves).toHaveBeenCalledOnce()

      useStubTools(stubTool('rectangle'))
      session.setTool('rectangle')
      expect(failingHover(101)).toHaveLength(2)
      expect(panelMoves).toHaveBeenCalledTimes(2)
    } finally {
      panel.remove()
    }
  })

  it('a retried cancellation that fails again still quarantines the event it was retried for, as today', () => {
    let failures = 2
    let edit: SceneEditTransaction | null = null
    const rectangle: StubTool = stubTool('rectangle', {
      gesture: (gesture) => {
        if (gesture.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
        return 'pass'
      },
      cancelTransient: () => {
        if (failures > 0) {
          failures -= 1
          throw new Error('cancel failed')
        }
        edit?.abort()
        edit = null
      },
    })
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 20 })
    // The blur's cancellation fails with the press's Scene Edit open: it is left pending.
    expect(captureWindowErrors(() => { events.windowBlur() })).toHaveLength(1)

    // Today's retry quarantined the event before it retried, so a wheel whose retry fails again moves nothing.
    const outside = vi.fn()
    container.addEventListener('wheel', outside)
    let wheel: WheelEvent | null = null
    expect(captureWindowErrors(() => { wheel = events.wheel({ x: 50, y: 50 }, { deltaY: 4 }) })).toHaveLength(1)
    expect(wheel!.defaultPrevented).toBe(true)
    expect(outside).not.toHaveBeenCalled()
    // The next retry succeeds, and its event is quarantined too.
    wheel = events.wheel({ x: 50, y: 50 }, { deltaY: 4 })
    expect(wheel.defaultPrevented).toBe(true)
    expect(outside).not.toHaveBeenCalled()
    container.removeEventListener('wheel', outside)
  })

  it('a wheel whose zoom or pan fails under a registered tool is still default-prevented, as today', () => {
    useStubTools(stubTool('rectangle'))
    let broken = false
    const { session } = createSession({
      render: (kind) => {
        if (broken && kind === 'viewport') throw new Error('render failed')
      },
    })
    session.setTool('rectangle')

    broken = true
    try {
      // Today's _onWheel prevented the wheel before it moved the camera: a failing zoom never let the page zoom.
      let zoom: WheelEvent | null = null
      expect(captureWindowErrors(() => { zoom = events.wheel({ x: 50, y: 50 }, { deltaY: -40, ctrlKey: true }) })).toHaveLength(1)
      expect(zoom!.defaultPrevented).toBe(true)
      let pan: WheelEvent | null = null
      expect(captureWindowErrors(() => { pan = events.wheel({ x: 50, y: 50 }, { deltaY: 40, shiftKey: true }) })).toHaveLength(1)
      expect(pan!.defaultPrevented).toBe(true)
    } finally {
      broken = false
    }
  })

  /** A registered Rectangle whose press opens a Scene Edit, left with a pending cancellation by a blur whose cancel fails. */
  function pendingCancellation(): { readonly rectangle: StubTool, readonly failing: { value: boolean }, readonly retries: () => number } {
    const failing = { value: true }
    let edit: SceneEditTransaction | null = null
    const rectangle: StubTool = stubTool('rectangle', {
      gesture: (gesture) => {
        if (gesture.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
        return 'pass'
      },
      cancelTransient: () => {
        if (failing.value) throw new Error('cancel failed')
        edit?.abort()
        edit = null
      },
    })
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 20 }, { pointerId: 3 })
    expect(captureWindowErrors(() => { events.windowBlur() })).toHaveLength(1)
    const retries = (): number => rectangle.calls.filter((call) => call === 'cancelTransient:tool-change').length
    return { rectangle, failing, retries }
  }

  it('a pending cancellation is retried only on the events today\'s handlers retried on; hovers and ruler drags go on', () => {
    const { failing, retries } = pendingCancellation()
    failing.value = false
    const panel = document.createElement('div')
    document.body.appendChild(panel)
    const panelMoves = vi.fn()
    panel.addEventListener('pointermove', panelMoves)
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    const rulerPresses = vi.fn()
    rulers.horizontal.addEventListener('pointerdown', rulerPresses)

    try {
      // Today's pointermove and pointerleave never retried: a hover over a panel, or leaving the map, reaches the app.
      events.pointerMove({ x: 10, y: 10 }, { target: panel, buttons: 0, pointerId: 30 })
      events.pointerMove({ x: 60, y: 60 }, { buttons: 0, pointerId: 30 })
      events.pointerLeave({ x: 60, y: 60 }, { pointerId: 30 })
      expect(panelMoves).toHaveBeenCalledOnce()
      expect(retries()).toBe(0)

      // Today's ruler listened beside the map: its press is never fenced, and its release, which today's pointerup retried
      // and swallowed, still lands the guide (its own mouseup).
      events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal, pointerId: 40 })
      expect(rulerPresses).toHaveBeenCalledOnce()
      events.pointerMove({ x: 180, y: 60 }, { pointerId: 40, buttons: 1 })
      expect(retries()).toBe(0)
      const release = events.pointerUp({ x: 180, y: 100 }, { pointerId: 40 })
      expect(retries()).toBe(1)
      expect(release.defaultPrevented).toBe(true)
      expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    } finally {
      panel.remove()
    }
  })

  it('a wheel over a handle, the note editor or the Unlock affordance leaves a pending cancellation alone, as today', () => {
    const { failing, retries } = pendingCancellation()
    failing.value = false
    const rotation = document.createElement('div')
    rotation.setAttribute('data-rotation-handle', '')
    const controlPoint = document.createElement('div')
    controlPoint.setAttribute('data-control-point-overlay-handle', '0')
    const entry = document.createElement('div')
    entry.setAttribute('data-canvas-text-entry', '')
    const unlock = document.createElement('button')
    unlock.setAttribute('data-locked-object-affordance', '')
    container.append(rotation, controlPoint, entry, unlock)
    const outside = vi.fn()
    container.addEventListener('wheel', outside)

    try {
      // Today's _onWheel returned before its retry over the note editor, the rotation handle, a control point and the
      // Unlock affordance: the wheel is neither retried nor prevented, and reaches the app.
      for (const target of [rotation, controlPoint, entry, unlock]) {
        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 4, clientX: 50, clientY: 50 })
        target.dispatchEvent(wheel)
        expect(wheel.defaultPrevented).toBe(false)
      }
      expect(retries()).toBe(0)
      expect(outside).toHaveBeenCalledTimes(4)

      // A wheel over the map retries it, and is swallowed.
      const surface = events.wheel({ x: 50, y: 50 }, { deltaY: 4 })
      expect(retries()).toBe(1)
      expect(surface.defaultPrevented).toBe(true)
      expect(outside).toHaveBeenCalledTimes(4)
    } finally {
      container.removeEventListener('wheel', outside)
      for (const element of [rotation, controlPoint, entry, unlock]) element.remove()
    }
  })

  it('a window blur while a cancellation is pending goes on to the app, as today\'s blur handlers let it', () => {
    const { failing } = pendingCancellation()
    const blurs = vi.fn()
    window.addEventListener('blur', blurs)
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))

    try {
      // The interruption's own cancellation fails again: its error is the blur's only one.
      expect(captureWindowErrors(() => { events.windowBlur() })).toHaveLength(1)
      expect(blurs).toHaveBeenCalledOnce()

      // A blur that ends a ruler drag retries the cancellation for the drag's host press, and is not swallowed either.
      failing.value = false
      events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal, pointerId: 40 })
      events.pointerMove({ x: 180, y: 60 }, { pointerId: 40, buttons: 1 })
      events.windowBlur()
      expect(blurs).toHaveBeenCalledTimes(2)
      events.pointerUp({ x: 180, y: 100 }, { pointerId: 40 })
      expect(rulers.onGuideCreate).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('blur', blurs)
    }
  })

  it('a session built with a stamp tool armed hands the tool its pick', () => {
    const sources: (ToolSource | null)[] = []
    const record = {
      activate: (_ctx: unknown, source: ToolSource | null) => { sources.push(source) },
      sourceChanged: (source: ToolSource | null) => { sources.push(source) },
    }
    useStubTools(stubTool('plant-stamp', record), stubTool('saved-object-stamp', record))

    // The map mounts (or mounts again) with Place plants armed and a species picked: today's tool read the pick live.
    const chosen = selectPlantStampSource(SPECIES)
    setCanvasTool('plant-stamp')
    const { session } = createSession()
    expect(sources.at(-1)).toEqual({ kind: 'species', species: chosen })
    session.dispose()

    const stamp = selectSavedObjectStampSourceForTests({
      version: 2,
      anchor: { x: 0, y: 0 },
      plants: [],
      zones: [],
      annotations: [],
      groups: [],
    } as unknown as Parameters<typeof selectSavedObjectStampSourceForTests>[0])
    setCanvasTool('saved-object-stamp')
    createSession()
    expect(sources.at(-1)).toEqual({ kind: 'saved-stamp', stamp })
  })

  it('arming a bridged tool during a registered tool\'s press ends the press with its capture and its pan', () => {
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 20 }, { pointerId: 4 })
    events.pointerMove({ x: 60, y: 40 }, { pointerId: 4 })
    expect(events.pointerCapture.has(4)).toBe(true)
    // Ellipse is still on the bridge: the capture the host's press took goes at once, as today's tool change released it.
    session.setTool('ellipse')
    expect(events.pointerCapture.has(4)).toBe(false)
    events.pointerUp({ x: 60, y: 40 }, { pointerId: 4 })

    // A middle pan cut short the same way leaves no 'grabbing' behind for Space over the next registered tool.
    session.setTool('rectangle')
    events.pointerDown({ x: 100, y: 100 }, { pointerId: 5, button: 1 })
    events.pointerMove({ x: 130, y: 110 }, { pointerId: 5, button: 1 })
    expect(container.style.cursor).toBe('grabbing')
    session.setTool('ellipse')
    events.pointerUp({ x: 130, y: 110 }, { pointerId: 5, button: 1 })
    session.setTool('rectangle')
    container.focus()
    events.holdSpace()
    expect(container.style.cursor).toBe('grab')
    events.releaseSpace()
  })
})

/** A panel drag event over the map at a container point, carrying `data` (a species, by default nothing of ours). */
function dispatchDrag(type: 'dragover' | 'dragleave' | 'drop', at: { x: number, y: number }, data?: (transfer: DataTransferLike) => void): DragEvent {
  const dragData = new Map<string, string>()
  const dataTransfer: DataTransferLike = {
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
  return event
}

interface DataTransferLike {
  effectAllowed: string
  dropEffect: string
  readonly types: readonly string[]
  setData(format: string, value: string): void
  getData(format: string): string
}

const PEAR = { canonical_name: 'Pyrus communis', common_name: 'Pear', stratum: 'mid', width_max_m: 3 }

/** A registered tool whose press opens a Scene Edit that its cancelTransient aborts. */
function editingTool(id: 'rectangle' | 'hand'): { readonly tool: StubTool, readonly open: () => boolean } {
  let edit: SceneEditTransaction | null = null
  const tool: StubTool = stubTool(id, {
    gesture: (gesture) => {
      if (gesture.kind === 'press') edit = tool.ctx().effects.edits.begin(`interaction-${id}`)
      return 'pass'
    },
    cancelTransient: () => {
      edit?.abort()
      edit = null
    },
  })
  return { tool, open: () => edit !== null }
}

describe('registered tools against today\'s session (0B-3 host rulings)', () => {
  it('a registered tool\'s press takes its capture after admission and before the tool hears it', () => {
    const captured: boolean[] = []
    const rectangle = stubTool('rectangle', {
      gesture: (gesture) => {
        if (gesture.kind === 'press') captured.push(events.pointerCapture.has(6))
        return 'pass'
      },
    })
    useStubTools(rectangle)
    const { session, deps } = createSession()
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 20 }, { pointerId: 6 })
    expect(captured).toEqual([true])
    events.pointerUp({ x: 20, y: 20 }, { pointerId: 6 })

    // A press the scene refuses takes no capture.
    const busy = deps.sceneEdits.begin('elsewhere')
    events.pointerDown({ x: 30, y: 30 }, { pointerId: 7 })
    expect(events.pointerCapture.setCalls).not.toHaveBeenCalledWith(7)
    expect(rectangle.count('press')).toBe(1)
    busy.abort()
  })

  it('a press whose pointer\'s last up was lost keeps the capture it takes; a refused one keeps neither capture', () => {
    const rectangle = stubTool('rectangle')
    useStubTools(rectangle)
    const { session, deps } = createSession()
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 20 }, { pointerId: 6 })
    events.pointerMove({ x: 40, y: 40 }, { pointerId: 6 })
    // The up is lost: pointer 6 presses again, ending its old session first.
    events.pointerDown({ x: 60, y: 60 }, { pointerId: 6 })
    expect(rectangle.count('press')).toBe(2)
    expect(events.pointerCapture.has(6)).toBe(true)
    events.pointerUp({ x: 60, y: 60 }, { pointerId: 6 })

    events.pointerDown({ x: 20, y: 20 }, { pointerId: 8 })
    const busy = deps.sceneEdits.begin('elsewhere')
    events.pointerDown({ x: 60, y: 60 }, { pointerId: 8 })
    expect(rectangle.count('press')).toBe(3)
    expect(events.pointerCapture.has(8)).toBe(false)
    busy.abort()
  })

  it('a capture lost synchronously while it is taken stops the press before the tool, as today', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, { pointerCapture: { synchronousLossOnSet: true } })
    const { tool: rectangle, open } = editingTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 24 })
    expect(events.pointerCapture.setCalls).toHaveBeenCalledWith(24)
    expect(events.pointerCapture.has(24)).toBe(false)
    expect(rectangle.count('press')).toBe(0)
    expect(open()).toBe(false)
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 24 })
    events.pointerUp({ x: 40, y: 50 }, { pointerId: 24 })
    expect(rectangle.count('drag-start')).toBe(0)
  })

  it('Place plants here from a bridged tool\'s menu places through the host once Place plants is registered', () => {
    const stamp = stubTool('plant-stamp', { command: (command) => command.kind === 'place-at' ? 'handled' : 'pass' })
    useStubTools(stamp)
    const tools: string[] = []
    const { session } = createSession({ setTool: (name) => { tools.push(name) } })
    session.setTool('select')
    contextMenuHost.reset()

    dispatchContextMenu(container, events.clientPoint({ x: 120, y: 80 }))
    const request = contextMenuHost.current
    expect(request?.placePlantsAt).toBeDefined()
    request!.placePlantsAt!({ x: 120, y: 80 })

    expect(tools.at(-1)).toBe('plant-stamp')
    expect(stamp.commands).toEqual([{ kind: 'place-at', world: { x: 120, y: 80 } }])
    // The app closes the request it holds.
    session.setTool('select')
    dispatchContextMenu(container, events.clientPoint({ x: 60, y: 60 }))
    const reopened = contextMenuHost.current
    events.pointerDown({ x: 10, y: 10 })
    events.pointerUp({ x: 10, y: 10 })
    expect(reopened).not.toBeNull()
    expect(contextMenuHost.current).toBeNull()
  })

  it('leaving a registered tool cancels its press through the host even when the bridge\'s hover clear fails', () => {
    const { tool: rectangle, open } = editingTool('rectangle')
    useStubTools(rectangle)
    let failHover = false
    const { session } = createSession({
      setHoveredTarget: () => {
        if (failHover) throw new Error('hover cleanup failed')
      },
    })
    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 30 }, { pointerId: 15 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 15 })
    expect(open()).toBe(true)

    failHover = true
    expect(() => session.setTool('ellipse')).toThrow('hover cleanup failed')
    failHover = false
    expect(rectangle.last('cancel')).toEqual({ kind: 'cancel', reason: 'tool-change' })
    expect(open()).toBe(false)
    expect(events.pointerCapture.has(15)).toBe(false)
    expect(builtHosts.at(-1)?.activeTool.value).toBe('rectangle')
    expect(container.style.cursor).toBe('crosshair')
  })

  it('a bridge that fails after the host left a registered tool re-arms it, and the tool\'s pan and cursor end', () => {
    const hand = stubTool('hand')
    useStubTools(hand)
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    let failSelection = false
    const base = createInteractionDeps(container, store, camera)
    const { session } = createSession({
      getDesignObjectSelection: () => {
        if (failSelection) throw new Error('selection refresh failed')
        return base.getDesignObjectSelection()
      },
    })
    session.setTool('hand')
    events.pointerDown({ x: 100, y: 100 }, { pointerId: 52 })
    events.pointerMove({ x: 110, y: 110 }, { pointerId: 52 })
    expect(container.style.cursor).toBe('grabbing')

    failSelection = true
    expect(() => session.setTool('select')).toThrow('selection refresh failed')
    failSelection = false
    expect(builtHosts.at(-1)?.activeTool.value).toBe('hand')
    expect(container.style.cursor).toBe('grab')
    expect(events.pointerCapture.has(52)).toBe(false)

    const before = camera.viewport
    events.pointerDown({ x: 100, y: 100 }, { pointerId: 53 })
    events.pointerMove({ x: 130, y: 120 }, { pointerId: 53 })
    events.pointerUp({ x: 130, y: 120 }, { pointerId: 53 })
    expect(camera.viewport).toEqual({ x: before.x + 30, y: before.y + 20, scale: before.scale })
  })

  it('entering a registered tool whose activation fails leaves the bridge and the tool as they were', () => {
    let failActivation = true
    const rectangle = stubTool('rectangle', {
      activate: () => {
        if (failActivation) throw new Error('activation failed')
      },
    })
    useStubTools(rectangle)
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const { session, deps } = createSession()
    session.setTool('select')

    expect(() => session.setTool('rectangle')).toThrow('activation failed')
    failActivation = false
    expect(builtHosts.at(-1)?.activeTool.value).toBe('select')
    // Select still runs on the bridge: a click selects the plant under it.
    events.pointerDown({ x: 20, y: 30 })
    events.pointerUp({ x: 20, y: 30 })
    expect(deps.setSelection).toHaveBeenLastCalledWith([plantTarget('plant-1')])
    expect(rectangle.count('press')).toBe(0)

    session.setTool('rectangle')
    expect(builtHosts.at(-1)?.activeTool.value).toBe('rectangle')
  })

  it('disposal releases the capture of a registered tool\'s live press and rolls its edit back', () => {
    const { tool: rectangle, open } = editingTool('rectangle')
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')
    events.pointerDown({ x: 20, y: 30 }, { pointerId: 25 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 25 })
    expect(events.pointerCapture.has(25)).toBe(true)

    session.dispose()
    expect(events.pointerCapture.releaseCalls).toHaveBeenCalledWith(25)
    expect(events.pointerCapture.has(25)).toBe(false)
    expect(open()).toBe(false)
  })

  it('a pending cancellation is retried before a dragover or a drop reaches the bridge, and the event is swallowed', () => {
    let failures = 3
    let edit: SceneEditTransaction | null = null
    const rectangle: StubTool = stubTool('rectangle', {
      gesture: (gesture) => {
        if (gesture.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
        return 'pass'
      },
      cancelTransient: () => {
        if (failures > 0) {
          failures -= 1
          throw new Error('cancel failed')
        }
        edit?.abort()
        edit = null
      },
    })
    useStubTools(rectangle)
    const { session } = createSession()
    session.setTool('rectangle')
    const retries = (): number => rectangle.calls.filter((call) => call === 'cancelTransient:tool-change').length
    const species = (transfer: DataTransferLike) => writePlantStampDragData(transfer, PEAR)
    const outside = vi.fn()
    container.addEventListener('dragover', outside)
    container.addEventListener('drop', outside)

    try {
      events.pointerDown({ x: 20, y: 20 })
      expect(captureWindowErrors(() => { events.windowBlur() })).toHaveLength(1)

      // Today's _onDragOver retried first: a retry that fails again still swallows the dragover.
      let over: DragEvent | null = null
      expect(captureWindowErrors(() => { over = dispatchDrag('dragover', { x: 60, y: 60 }, species) })).toHaveLength(1)
      expect(retries()).toBe(1)
      expect(over!.defaultPrevented).toBe(true)
      expect(over!.dataTransfer!.dropEffect).toBe('none')

      let drop: DragEvent | null = null
      expect(captureWindowErrors(() => { drop = dispatchDrag('drop', { x: 60, y: 60 }, species) })).toHaveLength(1)
      expect(retries()).toBe(2)
      expect(drop!.defaultPrevented).toBe(true)
      expect(store.persisted.plants).toHaveLength(0)

      // The retry that succeeds swallows its drop too: no plant is placed.
      drop = dispatchDrag('drop', { x: 60, y: 60 }, species)
      expect(retries()).toBe(3)
      expect(drop.defaultPrevented).toBe(true)
      expect(store.persisted.plants).toHaveLength(0)
      expect(outside).not.toHaveBeenCalled()

      // With nothing pending, the bridge's drop places the plant, as today.
      dispatchDrag('drop', { x: 60, y: 60 }, species)
      expect(store.persisted.plants).toHaveLength(1)
    } finally {
      container.removeEventListener('dragover', outside)
      container.removeEventListener('drop', outside)
    }
  })

  it('a dragover hides a registered tool\'s draft until the pointer moves over the map again', () => {
    const ghost: DraftPresentation = {
      shapes: [{ kind: 'circle-px', center: { x: 50, y: 50 }, radiusPx: 4, style: { token: 'draft', widthPx: 1 } }],
    }
    const stamp: StubTool = stubTool('object-stamp', {
      gesture: (gesture) => {
        if (gesture.kind === 'hover') stamp.ctx().effects.setDraft(ghost)
        return 'handled'
      },
    })
    useStubTools(stamp)
    const renderer = recordingRenderer()
    const { session } = createSession({ renderer })
    session.setTool('object-stamp')
    events.pointerMove({ x: 50, y: 50 }, { buttons: 0 })
    expect(renderer.lastDraft()).toEqual(ghost)

    dispatchDrag('dragover', { x: 60, y: 60 }, (transfer) => writePlantStampDragData(transfer, PEAR))
    expect(renderer.lastDraft()).toBeNull()
    dispatchDrag('dragleave', { x: 60, y: 60 })
    expect(renderer.lastDraft()).toBeNull()
    events.pointerMove({ x: 70, y: 70 }, { buttons: 0 })
    expect(renderer.lastDraft()).toEqual(ghost)
  })
})

describe('ruler drags through the session', () => {
  it('a ruler drag lands one guide at its release, and none inside the ruler\'s gutter', () => {
    createSession()
    const rawPress = vi.spyOn(builtHosts.at(-1)!, 'rawPress')
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))

    // The source takes the press beside the map: today's drag starts default-prevented, and it is no press on the map.
    const down = events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    expect(down.defaultPrevented).toBe(true)
    expect(rawPress).not.toHaveBeenCalled()
    events.pointerUp({ x: 180, y: 100 })
    events.pointerUp({ x: 180, y: 120 })
    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerUp({ x: 180, y: 20 })
    expect(rulers.onGuideCreate).toHaveBeenCalledOnce()
  })

  it('a pen drags a guide out of a ruler under a bridged and a registered tool; a touch press there drags none', () => {
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    const pen = { pointerId: 7, pointerType: 'pen' } as const
    const touch = { pointerId: 8, pointerType: 'touch' } as const
    const penDrag = (): void => {
      const down = events.pointerDown({ x: 180, y: 10 }, { ...pen, target: rulers.horizontal })
      expect(down.defaultPrevented).toBe(true)
      events.pointerMove({ x: 180, y: 60 }, { ...pen, buttons: 1 })
      events.pointerUp({ x: 180, y: 100 }, pen)
    }
    const touchDrag = (): void => {
      events.pointerDown({ x: 180, y: 10 }, { ...touch, target: rulers.horizontal })
      events.pointerMove({ x: 180, y: 60 }, { ...touch, buttons: 1 })
      events.pointerUp({ x: 180, y: 100 }, touch)
    }

    // Today's ruler heard the pen's compatibility mousedown and mouseup; a touch press sent none before its release.
    const bridged = createSession().session
    penDrag()
    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    touchDrag()
    expect(rulers.onGuideCreate).toHaveBeenCalledOnce()
    bridged.dispose()

    useStubTools(stubTool('select'))
    createSession()
    penDrag()
    expect(rulers.onGuideCreate).toHaveBeenCalledTimes(2)
    expect(rulers.onGuideCreate).toHaveBeenLastCalledWith('h', 20)
    touchDrag()
    expect(rulers.onGuideCreate).toHaveBeenCalledTimes(2)
  })

  it('a ruler guide lands at its release even when the tool\'s release fails, as today\'s separate mouseup did', () => {
    let broken = false
    const { session } = createSession({
      setHoveredTarget: () => {
        if (broken) throw new Error('release failed')
      },
    })
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    rulers.host.style.cursor = 'crosshair'
    const failingRelease = (): unknown[] => {
      events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
      events.pointerMove({ x: 180, y: 60 })
      broken = true
      try {
        return captureWindowErrors(() => { events.pointerUp({ x: 180, y: 100 }) })
      } finally {
        broken = false
      }
    }

    expect(failingRelease()).toHaveLength(1)
    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    expect(rulers.host.style.cursor).toBe('crosshair')

    // A registered tool's release that fails still ends the rulers' drag.
    useStubTools(stubTool('select'))
    session.dispose()
    createSession({
      setHoveredTarget: () => {
        if (broken) throw new Error('release failed')
      },
    })
    expect(failingRelease()).toHaveLength(1)
    expect(rulers.onGuideCreate).toHaveBeenCalledTimes(2)
    expect(rulers.host.style.cursor).toBe('crosshair')
  })

  it('a second ruler press replaces the first drag', () => {
    createSession()
    const rulers = mountRulers(rulerCamera({ x: 10, scale: 2 }))

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerDown({ x: 10, y: 100 }, { target: rulers.vertical })
    events.pointerMove({ x: 200, y: 150 })
    events.pointerUp({ x: 200, y: 150 })
    events.pointerUp({ x: 220, y: 170 })

    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('v', 95)
  })

  it('a ruler drag ends with its overlay: the exact cursor comes back and no guide lands', () => {
    createSession()
    const rulers = mountRulers()
    rulers.host.style.cursor = 'crosshair'

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 50 })
    expect(rulers.host.style.cursor).toBe('s-resize')

    rulers.overlay.destroy()
    expect(rulers.host.style.cursor).toBe('crosshair')
    expect(rulers.host.childElementCount).toBe(0)

    events.pointerMove({ x: 200, y: 90 })
    events.pointerUp({ x: 200, y: 90 })
    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerUp({ x: 200, y: 90 })
    expect(rulers.host.style.cursor).toBe('crosshair')
    expect(rulers.onGuideCreate).not.toHaveBeenCalled()
  })

  it('a window blur ends a ruler drag without a guide', () => {
    createSession()
    const rulers = mountRulers()
    rulers.host.style.cursor = 'grab'

    events.pointerDown({ x: 10, y: 100 }, { target: rulers.vertical })
    events.pointerMove({ x: 80, y: 100 })
    expect(rulers.host.style.cursor).toBe('e-resize')

    events.windowBlur()
    events.pointerUp({ x: 80, y: 100 })
    expect(rulers.host.style.cursor).toBe('grab')
    expect(rulers.onGuideCreate).not.toHaveBeenCalled()
  })

  it('a ruler drag keeps its cursor, and a blur ends it without a guide, however the tool\'s move and blur fail', () => {
    let broken = false
    const failingHover = { setHoveredTarget: () => { if (broken) throw new Error('hover failed') } }
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    rulers.host.style.cursor = 'crosshair'
    const failingDrag = (): void => {
      const interrupted = vi.spyOn(builtHosts.at(-1)!, 'interrupted')
      events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
      broken = true
      try {
        // Today's ruler heard its own mousemove and blur: the tool's failures left its drag to it.
        captureWindowErrors(() => { events.pointerMove({ x: 180, y: 60 }) })
        expect(rulers.host.style.cursor).toBe('s-resize')
        expect(captureWindowErrors(() => { events.windowBlur() })).toHaveLength(1)
      } finally {
        broken = false
      }
      expect(rulers.host.style.cursor).toBe('crosshair')
      // The rest of today's blur (Space, the keys, the host's interruption) still runs.
      expect(interrupted).toHaveBeenCalledOnce()
      events.pointerUp({ x: 180, y: 100 })
      expect(rulers.onGuideCreate).not.toHaveBeenCalled()
    }

    const { session } = createSession(failingHover)
    failingDrag()
    session.dispose()

    useStubTools(stubTool('select'))
    createSession(failingHover)
    failingDrag()
  })

  it('a ruler guide lands only while north is up, under a bridged and a registered tool', () => {
    const rotated = createTestView({ screen: { width: 400, height: 300 }, camera: { bearingDeg: 30 } })
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    const drag = (): void => {
      events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
      events.pointerMove({ x: 180, y: 60 })
      events.pointerUp({ x: 180, y: 100 })
    }

    try {
      createSession({ frames: rotated.frames }).session
      drag()
      sessions.pop()!.dispose()
      useStubTools(stubTool('select'))
      createSession({ frames: rotated.frames })
      drag()
      expect(rulers.onGuideCreate).not.toHaveBeenCalled()
      sessions.pop()!.dispose()

      // North up, the same drag lands its guide.
      createSession()
      drag()
      expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    } finally {
      rotated.dispose()
    }
  })

  it('a ruler guide lands with the rulers\' camera at its release', () => {
    createSession()
    const rulers = mountRulers(rulerCamera({ y: 10, scale: 2 }))

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    rulers.show(rulerCamera({ y: 40, scale: 4, revision: 2 }))
    events.pointerUp({ x: 180, y: 90 })

    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 12.5)
  })

  it('a ruler drag started before the rulers hide lands no guide', () => {
    createSession()
    const rulers = mountRulers()
    rulers.host.style.cursor = 'crosshair'

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 50 })
    expect(rulers.host.style.cursor).toBe('s-resize')
    rulers.show(rulerCamera(), false)
    expect(rulers.host.style.cursor).toBe('crosshair')
    events.pointerMove({ x: 180, y: 70 })
    // Shown again before the release: the drag began before the hide, so it still lands nothing.
    rulers.show(rulerCamera())
    events.pointerUp({ x: 180, y: 90 })

    expect(rulers.host.style.cursor).toBe('crosshair')
    expect(rulers.onGuideCreate).not.toHaveBeenCalled()
  })

  it('a ruler drag across overview entry lands no guide, and the rulers hide', () => {
    createSession()
    const rulers = mountRulers()
    rulers.host.style.cursor = 'crosshair'

    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 50 })
    expect(rulers.host.style.cursor).toBe('s-resize')
    rulers.show(rulerCamera({ scale: 0.01 }))
    events.pointerUp({ x: 180, y: 90 })

    expect(rulers.horizontal.style.display).toBe('none')
    expect(rulers.vertical.style.display).toBe('none')
    expect(rulers.host.style.cursor).toBe('crosshair')
    expect(rulers.onGuideCreate).not.toHaveBeenCalled()
  })

  it('a registered tool\'s ruler drag goes through the host to the pressed ruler\'s overlay', () => {
    const select = stubTool('select')
    useStubTools(select)
    createSession()
    const rawPress = vi.spyOn(builtHosts.at(-1)!, 'rawPress')
    const rulers = mountRulers(rulerCamera({ y: 20, scale: 4 }))
    rulers.host.style.cursor = 'crosshair'
    const toolCursor = container.style.cursor

    const down = events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 60 })
    // Today's drag cursor went on the rulers' overlay, never on the map, which kept the tool's.
    expect(rulers.host.style.cursor).toBe('s-resize')
    expect(container.style.cursor).toBe(toolCursor)
    events.pointerUp({ x: 180, y: 100 })
    expect(rulers.host.style.cursor).toBe('crosshair')
    expect(container.style.cursor).toBe(toolCursor)

    expect(down.defaultPrevented).toBe(true)
    expect(rawPress).not.toHaveBeenCalled()
    expect(rulers.onGuideCreate).toHaveBeenCalledExactlyOnceWith('h', 20)
    // The host kept the drag to itself: the tool heard no press or drag.
    expect(select.gestures.filter((gesture) => gesture.kind !== 'hover' && gesture.kind !== 'hover-end')).toEqual([])

    // A press before the rulers hide lands nothing on the host's path either.
    events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 60 })
    rulers.show(rulerCamera({ y: 20, scale: 4 }), false)
    rulers.show(rulerCamera({ y: 20, scale: 4 }))
    events.pointerUp({ x: 180, y: 100 })
    expect(rulers.onGuideCreate).toHaveBeenCalledOnce()
  })
})
