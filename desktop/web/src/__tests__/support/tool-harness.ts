// __tests__/support/tool-harness.ts  (test support)
//
// The ToolHarness (spec §1.8): how tool and ToolHost tests build a scene and the ToolScene over it, and drive a real
// ToolHost with gesture scripts (below). Scenes are real SceneStores in session-plane metres; the scene source reads the
// frame scale, the species cache and the localised names through injected functions, as interaction-session.ts passes
// the runtime's.

import { signal } from '@preact/signals'
import type { CanvasToolGuidance } from '../../canvas/session-state'
import { createSessionPlane, type GeoPosition, type SessionPlane } from '../../canvas/session-plane'
import { LEGACY_BINDINGS } from '../../canvas/runtime/input/bindings'
import type { Gesture, MenuSource, PressTarget } from '../../canvas/runtime/input/gestures'
import { createInputRouter } from '../../canvas/runtime/input/input-router'
import type {
  ContextMenuPort,
  GestureOutcome,
  RulerGuidePort,
  ToolHost,
  ToolHostDeps,
  ToolSceneSource,
} from '../../canvas/runtime/interaction-ports'
import type { CancelReason, Modifiers, PointerKind, ToolHandleId, ToolId } from '../../canvas/runtime/interaction-types'
import type { PlantPresentationContext } from '../../canvas/runtime/plant-presentation'
import type { SpeciesCacheEntry } from '../../canvas/runtime/presentation-data'
import {
  SceneStore,
  type SceneAnnotationEntity,
  type SceneDesignObjectTarget,
  type SceneMeasurementGuideEntity,
  type ScenePersistedState,
  type ScenePlantEntity,
  type ScenePoint,
  type SceneZoneEntity,
} from '../../canvas/runtime/scene'
import { SceneHistory } from '../../canvas/runtime/scene-history'
import {
  applySceneDragDeltaToDraft,
  captureSceneDragState,
  createSceneDragState,
  type SceneDragState,
} from '../../canvas/runtime/scene-runtime/drag-state'
import { getDesignObjectSelectionModel } from '../../canvas/runtime/scene-runtime/selection'
import {
  SceneRuntimeEditCoordinator,
  type SceneCommandAdmission,
  type SceneEditCoordinator,
  type SceneEditTransaction,
} from '../../canvas/runtime/scene-runtime/transactions'
import type { ToolHandle } from '../../canvas/runtime/tools/draft'
import { TOOL_REGISTRY, type ToolFactory } from '../../canvas/runtime/tools/registry'
import type { SnapSettings } from '../../canvas/runtime/tools/snapping'
import type {
  CanvasTool,
  TextEntryRequest,
  ToolCommand,
  ToolContext,
  ToolGesture,
  ToolSource,
} from '../../canvas/runtime/tools/tool'
import { createToolHost, createToolScene } from '../../canvas/runtime/tools/tool-host'
import type { ScreenPoint, WorldPoint } from '../../canvas/runtime/view/types'
import { createRecordingRenderer, type RecordingRenderer } from './recording-renderer'
import { createTestView, type TestView } from './test-view'

export function plantEntity(
  id: string,
  canonicalName: string,
  position: ScenePoint,
  overrides: Partial<ScenePlantEntity> = {},
): ScenePlantEntity {
  return {
    kind: 'plant',
    id,
    locked: false,
    canonicalName,
    commonName: canonicalName,
    color: null,
    stratum: null,
    canopySpreadM: 2,
    position,
    rotationDeg: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}

export function rectZone(
  id: string,
  points: SceneZoneEntity['points'],
  overrides: Partial<SceneZoneEntity> = {},
): SceneZoneEntity {
  return {
    kind: 'zone',
    id,
    name: null,
    locked: false,
    zoneType: 'rect',
    points,
    rotationDeg: 0,
    fillColor: null,
    notes: null,
    ...overrides,
  }
}

export function textNote(
  id: string,
  position: ScenePoint,
  text: string,
  overrides: Partial<SceneAnnotationEntity> = {},
): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id,
    locked: false,
    annotationType: 'text',
    position,
    text,
    fontSize: 16,
    rotationDeg: null,
    ...overrides,
  }
}

