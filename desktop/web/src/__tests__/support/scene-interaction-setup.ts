// Shared setup of the SceneInteractionSession suites (__tests__/scene-interaction.*.test.ts):
// the fakes and helpers above the suites, and installSceneInteractionFixture, the
// describe-scope fixture each suite installs. Split from scene-interaction.test.ts in the
// canvas v2 seams commit; the helper bodies are unchanged.
import { signal } from '@preact/signals'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { clearPlantStampSource } from '../../canvas/plant-stamp-source'
import { clearSavedObjectStampSource } from '../../canvas/saved-object-stamp-source'
import {
  IDLE_CANVAS_TOOL_GUIDANCE,
  selectedObjectIds,
  setCanvasTool,
  setCanvasToolGuidance,
} from '../../canvas/session-state'
import { h, render as renderPreact } from 'preact'
import { setupRerender, teardown as teardownPreactTestUtils } from 'preact/test-utils'
import { ToolCard } from '../../components/canvas/ToolCard'
import { setCanvasRuntimeSurfaces } from '../../canvas/session'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './canvas-query-surface'
import { snapToGridEnabled, snapToGuidesEnabled } from '../../app/canvas-settings/signals'
import { plantSpacingIntervalM } from '../../app/settings/state'
import { t } from '../../i18n'
import { CameraController } from '../../canvas/runtime/camera'
import type { MapLibreWorkspaceCameraMap } from '../../maplibre/workspace-camera'
import {
  SceneStore,
  roundGeoPosition,
  type SceneAnnotationEntity,
  type SceneDesignObjectTarget,
  type SceneMeasurementGuideEntity,
  type ScenePlantEntity,
  type ScenePoint,
  type SceneZoneEntity,
} from '../../canvas/runtime/scene'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from '../../canvas/runtime/scene-interaction'
import type { CanvasDesignObjectSelectionModel } from '../../canvas/runtime/runtime'
import type {
  CanvasContextMenuRequest,
  CanvasRuntimeContextMenuAdapter,
} from '../../canvas/runtime/app-adapter'
import {
  buildCanvasContextMenuEntries,
  type CanvasContextMenuCommand,
  type CanvasContextMenuItemId,
} from '../../app/canvas-context-menu/entries'
import { getDesignObjectSelectionModel } from '../../canvas/runtime/scene-runtime/selection'
import { SceneHistory } from '../../canvas/runtime/scene-history'
import {
  SceneRuntimeEditCoordinator,
  type SceneCommandAdmission,
  type SceneEditCoordinator,
  type SceneEditTransaction,
  type SettledSceneReader,
} from '../../canvas/runtime/scene-runtime/transactions'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './scene-interaction-events'

/** The canonical lon/lat a changed plane position serializes to. */
export function storedGeo(store: SceneStore, point: { x: number; y: number }) {
  return roundGeoPosition(store.sessionPlane.toGeo(point))
}

export function createPlantPresentationContext(viewportScale: number) {
  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    speciesCache: new Map(),
  }
}

export class AttachedInteractionMap implements MapLibreWorkspaceCameraMap {
  readonly canvas = document.createElement('canvas')
  readonly jumpTo = vi.fn()
  readonly resize = vi.fn()
  readonly on = vi.fn()
  readonly off = vi.fn()
  readonly project = vi.fn(() => this.projection[this.projectIndex++ % this.projection.length]!)
  readonly getPitch = vi.fn(() => 0)
  readonly getZoom = vi.fn(() => 18)
  readonly getMinZoom = vi.fn(() => 0)
  readonly getMaxZoom = vi.fn(() => 27)
  readonly getCenter = vi.fn(() => ({ lng: 2.3522, lat: 48.8566 }))
  readonly getCanvas = vi.fn(() => this.canvas)

  private projectIndex = 0
  private readonly projection = [{ x: 100, y: 50 }, { x: 102, y: 50 }, { x: 100, y: 52 }]

