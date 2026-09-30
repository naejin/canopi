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
  selectSavedObjectStampSourceForTests,
  writeSavedObjectStampDragData,
} from '../saved-object-stamp-source'
import { setCanvasTool } from '../session-state'
import type { CanvasFocusPort } from './app-adapter'
import { createRulerOverlay, type RulerOverlay } from './chrome/rulers'
import type { InputPlatform } from './input/platform'
import type { ToolHost, ToolHostDeps } from './interaction-ports'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from './interaction-session'
import type { CameraController, CameraViewportSnapshot } from './camera'
import { SceneStore } from './scene'
import type { DraftPresentation } from './tools/draft'
import type { ToolSource } from './tools/tool'

vi.mock('./tools/registry', () => ({ TOOL_REGISTRY: {} }))

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

    const down = events.pointerDown({ x: 180, y: 10 }, { target: rulers.horizontal })
    events.pointerMove({ x: 180, y: 60 })
    events.pointerUp({ x: 180, y: 100 })

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