export function measurementGuide(
  id: string,
  start: ScenePoint,
  end: ScenePoint,
  overrides: Partial<SceneMeasurementGuideEntity> = {},
): SceneMeasurementGuideEntity {
  return { kind: 'measurement-guide', id, locked: false, start, end, ...overrides }
}

/** A scene store holding `scene` (on the default new-Design layers unless it names its own). */
export function sceneStoreWith(scene: Partial<ScenePersistedState>): SceneStore {
  const store = new SceneStore()
  store.updatePersisted((draft) => {
    Object.assign(draft, scene)
  })
  return store
}

export interface ToolSceneSourceOptions {
  /** The frame's pixelsPerMetre; default 1 (the split suites' camera). */
  readonly pixelsPerMetre?: () => number
  readonly speciesCache?: ReadonlyMap<string, SpeciesCacheEntry>
  readonly localizedCommonNames?: ReadonlyMap<string, string | null>
  readonly isLayerOpenForCreation?: ToolSceneSource['isLayerOpenForCreation']
}

/** The ToolScene source over a scene store, read live as the runtime's is. */
export function createToolSceneSource(store: SceneStore, options: ToolSceneSourceOptions = {}): ToolSceneSource {
  const speciesCache = options.speciesCache ?? new Map<string, SpeciesCacheEntry>()
  const plantContext = (pixelsPerMetre: number): PlantPresentationContext => ({
    viewport: { x: 0, y: 0, scale: pixelsPerMetre },
    speciesCache,
    ...(options.localizedCommonNames ? { localizedCommonNames: options.localizedCommonNames } : {}),
  })
  const pixelsPerMetre = options.pixelsPerMetre ?? (() => 1)
  return {
    store,
    sceneRevision: signal(0),
    selection: () => store.session.selectedTargets,
    isLayerOpenForCreation: options.isLayerOpenForCreation ?? ((layer) => {
      const entry = store.persisted.layers.find((candidate) => candidate.name === layer)
      return entry?.visible !== false && entry?.locked !== true
    }),
    pixelsPerMetre,
    speciesCache: () => speciesCache,
    plantContext,
    selectionModel: () => {
      const scale = pixelsPerMetre()
      return getDesignObjectSelectionModel(store.persisted, store.session.selectedTargets, {
        annotationViewportScale: scale,
        plantContext: { ...plantContext(scale), plants: store.persisted.plants },
      })
    },
  }
}

// ── The host harness ────────────────────────────────────────────────────────────────────────────────────────────────
//
// createToolHarness runs gesture scripts through a real createToolHost, with the input router in front of it and a
// recording ToolHostDeps behind it. The scripts send what the LEGACY recogniser emits (slop 0: any movement after a press
// is a drag) and do what interaction-session.ts does around it: they ask retryPendingCancellation before routing, end a
// session the host rejected, end the nudge series on focus-out and call interrupted after a blur. Tools come from
// tools/registry.ts, which a test replaces through vi.mock('…/tools/registry', () => ({ TOOL_REGISTRY: {} })) and fills
// with useStubTools.

export interface StubToolRecord {
  readonly gestures: ToolGesture[]
  readonly commands: ToolCommand[]
  /** 'activate', 'deactivate:<reason>', 'cancelTransient:<reason>', 'viewChanged', 'planeChanged', 'sceneChanged', 'sourceChanged'. */
  readonly calls: string[]
}

export interface StubTool extends CanvasTool, StubToolRecord {
  /** The context of the last activation. */
  ctx(): ToolContext
  /** The last gesture of `kind` the tool received. */
  last<K extends ToolGesture['kind']>(kind: K): (ToolGesture & { readonly kind: K }) | undefined
  /** How many gestures of `kind` the tool received. */
  count(kind: ToolGesture['kind']): number
}

/** What a stub does besides recording; every member defaults to a quiet tool that passes. */
export type StubToolBehaviour = Partial<Omit<CanvasTool, 'id'>>