  constructor() {
    Object.defineProperties(this.canvas, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      width: { configurable: true, value: 800 },
      height: { configurable: true, value: 600 },
    })
  }
}

/** Stands in for the app's right-click menu: records what the runtime asks it to show. */
export const contextMenuHost = {
  current: null as CanvasContextMenuRequest | null,
  opened: [] as CanvasContextMenuRequest[],
  adapter: {
    open: (request) => {
      contextMenuHost.current = request
      contextMenuHost.opened.push(request)
    },
    close: (request) => {
      if (contextMenuHost.current === request) contextMenuHost.current = null
    },
  } satisfies CanvasRuntimeContextMenuAdapter,
  reset(): void {
    this.current = null
    this.opened = []
  },
}

export function contextMenuEntryOptions() {
  return {
    translate: t,
    openPlantAppearance: vi.fn(),
    summary: null,
    openSpeciesDetail: vi.fn(),
    addToCalendar: vi.fn(),
    setUnitCost: vi.fn(),
  }
}

/** The open menu's command, as the app renders it. */
export function contextMenuCommand(id: CanvasContextMenuItemId): CanvasContextMenuCommand {
  const request = contextMenuHost.current
  if (!request) throw new Error('No context menu is open')
  // Arrange ▸ holds stacking and grouping one level down.
  const entry = buildCanvasContextMenuEntries(request, contextMenuEntryOptions())
    .flatMap((candidate) => 'submenu' in candidate ? candidate.submenu : [candidate])
    .find((candidate): candidate is CanvasContextMenuCommand => 'run' in candidate && candidate.id === id)
  if (!entry) throw new Error(`The context menu has no '${id}' item`)
  return entry
}

/** Right-clicks the map at a container point; returns the dispatched event. */
export function dispatchContextMenu(container: HTMLElement, client: ScenePoint): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: client.x,
    clientY: client.y,
  })
  container.dispatchEvent(event)
  return event
}

export function contextMenuItemIds(): readonly string[] {
  const request = contextMenuHost.current
  if (!request) return []
  return buildCanvasContextMenuEntries(request, contextMenuEntryOptions())
    .flatMap((entry) => 'id' in entry ? [entry.id] : [])
}