/** A recording CanvasTool standing in for a real one (a stub 'polygon' checks the host's plumbing, not Polygon's rules). */
export function stubTool(id: ToolId, behaviour: StubToolBehaviour = {}): StubTool {
  const gestures: ToolGesture[] = []
  const commands: ToolCommand[] = []
  const calls: string[] = []
  let context: ToolContext | null = null
  const { activate, gesture, command, cancelTransient, deactivate, sceneChanged, planeChanged, viewChanged, sourceChanged, ...rest } = behaviour
  return {
    ...rest,
    id,
    gestures,
    commands,
    calls,
    ctx() {
      if (!context) throw new Error(`The stub ${id} was never activated.`)
      return context
    },
    last(kind) {
      for (let index = gestures.length - 1; index >= 0; index -= 1) {
        const entry = gestures[index]!
        if (entry.kind === kind) return entry as never
      }
      return undefined
    },
    count: (kind) => gestures.filter((entry) => entry.kind === kind).length,
    activate(ctx, source) {
      context = ctx
      calls.push('activate')
      activate?.(ctx, source)
    },
    sourceChanged(source) {
      calls.push('sourceChanged')
      sourceChanged?.(source)
    },
    gesture(g) {
      gestures.push(g)
      return gesture?.(g) ?? 'pass'
    },
    command(c) {
      commands.push(c)
      return command?.(c) ?? 'pass'
    },
    sceneChanged() {
      calls.push('sceneChanged')
      sceneChanged?.()
    },
    planeChanged(reproject) {
      calls.push('planeChanged')
      planeChanged?.(reproject)
    },
    viewChanged() {
      calls.push('viewChanged')
      viewChanged?.()
    },
    hasTransient: rest.hasTransient ?? (() => false),
    escapeHint: rest.escapeHint ?? (() => null),
    cancelTransient(reason) {
      calls.push(`cancelTransient:${reason}`)
      cancelTransient?.(reason)
    },
    deactivate(reason) {
      calls.push(`deactivate:${reason}`)
      deactivate?.(reason)
    },
  }
}

/** Lists exactly `tools` in the vi.mock'ed tools/registry.ts, each factory returning its stub. */
export function useStubTools(...tools: readonly CanvasTool[]): void {
  const registry = TOOL_REGISTRY as Partial<Record<ToolId, ToolFactory>>
  if (Object.isFrozen(registry)) {
    throw new Error('useStubTools needs tools/registry.ts replaced: vi.mock(\'…/tools/registry\', () => ({ TOOL_REGISTRY: {} })).')
  }
  for (const id of Object.keys(registry) as ToolId[]) delete registry[id]
  for (const tool of tools) registry[tool.id] = () => tool
}

export const NO_MODIFIERS: Modifiers = Object.freeze({ shift: false, ctrl: false, alt: false, meta: false })

export interface ToolHarnessOptions {
  readonly scene?: Partial<ScenePersistedState>
  /** Armed when the host is built; default 'select'. */
  readonly tool?: ToolId
  /** Bearing-0 placement (screen = world × scale + { x, y }); default { x: 0, y: 0, scale: 1 }, on a 400 × 300 screen. */
  readonly viewport?: { readonly x: number; readonly y: number; readonly scale: number }
  readonly snapping?: SnapSettings
  /** Default: the scene's edit coordinator, as the runtime passes it. */
  readonly admission?: SceneCommandAdmission
  /** Default: the scene's edit coordinator over the harness's history. */
  readonly edits?: SceneEditCoordinator
  readonly inspect?: (world: WorldPoint) => boolean
  readonly rulers?: RulerGuidePort
  /** Default: a series over the edit coordinator, one Scene Edit until endNudge, as the runtime's. */
  readonly nudge?: ToolHostDeps['nudge']
}

export interface ToolHarnessRecord {
  invalidations: number
  transientHistoryChanges: number
  readonly hovers: (SceneDesignObjectTarget | null)[]
  readonly pointerWorld: (WorldPoint | null)[]
  readonly selections: (readonly SceneDesignObjectTarget[])[]
  readonly guidance: (Partial<CanvasToolGuidance> | null)[]
  readonly focus: string[]
  readonly menus: Parameters<ContextMenuPort['open']>[0][]
  readonly nudges: string[]
}

export interface ToolHarnessChrome {
  readonly handles: readonly ToolHandle[]
  readonly activeHandle: ToolHandleId | null
  readonly cursor: string
  readonly tooltip: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null
  readonly lockedAffordance: { readonly target: SceneDesignObjectTarget; readonly at: ScreenPoint } | null
  readonly textEntry: { readonly request: TextEntryRequest; readonly submit: (text: string) => 'close' | 'keep' } | null
}

export interface PressOptions {
  readonly mods?: Partial<Modifiers>
  readonly target?: PressTarget
  readonly pointer?: PointerKind
  readonly clickCount?: number
}

export interface ToolHarness {
  readonly host: ToolHost
  readonly view: TestView
  readonly store: SceneStore
  readonly history: SceneHistory
  readonly edits: SceneEditCoordinator
  readonly renderer: RecordingRenderer
  readonly chrome: ToolHarnessChrome
  readonly record: ToolHarnessRecord
  /** Settings › Canvas snapping, read by the host at each point. */
  snapping: SnapSettings
  /** The session's plane (ToolHostDeps.plane). */
  readonly plane: SessionPlane
  /** The world point under a screen point of the current frame. */
  world(at: ScreenPoint): WorldPoint
  /** Arms a tool as the session does: its tool signal, then ToolHost.setTool. */
  arm(id: ToolId, source?: ToolSource | null): void
  select(...targets: SceneDesignObjectTarget[]): void
  hover(at: ScreenPoint, mods?: Partial<Modifiers>): GestureOutcome
  leave(): GestureOutcome
  press(at: ScreenPoint, options?: PressOptions): GestureOutcome
  /** A move: drag-start, then drag-move while a press is live; a hover otherwise. */
  move(at: ScreenPoint, mods?: Partial<Modifiers>): GestureOutcome
  /** Up: a tap without movement, a drag-end after one. */
  release(at?: ScreenPoint, mods?: Partial<Modifiers>): GestureOutcome
  click(at: ScreenPoint, options?: PressOptions): GestureOutcome
  drag(from: ScreenPoint, to: ScreenPoint, options?: PressOptions): GestureOutcome
  cancel(reason: CancelReason): GestureOutcome
  wheelZoom(at: ScreenPoint, factor: number): GestureOutcome
  menu(at: ScreenPoint | 'selection', source?: MenuSource): GestureOutcome
  /** An arrow key as the keyboard port sends it to the host. */
  arrow(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', large?: boolean): ReturnType<ToolHost['nudge']>
  focusOut(): void
  /** A window blur: the recogniser ends the live session, then the session calls interrupted. */
  blur(): void
  /** A re-origin: the session's plane moves to `origin` and the camera follows it. */
  reorigin(origin: GeoPosition): void
  /** Runs the manual clock: camera frames, then the host's timers. */
  advance(ms: number): void
  /** Edit › Undo on the scene's history (not the transient history). */
  undo(): boolean
  dispose(): void
}

const ARROW_DIRECTIONS = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
} as const