export function createInteractionDeps(
  container: HTMLDivElement,
  store: SceneStore,
  camera: CameraController,
  overrides: Partial<Pick<SceneInteractionSessionDeps,
    | 'render'
    | 'sceneEdits'
    | 'commandAdmission'
    | 'settledReader'
    | 'getDesignObjectSelection'
    | 'selectionCommands'
    | 'setTool'
    | 'setHoveredTarget'
    | 'getPlantPresentationContext'
    | 'readPlantSpacingIntervalMeters'
    | 'commitPlantSpacingIntervalMeters'
    | 'translate'
    | 'contextMenu'
    | 'publishToolGuidance'
    | 'nudge'
    | 'readSingleKeyShortcuts'
  >>
    & { onSceneEditCommit?: (type: string) => void } = {},
): SceneInteractionSessionDeps {
  let selection: SceneDesignObjectTarget[] = []
  const setSelection = vi.fn((targets: Iterable<SceneDesignObjectTarget>) => {
    selection = [...targets].map((target) => ({ ...target }))
    store.setSelection(selection)
    selectedObjectIds.value = new Set(selection.map((target) => target.id))
  })
  const clearSelection = vi.fn(() => {
    selection = []
    store.setSelection(selection)
    selectedObjectIds.value = new Set()
  })
  const render = (overrides.render ?? (() => {})) as SceneInteractionSessionDeps['render']
  const history = new SceneHistory()
  if (overrides.onSceneEditCommit) {
    const record = history.record.bind(history)
    vi.spyOn(history, 'record').mockImplementation((command, transaction) => {
      overrides.onSceneEditCommit?.(command.type)
      return record(command, transaction)
    })
  }
  const sceneEdits = overrides.sceneEdits ?? new SceneRuntimeEditCoordinator({
    sceneStore: store,
    history,
    setSelection,
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidate: (kind) => {
      if (kind === 'scene' || kind === 'viewport') render(kind)
    },
  })
  const commandAdmission = overrides.commandAdmission
    ?? ('runWhenSettled' in sceneEdits
      ? sceneEdits as unknown as SceneCommandAdmission
      : {
          revision: signal(0),
          runWhenSettled: <T,>(operation: () => T): T => operation(),
        })
  const settledReader = overrides.settledReader
    ?? ('readWhenSettled' in sceneEdits
      ? sceneEdits as unknown as SettledSceneReader
      : {
          revision: signal(0),
          readWhenSettled: <T,>(operation: () => T): T => operation(),
        })

  return {
    container,
    getSceneStore: () => store,
    camera,
    cameraNavigation: camera,
    getSpeciesCache: () => new Map(),
    getPlantPresentationContext: overrides.getPlantPresentationContext ?? createPlantPresentationContext,
    getSelection: () => selection.map((target) => ({ ...target })),
    setSelection,
    clearSelection,
    sceneEdits,
    commandAdmission,
    settledReader,
    getDesignObjectSelection: overrides.getDesignObjectSelection ?? (() =>
      getDesignObjectSelectionFromStore(store, camera)
    ),
    selectionCommands: overrides.selectionCommands ?? {
      copy: vi.fn(),
      pasteAt: vi.fn(),
      canPaste: vi.fn(() => false),
      duplicateSelected: vi.fn(),
      toggleSelectedPlantNamePins: vi.fn(),
      deleteSelected: vi.fn(),
      selectAll: vi.fn(),
      bringToFront: vi.fn(),
      sendToBack: vi.fn(),
      selectSameSpecies: vi.fn(),
      lockSelected: vi.fn(),
      unlockSelected: vi.fn(),
      groupSelected: vi.fn(),
      ungroupSelected: vi.fn(),
      renameZone: vi.fn(() => true),
      rotateSelected: vi.fn(),
    },
    contextMenu: overrides.contextMenu ?? contextMenuHost.adapter,
    setTool: (overrides.setTool ?? ((name: string) => {
      void name
    })) as SceneInteractionSessionDeps['setTool'],
    render,
    readSnapToGridEnabled: () => snapToGridEnabled.value,
    readSnapToGuidesEnabled: () => snapToGuidesEnabled.value,
    ...overrides.readSingleKeyShortcuts ? { readSingleKeyShortcuts: overrides.readSingleKeyShortcuts } : {},
    readPlantSpacingIntervalMeters: overrides.readPlantSpacingIntervalMeters ?? (() => plantSpacingIntervalM.value),
    commitPlantSpacingIntervalMeters: overrides.commitPlantSpacingIntervalMeters ?? ((meters) => {
      plantSpacingIntervalM.value = meters
    }),
    translate: overrides.translate ?? t,
    setHoveredTarget: overrides.setHoveredTarget ?? (() => {}),
    getLocalizedCommonNames: () => new Map(),
    publishToolGuidance: overrides.publishToolGuidance ?? setCanvasToolGuidance,
    nudge: overrides.nudge ?? { nudgeSelected: vi.fn(() => true), endNudge: vi.fn() },
  }
}

export function createSelectionCommands(
  overrides: Partial<SceneInteractionSessionDeps['selectionCommands']> = {},
): SceneInteractionSessionDeps['selectionCommands'] {
  return {
    copy: vi.fn(),
    pasteAt: vi.fn(),
    canPaste: vi.fn(() => false),
    duplicateSelected: vi.fn(),
    toggleSelectedPlantNamePins: vi.fn(),
    deleteSelected: vi.fn(),
    selectAll: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    selectSameSpecies: vi.fn(),
    lockSelected: vi.fn(),
    unlockSelected: vi.fn(),
    groupSelected: vi.fn(),
    ungroupSelected: vi.fn(),
    renameZone: vi.fn(() => true),
    rotateSelected: vi.fn(),
    ...overrides,
  }
}