export function createToolHarness(options: ToolHarnessOptions = {}): ToolHarness {
  let plane = createSessionPlane({ lon: 0, lat: 0 })
  const view = createTestView({ plane, ...(options.viewport ? { viewport: options.viewport } : {}) })
  const store = sceneStoreWith(options.scene ?? {})
  const history = new SceneHistory()
  const coordinator = new SceneRuntimeEditCoordinator({
    sceneStore: store,
    history,
    setSelection: (targets) => store.setSelection(targets),
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidate: () => {},
  })
  const edits = options.edits ?? coordinator
  const renderer = createRecordingRenderer()
  const record: ToolHarnessRecord = {
    invalidations: 0,
    transientHistoryChanges: 0,
    hovers: [],
    pointerWorld: [],
    selections: [],
    guidance: [],
    focus: [],
    menus: [],
    nudges: [],
  }
  const chrome = {
    handles: [] as readonly ToolHandle[],
    activeHandle: null as ToolHandleId | null,
    cursor: 'default',
    tooltip: null as ToolHarnessChrome['tooltip'],
    lockedAffordance: null as ToolHarnessChrome['lockedAffordance'],
    textEntry: null as ToolHarnessChrome['textEntry'],
  }
  let menuOpen = false
  const timers = createHarnessTimers(() => view.clock.now())
  const toolState = signal<ToolId>(options.tool ?? 'select')
  const scene = createToolScene(createToolSceneSource(store, { pixelsPerMetre: () => view.view().pixelsPerMetre }))
  let snapping: SnapSettings = options.snapping ?? { grid: false, guides: false }

  const host = createToolHost({
    frames: view.frames,
    scene,
    edits,
    admission: options.admission ?? coordinator,
    settled: coordinator,
    setSelection(targets) {
      store.setSelection(targets)
      record.selections.push([...targets])
    },
    plane: () => plane,
    renderer,
    invalidate: () => {
      record.invalidations += 1
    },
    chrome: {
      setHandles(handles, active) {
        chrome.handles = handles
        chrome.activeHandle = active
      },
      setCursor(cursor) {
        chrome.cursor = cursor
      },
      requestTextEntry(request, submit) {
        chrome.textEntry = { request, submit }
      },
      closeTextEntry() {
        chrome.textEntry = null
      },
      setTooltip(tooltip) {
        chrome.tooltip = tooltip
      },
      setLockedAffordance(affordance) {
        chrome.lockedAffordance = affordance
      },
    },
    menu: {
      open(request) {
        record.menus.push(request)
        menuOpen = true
      },
      close() {
        menuOpen = false
      },
      isOpen: () => menuOpen,
    },
    focus: {
      focusMap(reason) {
        record.focus.push(`map:${reason}`)
        // The text entry commits on its blur.
        const entry = chrome.textEntry
        if (entry && entry.submit(entry.request.initialText) === 'close') chrome.textEntry = null
      },
      focusToolCardField(reason) {
        record.focus.push(`tool-card-field:${reason}`)
      },
    },
    guidance: (guidance) => {
      record.guidance.push(guidance)
    },
    toolState: {
      active: toolState,
      set(id) {
        toolState.value = id
      },
    },
    settings: {
      plantSpacingIntervalM: () => 1,
      commitPlantSpacingIntervalM: () => {},
    },
    snapping: () => snapping,
    translate: (key) => key,
    bindings: () => LEGACY_BINDINGS,
    platform: { os: 'linux', engine: 'chromium', gestureEvents: false },
    navigation: view.navigation,
    nudge: options.nudge ?? createNudgeSeries(store, edits, record),
    timers: { ...timers, clock: () => view.clock.now() },
    hover(target) {
      store.setHoveredTarget(target)
      record.hovers.push(target)
    },
    ...(options.inspect ? { inspect: options.inspect } : {}),
    ...(options.rulers ? { rulers: options.rulers } : {}),
    transientHistoryChanged: () => {
      record.transientHistoryChanges += 1
    },
  })
  host.subscribePointerWorld((point) => {
    record.pointerWorld.push(point)
  })
  const router = createInputRouter({ navigation: view.navigation, toolHost: host })

  let nextPointerId = 1
  let session: {
    readonly id: number
    readonly from: ScreenPoint
    readonly pointer: PointerKind
    readonly target: PressTarget
    readonly clickCount: number
    last: ScreenPoint
    dragged: boolean
  } | null = null

  const mods = (partial: Partial<Modifiers> = {}): Modifiers => ({ ...NO_MODIFIERS, ...partial })

  /** The session's routing: a failed cancellation is retried (and the event quarantined) before anything is routed. */
  function route(g: Gesture): GestureOutcome {
    if (host.retryPendingCancellation()) {
      return g.kind === 'press' ? { quarantine: true, rejectSession: true } : { quarantine: true }
    }
    return router.route(g)
  }

  const harness: ToolHarness = {
    host,
    view,
    store,
    history,
    edits,
    renderer,
    chrome,
    record,
    get snapping() {
      return snapping
    },
    set snapping(next) {
      snapping = next
    },
    get plane() {
      return plane
    },
    world(at) {
      const world = view.view().screenToWorld(at)
      if (!world) throw new Error('The test view has no ground under that point.')
      return world
    },
    arm(id, source = null) {
      toolState.value = id
      host.setTool(id, source)
    },
    select(...targets) {
      store.setSelection(targets)
      host.sceneChanged()
    },
    hover: (at, partial) => route({ kind: 'hover', at, pointer: 'mouse', mods: mods(partial) }),
    leave: () => route({ kind: 'hover-end' }),
    press(at, pressOptions = {}) {
      const id = nextPointerId++
      const target = pressOptions.target ?? { kind: 'surface' }
      const pointer = pressOptions.pointer ?? 'mouse'
      const clickCount = pressOptions.clickCount ?? 1
      const outcome = route({ kind: 'press', id, at, pointer, mods: mods(pressOptions.mods), clickCount, target })
      session = outcome.rejectSession ? null : { id, from: at, pointer, target, clickCount, last: at, dragged: false }
      return outcome
    },
    move(at, partial) {
      const live = session
      if (!live) return harness.hover(at, partial)
      live.last = at
      if (!live.dragged) {
        live.dragged = true
        return route({ kind: 'drag-start', id: live.id, from: live.from, at, pointer: live.pointer, mods: mods(partial), target: live.target })
      }
      return route({ kind: 'drag-move', id: live.id, at, mods: mods(partial) })
    },
    release(at, partial) {
      const live = session
      if (!live) return {}
      session = null
      const point = at ?? live.last
      if (live.dragged) return route({ kind: 'drag-end', id: live.id, at: point, mods: mods(partial) })
      return route({ kind: 'tap', id: live.id, at: point, pointer: live.pointer, mods: mods(partial), clickCount: live.clickCount, target: live.target })
    },
    click(at, pressOptions) {
      const outcome = harness.press(at, pressOptions)
      if (outcome.rejectSession) return outcome
      return harness.release(at, pressOptions?.mods)
    },
    drag(from, to, pressOptions) {
      const outcome = harness.press(from, pressOptions)
      if (outcome.rejectSession) return outcome
      harness.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, pressOptions?.mods)
      harness.move(to, pressOptions?.mods)
      return harness.release(to, pressOptions?.mods)
    },
    cancel(reason) {
      if (!session) return {}
      session = null
      return route({ kind: 'cancel', reason })
    },
    wheelZoom: (at, factor) => route({ kind: 'zoom', anchorPx: at, factor, source: 'wheel' }),
    menu: (at, source = 'mouse') => route({ kind: 'menu-request', at, source }),
    arrow: (key, large = false) => host.nudge(ARROW_DIRECTIONS[key], large),
    focusOut() {
      host.endNudgeSeries(true)
    },
    blur() {
      harness.cancel('blur')
      host.interrupted()
    },
    reorigin(origin) {
      const next = createSessionPlane(origin)
      plane = next
      view.host.current().planeChanged(next)
    },
    advance(ms) {
      view.clock.advance(ms)
      timers.runDue()
    },
    undo: () => coordinator.undo(),
    dispose() {
      host.dispose()
      view.dispose()
    },
  }
  return harness
}

/** Timers on the test view's manual clock; the harness runs the due ones after each advance. */
function createHarnessTimers(now: () => number) {
  let nextId = 1
  const pending = new Map<number, { readonly atMs: number; readonly run: () => void }>()
  return {
    set(atMs: number, run: () => void): number {
      const id = nextId++
      pending.set(id, { atMs, run })
      return id
    },
    clear(id: number): void {
      pending.delete(id)
    },
    runDue(): void {
      for (;;) {
        let due: [number, { readonly atMs: number; readonly run: () => void }] | null = null
        for (const entry of pending) {
          if (entry[1].atMs <= now() && (!due || entry[1].atMs < due[1].atMs)) due = entry
        }
        if (!due) return
        pending.delete(due[0])
        due[1].run()
      }
    },
  }
}

/** The runtime's nudge series in miniature: one Scene Edit from the first step until endNudge commits or aborts it. */
function createNudgeSeries(
  store: SceneStore,
  edits: SceneEditCoordinator,
  record: ToolHarnessRecord,
): ToolHostDeps['nudge'] {
  let series: { readonly edit: SceneEditTransaction; readonly state: SceneDragState; total: ScenePoint } | null = null
  return {
    nudgeSelected(delta) {
      record.nudges.push(`nudge:${delta.x},${delta.y}`)
      if (!series) {
        if (store.session.selectedTargets.length === 0) return false
        const state = createSceneDragState()
        captureSceneDragState(state, store.persisted, store.session.selectedTargets)
        series = { edit: edits.begin('keyboard-nudge'), state, total: { x: 0, y: 0 } }
      }
      const open = series
      open.total = { x: open.total.x + delta.x, y: open.total.y + delta.y }
      open.edit.mutate((draft) => applySceneDragDeltaToDraft(draft, open.state, open.total))
      return true
    },
    endNudge(endOptions) {
      record.nudges.push(endOptions?.abort ? 'end:abort' : 'end')
      const open = series
      if (!open) return
      series = null
      if (endOptions?.abort) open.edit.abort()
      else open.edit.commit()
    },
  }
}