export function plantTarget(id: string): SceneDesignObjectTarget {
  return { kind: 'plant', id }
}

export function zoneTarget(id: string): SceneDesignObjectTarget {
  return { kind: 'zone', id }
}

export function annotationTarget(id: string): SceneDesignObjectTarget {
  return { kind: 'annotation', id }
}

export function measurementGuideTarget(id: string): SceneDesignObjectTarget {
  return { kind: 'measurement-guide', id }
}

export function groupTarget(id: string): SceneDesignObjectTarget {
  return { kind: 'group', id }
}

export function createRecoveringCommandAdmission(): {
  readonly admission: SceneCommandAdmission
  readonly recoveryCalls: ReturnType<typeof vi.fn>
} {
  let pendingSettlement = true
  const recoveryCalls = vi.fn()
  return {
    admission: {
      revision: signal(0),
      runWhenSettled<T>(
        operation: () => T,
        busyResult: T,
        options: { resumePending?: boolean } = {},
      ): T {
        if (pendingSettlement) {
          pendingSettlement = false
          recoveryCalls(options.resumePending === true)
          return busyResult
        }
        return operation()
      },
    },
    recoveryCalls,
  }
}

export function createAbortFailingSceneEdits(
  base: SceneEditCoordinator,
  targetType: string,
  failureMessage: string,
  failureMode: 'first' | 'always' = 'first',
): {
  readonly sceneEdits: SceneEditCoordinator
  readonly abortCalls: () => number
  readonly beginCalls: () => number
  readonly beginTypes: () => readonly string[]
} {
  let abortCallCount = 0
  let beginCallCount = 0
  const beginTypes: string[] = []
  return {
    sceneEdits: {
      run: (type, edit, options) => base.run(type, edit, options),
      begin(type, options) {
        beginTypes.push(type)
        const transaction = base.begin(type, options)
        if (type !== targetType) return transaction
        beginCallCount += 1
        return {
          mutate: (edit) => transaction.mutate(edit),
          setSelection: (ids) => transaction.setSelection(ids),
          commit: (options) => transaction.commit(options),
          get changed() {
            return transaction.changed
          },
          abort() {
            abortCallCount += 1
            if (failureMode === 'always' || abortCallCount === 1) throw new Error(failureMessage)
            transaction.abort()
          },
        } satisfies SceneEditTransaction
      },
    },
    abortCalls: () => abortCallCount,
    beginCalls: () => beginCallCount,
    beginTypes: () => [...beginTypes],
  }
}

export function withoutNativeRandomUUID(action: () => void): void {
  const originalCrypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        return originalCrypto.getRandomValues(array)
      },
    },
  })

  try {
    action()
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
  }
}

export function zoneMeasurementTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-zone-measurement-label]'))
    .map((label) => label.textContent ?? '')
}

export function plantHoverTooltip(container: HTMLElement): HTMLElement {
  const tooltip = container.querySelector<HTMLElement>('[data-hover-tooltip]')
  if (!tooltip) throw new Error('Expected Plant Hover Tooltip')
  return tooltip
}

export function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

export function captureWindowErrors(action: () => void): unknown[] {
  const errors: unknown[] = []
  const capture = (event: ErrorEvent): void => {
    errors.push(event.error)
    event.preventDefault()
  }
  window.addEventListener('error', capture)
  try {
    action()
  } finally {
    window.removeEventListener('error', capture)
  }
  return errors
}

export function makePlant(
  id: string,
  canonicalName: string,
  position: { x: number; y: number },
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

export function makeRectZone(
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

export function makeTextAnnotation(
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

export function makeMeasurementGuide(
  id: string,
  start: ScenePoint,
  end: ScenePoint,
  overrides: Partial<SceneMeasurementGuideEntity> = {},
): SceneMeasurementGuideEntity {
  return {
    kind: 'measurement-guide',
    id,
    locked: false,
    start,
    end,
    ...overrides,
  }
}

export function getDesignObjectSelectionFromStore(
  store: SceneStore,
  camera: CameraController,
): CanvasDesignObjectSelectionModel {
  return getDesignObjectSelectionModel(
    store.persisted,
    store.session.selectedTargets,
    {
      annotationViewportScale: camera.viewport.scale,
      plantContext: createPlantPresentationContext(camera.viewport.scale),
    },
  )
}

export function rotationHandleCenter(container: HTMLElement): ScenePoint {
  const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
  if (!handle) throw new Error('Expected rotation handle to be visible')
  if (handle.style.display === 'none') throw new Error('Expected rotation handle to be visible')
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected rotation handle to be positioned')
  }
  return {
    x: left + 14,
    y: top + 14,
  }
}

export function zoneControlPointCenter(container: HTMLElement, kind: string, index: number): ScenePoint {
  const handle = container.querySelector<HTMLElement>(
    `[data-zone-control-point-kind="${kind}"][data-zone-control-point-index="${index}"]`,
  )
  if (!handle) throw new Error(`Expected ${kind} Zone Control Point ${index}`)
  const screenX = Number.parseFloat(handle.dataset.zoneControlPointScreenX ?? '')
  const screenY = Number.parseFloat(handle.dataset.zoneControlPointScreenY ?? '')
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    return { x: screenX, y: screenY }
  }
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected Zone Control Point to be positioned')
  }
  return {
    x: left + 10,
    y: top + 10,
  }
}

export function measurementGuideControlPointCenter(container: HTMLElement, index: number): ScenePoint {
  const handle = container.querySelector<HTMLElement>(
    `[data-measurement-guide-control-point-index="${index}"]`,
  )
  if (!handle) throw new Error(`Expected Measurement Guide Control Point ${index}`)
  const screenX = Number.parseFloat(handle.dataset.measurementGuideControlPointScreenX ?? '')
  const screenY = Number.parseFloat(handle.dataset.measurementGuideControlPointScreenY ?? '')
  if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
    return { x: screenX, y: screenY }
  }
  const left = Number.parseFloat(handle.style.left)
  const top = Number.parseFloat(handle.style.top)
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('Expected Measurement Guide Control Point to be positioned')
  }
  return {
    x: left + 10,
    y: top + 10,
  }
}

export function selectionBoundsCenter(selection: CanvasDesignObjectSelectionModel): ScenePoint {
  if (!selection.bounds) throw new Error('Expected selection bounds')
  return {
    x: selection.bounds.minX + (selection.bounds.maxX - selection.bounds.minX) / 2,
    y: selection.bounds.minY + (selection.bounds.maxY - selection.bounds.minY) / 2,
  }
}

export function quarterTurnClockwise(pivot: ScenePoint, point: ScenePoint): ScenePoint {
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  return {
    x: pivot.x - dy,
    y: pivot.y + dx,
  }
}

export function expectPointCloseTo(actual: ScenePoint | undefined, expected: ScenePoint): void {
  expect(actual?.x).toBeCloseTo(expected.x)
  expect(actual?.y).toBeCloseTo(expected.y)
}

export function pointsCenter(points: readonly ScenePoint[]): ScenePoint {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    x: minX + (maxX - minX) / 2,
    y: minY + (maxY - minY) / 2,
  }
}

/** The describe-scope state of the Scene Interaction suites, rebuilt before each test. */
export interface SceneInteractionFixtureState {
  readonly container: HTMLDivElement
  readonly camera: CameraController
  readonly store: SceneStore
  readonly events: SceneInteractionEventHarness
  readonly sessions: SceneInteractionSession[]
  readonly toolCardHost: HTMLDivElement
  readonly flushToolCard: () => void
}

/**
 * Installs the shared fixture of a `SceneInteractionSession` suite: registers its
 * `beforeEach` and `afterEach` hooks and returns its helpers. `assign` receives the
 * fresh state before each test; `live` returns the suite's current `events`, which
 * test bodies may replace, so the hooks and helpers read `events` only through it.
 */
export function installSceneInteractionFixture(
  assign: (fixture: SceneInteractionFixtureState) => void,
  live: () => { readonly events: SceneInteractionEventHarness },
) {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness
  let sessions: SceneInteractionSession[]

  let toolCardHost: HTMLDivElement
  let flushToolCard: () => void

  function createTestSession(deps: SceneInteractionSessionDeps): SceneInteractionSession {
    const session = createSceneInteractionSession(deps)
    // The runtime mirrors the session's tool for the tool card, as the command surface does.
    const setTool = session.setTool.bind(session)
    session.setTool = (name) => {
      setTool(name)
      setCanvasTool(name)
    }
    sessions.push(session)
    return session
  }

  /** The shared tool card, rendered beside the map as the workspace does. */
  function toolCard(): HTMLElement | null {
    flushToolCard()
    return document.querySelector<HTMLElement>('[data-tool-card]')
  }

  /** Plant a row's spacing field in the tool card. */
  function spacingInput(): HTMLInputElement | null {
    return toolCard()?.querySelector<HTMLInputElement>('[data-plant-spacing-interval-input]') ?? null
  }

  /** Types into the spacing field as a user does. */
  function typeSpacing(value: string): void {
    const input = spacingInput()!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushToolCard()
  }

  function openContextMenu(screen: ScenePoint): MouseEvent {
    return dispatchContextMenu(container, live().events.clientPoint(screen))
  }

  /** The Menu key while the map has focus: the menu for the current selection. */
  function openContextMenuFromKeyboard(): KeyboardEvent {
    container.tabIndex = -1
    container.focus()
    return live().events.keyDown({ key: 'ContextMenu', cancelable: true, target: container })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    events = createSceneInteractionEventHarness(container)
    flushToolCard = setupRerender()
    const latest = () => sessions[sessions.length - 1]?.plantRowSpacing
    setCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: {
          plantRowSpacing: {
            input: (text) => latest()?.input(text),
            commit: (text) => latest()?.commit(text),
            blur: (text) => latest()?.blur(text),
            cancel: () => latest()?.cancel(),
          },
        },
      }),
      queries: createTestCanvasQuerySurface(),
      documents: createTestCanvasDocumentSurface(),
    })
    toolCardHost = document.createElement('div')
    document.body.appendChild(toolCardHost)
    renderPreact(h(ToolCard, { canvasRef: { current: container } }), toolCardHost)
    contextMenuHost.reset()

    camera = new CameraController()
    camera.initialize({ width: 400, height: 300 })
    camera.setViewport({ x: 0, y: 0, scale: 1 })
    store = new SceneStore()
    sessions = []
    selectedObjectIds.value = new Set()
    clearPlantStampSource()
    clearSavedObjectStampSource()
    snapToGridEnabled.value = false
    snapToGuidesEnabled.value = false
    plantSpacingIntervalM.value = 0.5
    assign({ container, camera, store, events, sessions, toolCardHost, flushToolCard })
  })

  afterEach(() => {
    const disposalErrors: unknown[] = []
    for (const session of sessions.reverse()) {
      try {
        session.dispose()
      } catch (error) {
        disposalErrors.push(error)
      }
    }
    live().events.dispose()
    renderPreact(null, toolCardHost)
    toolCardHost.remove()
    teardownPreactTestUtils()
    setCanvasRuntimeSurfaces(null)
    setCanvasTool('select')
    setCanvasToolGuidance(IDLE_CANVAS_TOOL_GUIDANCE)
    container.remove()
    selectedObjectIds.value = new Set()
    clearPlantStampSource()
    clearSavedObjectStampSource()
    snapToGridEnabled.value = false
    snapToGuidesEnabled.value = false
    plantSpacingIntervalM.value = 0.5
    if (disposalErrors.length > 0) throw disposalErrors[0]
  })

  return {
    createTestSession,
    toolCard,
    spacingInput,
    typeSpacing,
    openContextMenu,
    openContextMenuFromKeyboard,
  }
}
