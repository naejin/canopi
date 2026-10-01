// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm Select, or arm no tool and assert no listener, wheel or key behaviour.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { writePlantStampDragData } from '../canvas/plant-stamp-source'
import { writeSavedObjectStampDragData } from '../canvas/saved-object-stamp-source'
import { selectedObjectIds } from '../canvas/session-state'
import { snapToGridEnabled } from '../app/canvas-settings/signals'
import { CameraController } from '../canvas/runtime/camera'
import { MapLibreWorkspaceCameraOwner } from '../maplibre/workspace-camera'
import { SceneStore, type ScenePoint } from '../canvas/runtime/scene'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from '../canvas/runtime/scene-interaction'
import type { CanvasDesignObjectSelectionModel } from '../canvas/runtime/runtime'
import type {
  SceneCommandAdmission,
  SettledSceneReader,
} from '../canvas/runtime/scene-runtime/transactions'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './support/scene-interaction-events'
import {
  AttachedInteractionMap,
  contextMenuHost,
  contextMenuCommand,
  contextMenuItemIds,
  createInteractionDeps,
  createSelectionCommands,
  plantTarget,
  zoneTarget,
  annotationTarget,
  measurementGuideTarget,
  groupTarget,
  createRecoveringCommandAdmission,
  createAbortFailingSceneEdits,
  zoneMeasurementTexts,
  plantHoverTooltip,
  nextAnimationFrame,
  captureWindowErrors,
  makePlant,
  makeRectZone,
  makeTextAnnotation,
  makeMeasurementGuide,
  getDesignObjectSelectionFromStore,
  rotationHandleCenter,
  zoneControlPointCenter,
  measurementGuideControlPointCenter,
  selectionBoundsCenter,
  quarterTurnClockwise,
  expectPointCloseTo,
  pointsCenter,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const {
    createTestSession,
    openContextMenu,
    openContextMenuFromKeyboard,
  } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('refreshes mounted interaction translations in place without closing or moving focus', () => {
    let language = 'en'
    const translate = (key: string, options?: Readonly<Record<string, unknown>>): string =>
      `${language}:${key}${options?.count === undefined ? '' : `:${String(options.count)}`}`
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 100, y: 100 },
        { x: 160, y: 150 },
      ])]
      draft.plants = [makePlant(
        'locked-plant',
        'Malus domestica',
        { x: 20, y: 30 },
        { locked: true },
      )]
    })
    const deps = createInteractionDeps(container, store, camera, {
      translate,
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    events.pointerMove({ x: 20, y: 30 })

    const rotationHandle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const lockedAffordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')!
    const unlock = lockedAffordance.querySelector<HTMLButtonElement>('[data-locked-object-unlock]')!
    unlock.focus()

    expect(rotationHandle.getAttribute('aria-label')).toBe('en:canvas.rotationHandle.label')
    expect(unlock.getAttribute('aria-label')).toBe('en:canvas.lockedObject.unlock')

    language = 'fr'
    session.refreshTranslations()

    expect(container.querySelector('[data-rotation-handle]')).toBe(rotationHandle)
    expect(container.querySelector('[data-locked-object-affordance]')).toBe(lockedAffordance)
    expect(rotationHandle.style.display).toBe('inline-flex')
    expect(lockedAffordance.style.display).toBe('inline-flex')
    expect(document.activeElement).toBe(unlock)
    expect(rotationHandle.getAttribute('aria-label')).toBe('fr:canvas.rotationHandle.label')
    expect(unlock.getAttribute('aria-label')).toBe('fr:canvas.lockedObject.unlock')
  })

  it('shows no floating action bar: rotation is the only control on a selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 100, y: 100 },
        { x: 160, y: 150 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    expect(container.querySelector<HTMLElement>('[data-rotation-handle]')?.style.display).toBe('inline-flex')
    expect(container.querySelector('[role="toolbar"]')).toBeNull()
    expect(container.querySelector('[data-selection-action-toolbar]')).toBeNull()
    session.dispose()
  })

  it('keeps the rotation handle inside the visible map area, clear of the tool rail and title bar', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 10, y: 40 },
        { x: 70, y: 90 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    // Without chrome it sits centred above the selection.
    expect(Number.parseFloat(handle.style.left)).toBe(26)
    expect(Number.parseFloat(handle.style.top)).toBe(8)

    // The labelled tool rail covers 240 px on the left, the title bar 60 px on top.
    camera.setFrameInsets({ top: 60, right: 0, bottom: 0, left: 240 })
    session.refreshMeasurements()

    expect(Number.parseFloat(handle.style.left)).toBe(248)
    expect(Number.parseFloat(handle.style.top)).toBe(68)
    session.dispose()
  })

  it('selects and drags a plant in scene space', () => {
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

    const render = vi.fn()
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 })
    events.pointerMove({ x: 35, y: 45 })
    events.pointerUp({ x: 35, y: 45 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(deps.setSelection).toHaveBeenCalledWith([plantTarget('plant-1')])
    session.dispose()
  })

  it('aborts only the matching active pointer on pointer cancellation and accepts the next gesture', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const render = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit, render })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 7 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 7 })
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })

    events.pointerCancel({ x: 35, y: 45 }, { pointerId: 8 })
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })

    render.mockClear()
    events.pointerCancel({ x: 35, y: 45 }, { pointerId: 7 })
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(render).toHaveBeenCalledWith('scene')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 9 })
    events.pointerMove({ x: 25, y: 35 }, { pointerId: 9 })
    events.pointerUp({ x: 25, y: 35 }, { pointerId: 9 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 25, y: 35 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('captures an admitted pointer and fences release-generated loss after committing its edit', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, {
      pointerCapture: { synchronousLossOnRelease: true },
    })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 17 })
    expect(events.pointerCapture.setCalls).toHaveBeenCalledWith(17)
    expect(events.pointerCapture.has(17)).toBe(true)
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 17 })
    events.pointerUp({ x: 35, y: 45 }, { pointerId: 17 })

    expect(events.pointerCapture.releaseCalls).toHaveBeenCalledWith(17)
    expect(events.pointerCapture.has(17)).toBe(false)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('rolls back a matching unexpected capture loss without history and accepts the next gesture', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 18 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 18 })
    events.lostPointerCapture(18)

    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 19 })
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 19 })
    events.pointerUp({ x: 40, y: 50 }, { pointerId: 19 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 40, y: 50 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('stops pointer-down routing when capture is lost synchronously during acquisition', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, {
      pointerCapture: { synchronousLossOnSet: true },
    })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 24 })

    expect(events.pointerCapture.setCalls).toHaveBeenCalledWith(24)
    expect(events.pointerCapture.has(24)).toBe(false)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.dispose()
    events = createSceneInteractionEventHarness(container)
    events.pointerDown({ x: 20, y: 30 }, { pointerId: 25 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 25 })
    events.pointerUp({ x: 35, y: 45 }, { pointerId: 25 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('ignores stale capture loss and competing pointer IDs while one captured edit is active', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 20 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 20 })
    events.lostPointerCapture(21)
    events.pointerDown({ x: 200, y: 150 }, { pointerId: 21 })
    events.pointerMove({ x: 220, y: 170 }, { pointerId: 21 })
    events.pointerUp({ x: 220, y: 170 }, { pointerId: 21 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    events.pointerUp({ x: 35, y: 45 }, { pointerId: 20 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it.each([
    ['is unavailable', { available: false }],
    ['throws during acquisition', { setThrows: new Error('capture unavailable') }],
  ] as const)('retains window-listener pointer completion when container capture %s', (_name, pointerCapture) => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, { pointerCapture })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 22 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 22 })
    events.pointerUp({ x: 35, y: 45 }, { pointerId: 22 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    expect(events.pointerCapture.releaseCalls).not.toHaveBeenCalled()
    session.dispose()
  })

  it('finishes edit cleanup and listener removal when capture release throws', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, {
      trackListeners: true,
      pointerCapture: { releaseThrows: new Error('capture release failed') },
    })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 23 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 23 })
    events.pointerUp({ x: 35, y: 45 }, { pointerId: 23 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    expect(events.pointerCapture.releaseCalls).toHaveBeenCalledWith(23)
    expect(() => session.dispose()).not.toThrow()
    expect(events.listenerLog?.containerRemoves('pointerdown')).toHaveLength(1)
    expect(events.listenerLog?.windowRemoves('pointermove')).toHaveLength(1)
  })

  it.each([
    ['pointer cancellation', (_session: SceneInteractionSession) => events.pointerCancel({ x: 35, y: 45 }, { pointerId: 25 })],
    ['Escape', (_session: SceneInteractionSession) => events.keyDown({ key: 'Escape', code: 'Escape' })],
    ['window blur', (_session: SceneInteractionSession) => events.windowBlur()],
    ['tool change', (session: SceneInteractionSession) => session.setTool('rectangle')],
    ['document replacement', (session: SceneInteractionSession) => session.prepareForDocumentReplacement()],
    ['Session disposal', (session: SceneInteractionSession) => session.dispose()],
  ] as const)('releases capture and rolls back an unfinished edit on %s', (_name, cancel) => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(container, store, camera, { onSceneEditCommit }))
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 25 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 25 })
    cancel(session)

    expect(events.pointerCapture.releaseCalls).toHaveBeenCalledWith(25)
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
  })

  it('routes navigation through an attached MapLibre camera while tool drags change only the Scene and detach restores fallback navigation', () => {
    const attachedCamera = new MapLibreWorkspaceCameraOwner()
    attachedCamera.initialize({ width: 400, height: 300 })
    const map = new AttachedInteractionMap()
    expect(attachedCamera.attach({
      map,
      readOrigin: () => ({ lat: 48.8566, lon: 2.3522 }),
    })).toBe(true)
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const session = createTestSession(createInteractionDeps(
      container,
      store,
      attachedCamera,
      { onSceneEditCommit },
    ))
    session.setTool('select')

    const mapCallsBeforeNavigation = map.jumpTo.mock.calls.length
    const plantBeforeNavigation = store.persisted.plants[0]?.position
    events.pointerDown({ x: 200, y: 150 }, { button: 1, pointerId: 26 })
    events.pointerMove({ x: 230, y: 170 }, { button: 1, pointerId: 26 })
    events.pointerUp({ x: 230, y: 170 }, { button: 1, pointerId: 26 })
    events.wheel({ x: 200, y: 150 }, { deltaY: -120 })

    expect(map.jumpTo.mock.calls.length).toBeGreaterThan(mapCallsBeforeNavigation)
    expect(store.persisted.plants[0]?.position).toEqual(plantBeforeNavigation)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    const mapCallsBeforeToolDrag = map.jumpTo.mock.calls.length
    const viewportBeforeToolDrag = attachedCamera.viewport
    events.pointerDown({ x: 140, y: 110 }, { pointerId: 27 })
    events.pointerMove({ x: 180, y: 150 }, { pointerId: 27 })
    events.pointerUp({ x: 180, y: 150 }, { pointerId: 27 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: expect.closeTo(40, 6), y: expect.closeTo(50, 6) })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(attachedCamera.viewport).toEqual(viewportBeforeToolDrag)
    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeToolDrag)

    attachedCamera.detach()
    const mapCallsBeforeDetachPan = map.jumpTo.mock.calls.length
    const viewportBeforeDetachPan = attachedCamera.viewport
    events.pointerDown({ x: 200, y: 150 }, { button: 1, pointerId: 28 })
    events.pointerMove({ x: 220, y: 165 }, { button: 1, pointerId: 28 })
    events.pointerUp({ x: 220, y: 165 }, { button: 1, pointerId: 28 })

    expect(attachedCamera.viewport).toEqual({
      x: viewportBeforeDetachPan.x + 20,
      y: viewportBeforeDetachPan.y + 15,
      scale: viewportBeforeDetachPan.scale,
    })
    expect(map.jumpTo).toHaveBeenCalledTimes(mapCallsBeforeDetachPan)
    session.dispose()
    attachedCamera.dispose()
  })

  it('does not let a second pointer replace the active Scene Edit gesture', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 1 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 1 })

    events.pointerDown({ x: 200, y: 150 }, { pointerId: 2 })
    events.pointerMove({ x: 220, y: 170 }, { pointerId: 2 })
    events.pointerUp({ x: 220, y: 170 }, { pointerId: 2 })
    events.pointerCancel({ x: 220, y: 170 }, { pointerId: 2 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerMove({ x: 40, y: 50 }, { pointerId: 1 })
    events.pointerUp({ x: 40, y: 50 }, { pointerId: 1 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 40, y: 50 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('aborts an active Scene Edit and releases Space when the window loses focus', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const onSceneEditCommit = vi.fn()
    const setHoveredTarget = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit, setHoveredTarget })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 3 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 3 })
    events.holdSpace()
    setHoveredTarget.mockClear()
    events.windowBlur()

    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(setHoveredTarget).toHaveBeenCalledWith(null)
    expect(container.style.cursor).toBe('default')

    events.pointerDown({ x: 200, y: 150 }, { pointerId: 4 })
    events.pointerMove({ x: 220, y: 150 }, { pointerId: 4 })
    events.pointerUp({ x: 220, y: 150 }, { pointerId: 4 })

    expect(camera.viewport.x).toBe(0)
    expect(camera.viewport.y).toBe(0)
    session.dispose()
  })

  it('shows the two nearest non-dragged Placed Plant distances while dragging selected Plants', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 0, y: 0 }),
        makePlant('plant-2', 'Malus domestica', { x: -20, y: -20 }),
        makePlant('plant-3', 'Pyrus communis', { x: 6, y: 8 }),
        makePlant('plant-4', 'Prunus avium', { x: 3, y: 9 }),
        makePlant('plant-5', 'Cydonia oblonga', { x: 13, y: 4 }),
        makePlant('plant-6', 'Mespilus germanica', { x: 103, y: 4 }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1'), plantTarget('plant-2')])

    events.pointerDown({ x: 0, y: 0 })
    events.pointerMove({ x: 3, y: 4 })

    const labels = Array.from(container.querySelectorAll<HTMLElement>('[data-plant-drag-distance-label]'))
    const lines = Array.from(container.querySelectorAll<SVGLineElement>('[data-plant-drag-distance-line]'))

    expect(store.persisted.plants.find((plant) => plant.id === 'plant-1')?.position).toEqual({ x: 3, y: 4 })
    expect(labels.map((label) => label.textContent)).toEqual(['5 m', '5 m'])
    expect(lines).toHaveLength(2)
    expect(container.textContent).not.toContain('10 m')
    expect(container.textContent).not.toContain('100 m')
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    events.pointerUp({ x: 3, y: 4 })

    expect(container.querySelector('[data-plant-drag-distance-label]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    session.dispose()
  })

  it('hides the Rotation Handle while dragging a selected Design Object', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    expect(handle.style.display).toBe('inline-flex')

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })

    expect(handle.style.display).toBe('none')

    events.pointerMove({ x: 40, y: 130 }, { button: 0 })
    events.pointerUp({ x: 40, y: 130 }, { button: 0 })

    expect(handle.style.display).toBe('inline-flex')
    session.dispose()
  })

  it('clears Plant Hover Tooltip presentation while dragging a selected Plant', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }, { commonName: 'Apple' })]
    })
    const setHoveredTarget = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setHoveredTarget })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1')])

    events.pointerMove({ x: 20, y: 30 })
    const tooltip = plantHoverTooltip(container)
    expect(tooltip.style.display).toBe('block')
    expect(setHoveredTarget).toHaveBeenCalledWith(plantTarget('plant-1'))
    setHoveredTarget.mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })

    expect(tooltip.style.display).toBe('none')
    expect(setHoveredTarget).toHaveBeenCalledWith(null)

    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(tooltip.style.display).toBe('none')
    session.dispose()
  })

  it('restores selection overlays after a no-op Design Object drag without history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })
    expect(handle.style.display).toBe('none')
    events.pointerUp({ x: 20, y: 110 }, { button: 0 })

    expect(handle.style.display).toBe('inline-flex')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('restores selection overlays when a Design Object drag is canceled by a tool change', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!

    events.pointerDown({ x: 20, y: 110 }, { button: 0 })
    events.pointerMove({ x: 40, y: 130 }, { button: 0 })
    expect(handle.style.display).toBe('none')
    session.setTool('rectangle')

    expect(handle.style.display).toBe('none')
    expect(store.persisted.zones[0]?.points[0]).toEqual({ x: 20, y: 80 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('keeps active drag and rotation gestures moving through runtime overlay propagation guards', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
      draft.zones = [makeRectZone('zone-1', [
        { x: 80, y: 80 },
        { x: 140, y: 80 },
        { x: 140, y: 120 },
        { x: 80, y: 120 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    session.setTool('select')

    deps.setSelection([plantTarget('plant-1')])
    session.refreshMeasurements()
    const overlay = container.querySelector<HTMLElement>('[data-locked-object-affordance]')!

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    const overlayMove = events.pointerMove(
      { x: 35, y: 45 },
      { button: 0, target: overlay },
    )
    expect(overlayMove.target).toBe(overlay)
    events.pointerUp({ x: 35, y: 45 }, { button: 0, target: overlay })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 35, y: 45 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')

    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const lockedAffordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')!
    const pivot = selectionBoundsCenter(getDesignObjectSelectionFromStore(store, camera))
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, { button: 0, target: handle })
    const affordanceMove = events.pointerMove(
      end,
      { button: 0, target: lockedAffordance },
    )
    expect(affordanceMove.target).toBe(lockedAffordance)

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)

    events.pointerUp(end, { button: 0, target: lockedAffordance })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('ends middle-button panning when pointer continuation targets a runtime overlay', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1')])
    session.refreshMeasurements()
    const overlay = container.querySelector<HTMLElement>('[data-locked-object-affordance]')!

    events.pointerDown({ x: 200, y: 150 }, { pointerId: 41, button: 1 })
    events.pointerMove(
      { x: 230, y: 170 },
      { pointerId: 41, button: 1, target: overlay },
    )
    expect(camera.viewport).toMatchObject({ x: 30, y: 20 })

    events.pointerUp(
      { x: 230, y: 170 },
      { pointerId: 41, button: 1, target: overlay },
    )
    const releasedViewport = { ...camera.viewport }
    events.pointerMove({ x: 260, y: 190 }, { pointerId: 41, button: 1 })

    expect(camera.viewport).toEqual(releasedViewport)
    session.dispose()
  })

  it('selects all visible editable same-Species plants on Select-tool double-click without scene edits', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 620, y: 30 }),
        makePlant('pear-1', 'Pyrus communis', { x: 80, y: 30 }),
        makePlant('locked-apple', 'Malus domestica', { x: 120, y: 30 }, { locked: true }),
        makePlant('grouped-apple', 'Malus domestica', { x: 160, y: 30 }),
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'grouped-apple' }],
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 1 })
    vi.mocked(deps.setSelection).mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2 })

    expect(selectedObjectIds.value).toEqual(new Set(['apple-1', 'apple-2']))
    expect(deps.setSelection).toHaveBeenCalledWith([
      plantTarget('apple-1'),
      plantTarget('apple-2'),
    ])
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('toggles same-Species plant sets with Shift double-click', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 80, y: 30 }),
        makePlant('pear-1', 'Pyrus communis', { x: 140, y: 30 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    deps.setSelection([plantTarget('apple-1'), plantTarget('apple-2'), plantTarget('pear-1')])
    vi.mocked(deps.setSelection).mockClear()
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })

    expect(selectedObjectIds.value).toEqual(new Set(['pear-1']))

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2, shiftKey: true })

    expect(selectedObjectIds.value).toEqual(new Set(['pear-1', 'apple-1', 'apple-2']))
    session.dispose()
  })

  it('hides the Rotation Handle outside Select affordance states', () => {
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 })
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 80, y: 80 },
        { x: 160, y: 80 },
        { x: 160, y: 140 },
        { x: 80, y: 140 },
      ])]
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 220, y: 100 }, 'Edit me')]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    expect(handle.style.display).toBe('inline-flex')

    session.setTool('rectangle')

    expect(handle.style.display).toBe('none')

    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])
    session.refreshMeasurements()
    expect(handle.style.display).toBe('inline-flex')

    events.keyDown({ key: 'F2', cancelable: true, target: container })

    expect(container.querySelector('textarea')).not.toBeNull()
    expect(handle.style.display).toBe('none')
    session.dispose()
  })

  it('shows a Rotation Handle for one eligible rotatable selection but not for a Placed Plant', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 40 },
        { x: 120, y: 40 },
        { x: 120, y: 100 },
        { x: 20, y: 100 },
      ])]
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 180, y: 90 })]
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 20, y: 140 }, { x: 120, y: 140 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)

    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle).not.toBeNull()
    expect(handle?.style.display).toBe('inline-flex')

    deps.setSelection([plantTarget('plant-1')])
    session.refreshMeasurements()

    expect(handle?.style.display).toBe('none')

    deps.setSelection([measurementGuideTarget('measurement-guide-1')])
    session.refreshMeasurements()

    expect(handle?.style.display).toBe('none')

    deps.setSelection([plantTarget('plant-1'), measurementGuideTarget('measurement-guide-1')])
    session.refreshMeasurements()

    expect(handle?.style.display).toBe('none')
    session.dispose()
  })

  it('shows a Rotation Handle for one selected text annotation', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        locked: false,
        annotationType: 'text',
        position: { x: 80, y: 90 },
        text: 'Label',
        fontSize: 20,
        rotationDeg: null,
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)

    deps.setSelection([annotationTarget('annotation-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle).not.toBeNull()
    expect(handle?.style.display).toBe('inline-flex')
    session.dispose()
  })

  it('drags the Rotation Handle to rotate a selected Zone with live readout and one Scene Edit', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.textContent).toBe('+90°')

    events.pointerUp({ x: 128, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('snaps Rotation Handle drags to 15 degree increments while Shift is held', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 82, y: 53 }, { button: 0, shiftKey: true })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(15)
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.textContent).toBe('+15°')
    session.dispose()
  })

  it('aborts an active Rotation Handle drag on pointer cancellation without creating history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = rotationHandleCenter(container)

    events.pointerDown(start, { button: 0, pointerId: 11, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0, pointerId: 11 })
    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)

    events.pointerCancel({ x: 128, y: 110 }, { button: 0, pointerId: 11 })
    events.pointerUp({ x: 128, y: 110 }, { button: 0, pointerId: 11 })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.style.display).toBe('none')
    session.dispose()
  })

  it('commits a Rotation Handle drag on pointer-up outside the canvas', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 128, y: 110 }, { button: 0 })
    events.pointerUp({ x: 500, y: 110 }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('aborts tiny Rotation Handle deltas without dirtying history', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])
    session.refreshMeasurements()

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const start = {
      x: Number.parseFloat(handle.style.left) + 14,
      y: Number.parseFloat(handle.style.top) + 14,
    }

    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: start.x + 0.1, y: start.y }, { button: 0 })
    events.pointerUp({ x: start.x + 0.1, y: start.y }, { button: 0 })

    expect(store.persisted.zones[0]?.rotationDeg).toBe(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('hides the Rotation Handle for locked Design Objects, hidden Layers, and locked Layers', () => {
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)
    deps.setSelection([zoneTarget('zone-1')])

    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ], { locked: true })]
    })
    session.refreshMeasurements()
    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')
    expect(handle?.style.display).toBe('none')

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, visible: false, locked: false } : layer
      ))
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    session.refreshMeasurements()
    expect(handle?.style.display).toBe('none')

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, visible: true, locked: true } : layer
      ))
      draft.zones = [makeRectZone('zone-1', [
        { x: 20, y: 80 },
        { x: 120, y: 80 },
        { x: 120, y: 140 },
        { x: 20, y: 140 },
      ])]
    })
    session.refreshMeasurements()
    expect(handle?.style.display).toBe('none')
    session.dispose()
  })

  it('rotates multi-plant selections around one shared Rotation Pivot without plant orientation', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 }),
        makePlant('plant-2', 'Pyrus communis', { x: 90, y: 120 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([plantTarget('plant-1'), plantTarget('plant-2')])
    session.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(store.persisted.plants[1]?.position, quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expect(store.persisted.plants[0]?.rotationDeg).toBeNull()
    expect(store.persisted.plants[1]?.rotationDeg).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('rotates mixed selections through one Rotation Handle transaction', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 })]
      draft.zones = [
        makeRectZone('line-1', [
          { x: 90, y: 120 },
          { x: 110, y: 120 },
        ], { zoneType: 'line' }),
        makeRectZone('rect-1', [
          { x: 130, y: 110 },
          { x: 150, y: 110 },
          { x: 150, y: 130 },
          { x: 130, y: 130 },
        ]),
      ]
      draft.annotations = [{
        kind: 'annotation',
        id: 'annotation-1',
        locked: false,
        annotationType: 'text',
        position: { x: 170, y: 120 },
        text: 'A',
        fontSize: 20,
        rotationDeg: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([plantTarget('plant-1'), zoneTarget('line-1'), zoneTarget('rect-1'), annotationTarget('annotation-1')])
    session.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    const line = store.persisted.zones.find((zone) => zone.id === 'line-1')
    const rect = store.persisted.zones.find((zone) => zone.id === 'rect-1')
    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(line?.points[0], quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expectPointCloseTo(line?.points[1], quarterTurnClockwise(pivot, { x: 110, y: 120 }))
    expectPointCloseTo(pointsCenter(rect?.points ?? []), quarterTurnClockwise(pivot, { x: 140, y: 120 }))
    expect(rect?.rotationDeg).toBeCloseTo(90)
    expectPointCloseTo(store.persisted.annotations[0]?.position, quarterTurnClockwise(pivot, { x: 170, y: 120 }))
    expect(store.persisted.annotations[0]?.rotationDeg).toBeCloseTo(90)
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('rotates Object Groups by mutating member geometry instead of group rotation', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 })]
      draft.zones = [makeRectZone('line-1', [
        { x: 90, y: 120 },
        { x: 110, y: 120 },
      ], { zoneType: 'line' })]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Group',
        members: [
          { kind: 'plant', id: 'plant-1' },
          { kind: 'zone', id: 'line-1' },
        ],
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    deps.setSelection([groupTarget('group-1')])
    session.refreshMeasurements()
    const selection = getDesignObjectSelectionFromStore(store, camera)
    const pivot = selectionBoundsCenter(selection)
    const start = rotationHandleCenter(container)
    const end = quarterTurnClockwise(pivot, start)

    events.pointerDown(start, {
      button: 0,
      target: container.querySelector<HTMLElement>('[data-rotation-handle]')!,
    })
    events.pointerMove(end, { button: 0 })
    events.pointerUp(end, { button: 0 })

    const line = store.persisted.zones.find((zone) => zone.id === 'line-1')
    const group = store.persisted.groups[0]
    expectPointCloseTo(store.persisted.plants[0]?.position, quarterTurnClockwise(pivot, { x: 60, y: 120 }))
    expectPointCloseTo(line?.points[0], quarterTurnClockwise(pivot, { x: 90, y: 120 }))
    expectPointCloseTo(line?.points[1], quarterTurnClockwise(pivot, { x: 110, y: 120 }))
    expect(group?.members).toEqual([
      { kind: 'plant', id: 'plant-1' },
      { kind: 'zone', id: 'line-1' },
    ])
    expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rotate')
    session.dispose()
  })

  it('hides the Rotation Handle for Object Groups that contain locked members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 60, y: 120 }, { locked: true })]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: 'Group',
        members: [{ kind: 'plant', id: 'plant-1' }],
      }]
    })
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
    })
    const session = createTestSession(deps)

    deps.setSelection([groupTarget('group-1')])
    session.refreshMeasurements()

    expect(container.querySelector<HTMLElement>('[data-rotation-handle]')?.style.display).toBe('none')
    session.dispose()
  })

  it('shows a direct unlock affordance when hovering a locked Design Object', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-plant',
        locked: true,
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
    session.setTool('select')

    events.pointerMove({ x: 20, y: 30 })

    const affordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')
    expect(affordance).not.toBeNull()
    expect(affordance?.dataset.lockedObjectId).toBe('locked-plant')
    const unlock = affordance?.querySelector<HTMLButtonElement>('[data-locked-object-unlock]')!
    expect(unlock.getAttribute('aria-label')).toContain('Unlock')
    expect(selectedObjectIds.value).toEqual(new Set())

    events.pointerDown({ x: 35, y: 45 }, { target: unlock })
    events.pointerUp({ x: 35, y: 45 }, { target: unlock })

    expect(affordance?.style.display).toBe('inline-flex')
    expect(affordance?.dataset.lockedObjectId).toBe('locked-plant')

    unlock.click()

    expect(store.persisted.plants[0]?.locked).toBe(false)
    expect(onSceneEditCommit).toHaveBeenCalledWith('unlock-design-object')
    expect(selectedObjectIds.value).toEqual(new Set())
    session.dispose()
  })

  it('does not show direct unlock affordances for Design Objects blocked by locked Layers', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'plants' ? { ...layer, locked: true } : layer
      ))
      draft.plants = [{
        kind: 'plant',
        id: 'locked-layer-plant',
        locked: true,
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
    session.setTool('select')

    events.pointerMove({ x: 20, y: 30 })

    const affordance = container.querySelector<HTMLElement>('[data-locked-object-affordance]')
    expect(affordance).not.toBeNull()
    expect(affordance?.style.display).toBe('none')
    expect(affordance?.dataset.lockedObjectId).toBeUndefined()
    expect(selectedObjectIds.value).toEqual(new Set())
    session.dispose()
  })

  it('suppresses native context menus only on canvas interaction surfaces', () => {
    const deps = {
      ...createInteractionDeps(container, store, camera),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
      }),
    }
    const session = createTestSession(deps)
    session.refreshMeasurements()

    const canvasContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.dispatchEvent(canvasContext)
    expect(canvasContext.defaultPrevented).toBe(true)

    const handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
    const handleContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    handle.dispatchEvent(handleContext)
    expect(handleContext.defaultPrevented).toBe(true)

    const canvasInput = document.createElement('input')
    container.appendChild(canvasInput)
    const inputContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasInput.dispatchEvent(inputContext)
    expect(inputContext.defaultPrevented).toBe(false)

    const canvasMenu = document.createElement('div')
    canvasMenu.setAttribute('role', 'menu')
    container.appendChild(canvasMenu)
    const menuContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasMenu.dispatchEvent(menuContext)
    expect(menuContext.defaultPrevented).toBe(false)

    const canvasDialog = document.createElement('dialog')
    container.appendChild(canvasDialog)
    const dialogContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    canvasDialog.dispatchEvent(dialogContext)
    expect(dialogContext.defaultPrevented).toBe(false)

    const outsidePanel = document.createElement('div')
    document.body.appendChild(outsidePanel)
    const outsideContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    outsidePanel.dispatchEvent(outsideContext)
    expect(outsideContext.defaultPrevented).toBe(false)

    session.dispose()
    outsidePanel.remove()
  })

  it('does not admit a context-menu selection change during an active scene edit', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('plant-2', 'Pyrus communis', { x: 120, y: 30 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1')])
    const downstreamContextMenu = vi.fn()
    container.addEventListener('contextmenu', downstreamContextMenu)

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 31 })
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 31 })
    const contextPoint = events.clientPoint({ x: 120, y: 30 })
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: contextPoint.x,
      clientY: contextPoint.y,
    })
    container.dispatchEvent(contextMenu)
    container.removeEventListener('contextmenu', downstreamContextMenu)

    expect(contextMenu.defaultPrevented).toBe(true)
    expect(downstreamContextMenu).not.toHaveBeenCalled()
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(store.persisted.plants.find((plant) => plant.id === 'plant-1')?.position)
      .toEqual({ x: 40, y: 50 })
    expect(contextMenuHost.opened).toHaveLength(0)

    events.pointerMove({ x: 50, y: 60 }, { pointerId: 31 })
    events.pointerUp({ x: 50, y: 60 }, { pointerId: 31 })

    expect(store.persisted.plants.find((plant) => plant.id === 'plant-1')?.position)
      .toEqual({ x: 50, y: 60 })
    expect(onSceneEditCommit).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('quarantines the pointerdown that recovers pending Scene settlement', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('plant-2', 'Pyrus communis', { x: 120, y: 30 }),
      ]
    })
    const { admission, recoveryCalls } = createRecoveringCommandAdmission()
    const baseDeps = createInteractionDeps(container, store, camera)
    const deps: SceneInteractionSessionDeps = {
      ...baseDeps,
      commandAdmission: admission,
      setSelection: (ids) => admission.runWhenSettled(
        () => baseDeps.setSelection(ids),
        undefined,
        { resumePending: true },
      ),
    }
    const session = createTestSession(deps)
    session.setTool('select')
    baseDeps.setSelection([plantTarget('plant-1')])
    const before = store.snapshot().persisted

    events.pointerDown({ x: 120, y: 30 }, { pointerId: 43 })
    events.pointerMove({ x: 150, y: 60 }, { pointerId: 43 })
    events.pointerUp({ x: 150, y: 60 }, { pointerId: 43 })

    expect(recoveryCalls).toHaveBeenCalledOnce()
    expect(recoveryCalls).toHaveBeenCalledWith(true)
    expect(store.persisted).toEqual(before)
    expect(store.session.selectedTargets).toEqual([plantTarget('plant-1')])
  })

  it('quarantines the contextmenu that recovers pending Scene settlement', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('plant-2', 'Pyrus communis', { x: 120, y: 30 }),
      ]
    })
    const { admission, recoveryCalls } = createRecoveringCommandAdmission()
    const baseDeps = createInteractionDeps(container, store, camera)
    const deps: SceneInteractionSessionDeps = {
      ...baseDeps,
      commandAdmission: admission,
      setSelection: (ids) => admission.runWhenSettled(
        () => baseDeps.setSelection(ids),
        undefined,
        { resumePending: true },
      ),
    }
    const session = createTestSession(deps)
    session.setTool('select')
    baseDeps.setSelection([plantTarget('plant-1')])
    const point = events.clientPoint({ x: 120, y: 30 })
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
    })

    container.dispatchEvent(contextMenu)

    expect(recoveryCalls).toHaveBeenCalledOnce()
    expect(recoveryCalls).toHaveBeenCalledWith(true)
    expect(store.session.selectedTargets).toEqual([plantTarget('plant-1')])
    expect(contextMenuHost.opened).toHaveLength(0)
  })

  it('opens the empty-map menu with Place plants here, Paste and Select all at the pointer', () => {
    const pasteAt = vi.fn()
    const selectAll = vi.fn()
    let canPaste = false
    const session = createTestSession(createInteractionDeps(container, store, camera, {
      selectionCommands: createSelectionCommands({ canPaste: () => canPaste, pasteAt, selectAll }),
    }))

    const event = openContextMenu({ x: 320, y: 260 })

    expect(event.defaultPrevented).toBe(true)
    const request = contextMenuHost.current!
    expect(request.selection).toBeNull()
    expect(request.anchor).toEqual({ left: 320, top: 260, right: 320, bottom: 260 })
    expect(request.world).toEqual({ x: 320, y: 260 })
    expect(contextMenuItemIds()).toEqual(['place-plants-here', 'paste', 'select-all'])
    expect(contextMenuCommand('paste').disabled).toBe(true)
    contextMenuCommand('select-all').run()
    expect(selectAll).toHaveBeenCalledOnce()

    canPaste = true
    openContextMenu({ x: 320, y: 260 })
    contextMenuCommand('paste').run()
    expect(pasteAt).toHaveBeenCalledWith({ x: 320, y: 260 })
    session.dispose()
  })

  it('keeps the current selection when right-clicking the empty map', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-1')])
    vi.mocked(deps.setSelection).mockClear()

    openContextMenu({ x: 300, y: 250 })

    expect(contextMenuHost.current?.selection).toBeNull()
    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(deps.setSelection).not.toHaveBeenCalled()
    session.dispose()
  })

  it('runs Context Menu edit commands through the scene edit surface', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const commands = createSelectionCommands({ canPaste: vi.fn(() => true) })
    const deps = createInteractionDeps(container, store, camera, { selectionCommands: commands })
    const session = createTestSession(deps)
    session.setTool('select')

    openContextMenu({ x: 20, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(contextMenuHost.current?.selection?.editableTargets).toEqual([plantTarget('plant-1')])
    expect(contextMenuHost.current?.commands).toBe(commands)
    contextMenuCommand('copy').run()
    expect(commands.copy).toHaveBeenCalledOnce()
    contextMenuCommand('paste').run()
    expect(commands.pasteAt).toHaveBeenCalledWith({ x: 20, y: 30 })
    contextMenuCommand('duplicate').run()
    expect(commands.duplicateSelected).toHaveBeenCalledOnce()
    contextMenuCommand('delete').run()
    expect(commands.deleteSelected).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('offers Save as stamp only with the saved-stamp capability and disables it for structural blockers', () => {
    const saveSelectionAsObjectStamp = vi.fn()
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [{ kind: 'plant' as const, id: 'plant-1' }],
      lockedTargets: [],
      blockedTargets: [],
      bounds: { minX: 20, minY: 20, maxX: 24, maxY: 24 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => selectionModel,
    })
    const withoutStamps = createTestSession(baseDeps)
    openContextMenuFromKeyboard()
    expect(contextMenuItemIds()).not.toContain('save-as-stamp')
    withoutStamps.dispose()

    const session = createTestSession({ ...baseDeps, contextualCommands: { saveSelectionAsObjectStamp } })
    openContextMenuFromKeyboard()
    const save = contextMenuCommand('save-as-stamp')
    expect(save.label).toBe('Save as stamp')
    expect(save.disabled).toBe(false)
    save.run()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledOnce()

    selectionModel = {
      ...selectionModel,
      blockedTargets: [{
        target: { kind: 'plant' as const, id: 'grouped-plant' },
        reason: 'grouped-member' as const,
        layerName: 'plants',
        groupId: 'group-1',
      }],
    }
    openContextMenuFromKeyboard()
    expect(contextMenuCommand('save-as-stamp').disabled).toBe(true)
    contextMenuCommand('save-as-stamp').run()
    expect(saveSelectionAsObjectStamp).toHaveBeenCalledOnce()
    session.dispose()
  })

  it('keeps Cut, Copy and Delete disabled for mixed editable and locked or blocked selections', () => {
    let selectionModel: CanvasDesignObjectSelectionModel = {
      editableTargets: [{ kind: 'plant' as const, id: 'editable-plant' }],
      lockedTargets: [{ kind: 'plant' as const, id: 'locked-plant' }],
      blockedTargets: [{
        target: { kind: 'plant' as const, id: 'locked-plant' },
        reason: 'locked-design-object' as const,
        layerName: 'plants',
      }],
      bounds: { minX: 20, minY: 20, maxX: 60, maxY: 24 },
      sameSpeciesReferenceCanonicalName: null,
    }
    const commands = createSelectionCommands({ canPaste: vi.fn(() => true) })
    const session = createTestSession(createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => selectionModel,
      selectionCommands: commands,
    }))

    openContextMenuFromKeyboard()
    for (const id of ['cut', 'copy', 'delete'] as const) {
      expect(contextMenuCommand(id).disabled).toBe(true)
      contextMenuCommand(id).run()
    }
    expect(contextMenuCommand('paste').disabled).toBe(false)
    expect(contextMenuCommand('unlock').disabled).toBe(false)
    expect(commands.copy).not.toHaveBeenCalled()
    expect(commands.deleteSelected).not.toHaveBeenCalled()

    selectionModel = {
      ...selectionModel,
      lockedTargets: [],
      blockedTargets: [{
        target: { kind: 'plant' as const, id: 'grouped-plant' },
        reason: 'grouped-member' as const,
        layerName: 'plants',
        groupId: 'group-1',
      }],
    }
    openContextMenuFromKeyboard()
    expect(contextMenuCommand('copy').disabled).toBe(true)
    expect(contextMenuCommand('delete').disabled).toBe(true)
    expect(contextMenuCommand('paste').disabled).toBe(false)
    expect(contextMenuCommand('unlock').disabled).toBe(true)
    session.dispose()
  })

  it('disables Context Menu edits when a blocked hit would otherwise preserve another selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
      ]
      draft.zones = [
        makeRectZone('locked-zone', [
          { x: 110, y: 20 },
          { x: 130, y: 20 },
          { x: 130, y: 40 },
          { x: 110, y: 40 },
        ]),
      ]
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    const commands = createSelectionCommands({ canPaste: vi.fn(() => true) })
    const deps = createInteractionDeps(container, store, camera, { selectionCommands: commands })
    const session = createTestSession(deps)

    deps.setSelection([plantTarget('plant-1')])
    vi.mocked(deps.setSelection).mockClear()
    openContextMenu({ x: 110, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(contextMenuCommand('copy').disabled).toBe(true)
    expect(contextMenuCommand('delete').disabled).toBe(true)
    expect(contextMenuCommand('paste').disabled).toBe(false)
    contextMenuCommand('copy').run()
    contextMenuCommand('delete').run()
    contextMenuCommand('paste').run()
    expect(commands.copy).not.toHaveBeenCalled()
    expect(commands.deleteSelected).not.toHaveBeenCalled()
    expect(commands.pasteAt).toHaveBeenCalledWith({ x: 110, y: 30 })
    session.dispose()
  })

  it('disables Context Menu edits for a topmost blocked hit over an editable target', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        makeRectZone('editable-zone', [
          { x: 110, y: 20 },
          { x: 130, y: 20 },
          { x: 130, y: 40 },
          { x: 110, y: 40 },
        ]),
      ]
      draft.plants = [
        makePlant('locked-layer-plant', 'Malus domestica', { x: 120, y: 30 }),
      ]
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'plants' ? { ...layer, locked: true } : layer,
      )
    })
    const commands = createSelectionCommands({ canPaste: vi.fn(() => true) })
    const deps = createInteractionDeps(container, store, camera, { selectionCommands: commands })
    const session = createTestSession(deps)

    openContextMenu({ x: 120, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(contextMenuHost.current?.selection).not.toBeNull()
    expect(contextMenuCommand('copy').disabled).toBe(true)
    expect(contextMenuCommand('delete').disabled).toBe(true)
    contextMenuCommand('paste').run()
    expect(commands.pasteAt).toHaveBeenCalledWith({ x: 120, y: 30 })
    session.dispose()
  })

  it('updates Context Menu target selection like a design tool', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('plant-2', 'Pyrus communis', { x: 80, y: 30 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    deps.setSelection([plantTarget('plant-1')])
    vi.mocked(deps.setSelection).mockClear()
    openContextMenu({ x: 80, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-2']))
    expect(deps.setSelection).toHaveBeenCalledWith([plantTarget('plant-2')])
    expect(contextMenuHost.current?.selection?.editableTargets).toEqual([plantTarget('plant-2')])

    deps.setSelection([plantTarget('plant-1'), plantTarget('plant-2')])
    vi.mocked(deps.setSelection).mockClear()
    openContextMenu({ x: 80, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1', 'plant-2']))
    expect(deps.setSelection).not.toHaveBeenCalled()
    expect(contextMenuHost.current?.selection?.editableTargets).toHaveLength(2)
    session.dispose()
  })

  it('selects directly locked Context Menu targets with mutation commands disabled', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('locked-plant', 'Malus domestica', { x: 20, y: 30 }, { locked: true }),
      ]
    })
    const session = createTestSession(createInteractionDeps(container, store, camera))
    session.setTool('select')

    openContextMenu({ x: 20, y: 30 })

    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    expect(contextMenuCommand('copy').disabled).toBe(true)
    expect(contextMenuCommand('delete').disabled).toBe(true)
    expect(contextMenuCommand('unlock').disabled).toBe(false)
    session.dispose()
  })

  it('opens the menu from the Menu key or Shift F10 beside the selection bounds', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 100, y: 100 },
        { x: 160, y: 100 },
        { x: 160, y: 150 },
        { x: 100, y: 150 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([zoneTarget('zone-1')])
    container.tabIndex = -1
    container.focus()

    const menuKey = events.keyDown({ key: 'ContextMenu', cancelable: true, target: container })

    expect(menuKey.defaultPrevented).toBe(true)
    const request = contextMenuHost.current!
    expect(request.selection?.editableTargets).toEqual([zoneTarget('zone-1')])
    expect(request.anchor.left).toBeCloseTo(100)
    expect(request.anchor.top).toBeCloseTo(100)
    expect(request.anchor.right).toBeCloseTo(160)
    expect(request.anchor.bottom).toBeCloseTo(150)
    expect(request.world.x).toBeCloseTo(130)
    expect(request.world.y).toBeCloseTo(125)

    // The key's own trailing contextmenu event does not reopen the menu at a pointer.
    openContextMenu({ x: 0, y: 0 })
    expect(contextMenuHost.opened).toHaveLength(1)

    contextMenuHost.reset()
    container.blur()
    document.body.focus()
    events.keyDown({ key: 'F10', shiftKey: true, cancelable: true, target: document.body })
    expect(contextMenuHost.current).toBeNull()

    container.focus()
    events.keyDown({ key: 'F10', shiftKey: true, cancelable: true, target: container })
    expect(contextMenuHost.current?.selection?.editableTargets).toEqual([zoneTarget('zone-1')])

    contextMenuHost.current!.returnFocus()
    expect(document.activeElement).toBe(container)
    session.dispose()
  })

  it('selects locked Design Objects for right-click Unlock without allowing drag mutations', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-plant',
        locked: true,
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
    const baseDeps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const unlockSelected = vi.fn(() => {
      baseDeps.sceneEdits.run('unlock-selected', (tx) => {
        tx.mutate((draft) => {
          const plant = draft.plants.find((entry) => entry.id === 'locked-plant')
          if (plant) plant.locked = false
        })
      })
    })
    const deps = {
      ...baseDeps,
      selectionCommands: {
        ...baseDeps.selectionCommands,
        unlockSelected,
      },
    }
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })

    openContextMenu({ x: 20, y: 30 })
    expect(contextMenuCommand('duplicate').disabled).toBe(true)
    expect(contextMenuCommand('bring-to-front').disabled).toBe(true)
    expect(contextMenuCommand('send-to-back').disabled).toBe(true)
    expect(contextMenuCommand('delete').disabled).toBe(true)
    expect(contextMenuCommand('lock').disabled).toBe(true)
    const unlock = contextMenuCommand('unlock')
    expect(unlock.disabled).toBe(false)
    expect(unlock.label).toBe('Unlock')

    unlock.run()
    session.refreshMeasurements()

    expect(unlockSelected).toHaveBeenCalledTimes(1)
    expect(onSceneEditCommit).toHaveBeenCalledWith('unlock-selected')
    expect(store.persisted.plants[0]?.locked).toBe(false)
    expect(selectedObjectIds.value).toEqual(new Set(['locked-plant']))
    openContextMenu({ x: 20, y: 30 })
    expect(contextMenuCommand('unlock').disabled).toBe(true)
    expect(contextMenuCommand('lock').disabled).toBe(false)
    expect(contextMenuCommand('duplicate').disabled).toBe(false)
    session.dispose()
  })

  it('drags only editable objects from a mixed locked and unlocked selection', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('editable-plant', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('locked-plant', 'Malus domestica', { x: 60, y: 30 }, { locked: true }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => getDesignObjectSelectionFromStore(store, camera),
      onSceneEditCommit,
    })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })
    events.pointerDown({ x: 60, y: 30 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 60, y: 30 }, { button: 0, shiftKey: true })
    vi.mocked(deps.setSelection).mockClear()

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerMove({ x: 35, y: 45 }, { button: 0 })
    events.pointerUp({ x: 35, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['editable-plant', 'locked-plant']))
    expect(store.persisted.plants.find((plant) => plant.id === 'editable-plant')?.position).toEqual({ x: 35, y: 45 })
    expect(store.persisted.plants.find((plant) => plant.id === 'locked-plant')?.position).toEqual({ x: 60, y: 30 })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    expect(deps.setSelection).not.toHaveBeenCalled()
    session.dispose()
  })

  it('does not select groups that contain locked Design Object members', () => {
    store.updatePersisted((draft) => {
      draft.plants = [{
        kind: 'plant',
        id: 'locked-member',
        locked: true,
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
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [{ kind: 'plant', id: 'locked-member' }],
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { button: 0 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 30, y: 40 }, { button: 0 })
    events.pointerUp({ x: 30, y: 40 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())
    session.dispose()
  })

  it('reveals an overview marker, keeps its selected text hittable, and navigates without a Scene edit', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('note', { x: 100, y: 100 }, 'A long overview note')]
    })
    const before = store.persisted
    const onSceneEditCommit = vi.fn()
    const setHoveredTarget = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit, setHoveredTarget })
    const session = createTestSession(deps)
    session.setTool('select')
    events.pointerDown({ x: 96, y: 100 }, { button: 0 })
    events.pointerUp({ x: 96, y: 100 }, { button: 0 })
    expect(store.session.selectedTargets).toEqual([annotationTarget('note')])
    expect(getDesignObjectSelectionFromStore(store, camera).bounds!.maxX).toBeGreaterThan(200)
    events.pointerMove({ x: 150, y: 105 })
    expect(setHoveredTarget).toHaveBeenLastCalledWith(annotationTarget('note'))
    for (const deltaY of [-120, 120, -120, 120]) {
      container.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: 100, clientY: 100, bubbles: true, cancelable: true }))
    }
    events.keyDown({ key: 'F2', cancelable: true, target: container })
    expect(container.querySelector('textarea')?.value).toBe('A long overview note')
    container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(store.persisted).toEqual(before)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('edits an existing text Annotation in place after double-click and Enter', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Old note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(textarea.value).toBe('Old note')

    textarea.value = 'Updated note'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]).toMatchObject({
      id: 'annotation-1',
      text: 'Updated note',
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('keeps an inline text Annotation edit recoverable while the Scene is busy', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Deferred inline note'
    const active = deps.sceneEdits.begin('external-preview')

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBe(textarea)
    expect(textarea.value).toBe('Deferred inline note')

    active.abort()
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Deferred inline note')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('detaches an inline Annotation draft before document replacement', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Old document')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])
    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const oldTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    oldTextarea.value = 'Stale draft'

    session.prepareForDocumentReplacement()
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'New document')]
    })
    oldTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations[0]?.text).toBe('New document')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
  })

  it('opens existing text Annotation editing from two primary clicks without pointer detail', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1 })

    expect(selectedObjectIds.value).toEqual(new Set(['annotation-1']))
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Portable note')
    session.dispose()
  })

  it('does not open existing text Annotation editing when the second click is additive or too far away', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1, shiftKey: true })
    expect(container.querySelector('textarea')).toBeNull()

    events.pointerUp({ x: 27, y: 35 }, { button: 0, detail: 1, shiftKey: true })
    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    expect(container.querySelector('textarea')).toBeNull()
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 60, y: 70 }, { button: 0, detail: 1 })

    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not open existing text Annotation editing after an intervening empty click without pointer detail', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Portable note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 26, y: 34 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 200, y: 200 }, { button: 0, detail: 1 })
    events.pointerUp({ x: 200, y: 200 }, { button: 0, detail: 1 })
    events.pointerDown({ x: 27, y: 35 }, { button: 0, detail: 1 })

    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('opens selected text Annotation editing from F2 and keeps Shift+Enter inside the editor', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Line one')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(textarea.value).toBe('Line one')

    textarea.value = 'Line one\nLine two'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(container.querySelector('textarea')).toBe(textarea)
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(store.persisted.annotations[0]?.text).toBe('Line one\nLine two')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('opens selected text Annotation editing from Enter when the canvas has keyboard focus', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Keyboard note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])

    const event = events.keyDown({ key: 'Enter', cancelable: true, target: container })

    expect(event.defaultPrevented).toBe(true)
    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keyboard note')
    session.dispose()
  })

  it('does not intercept Annotation edit shortcuts from focused controls outside the canvas', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Keyboard note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])
    const externalButton = document.createElement('button')
    document.body.appendChild(externalButton)
    externalButton.focus()

    const enterEvent = events.keyDown({ key: 'Enter', cancelable: true, target: externalButton })
    const f2Event = events.keyDown({ key: 'F2', cancelable: true, target: externalButton })

    expect(enterEvent.defaultPrevented).toBe(false)
    expect(f2Event.defaultPrevented).toBe(false)
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
    externalButton.remove()
  })

  it('cancels existing text Annotation edits with Escape without history', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Discard me'
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not create history when committing unchanged existing text Annotation text', async () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Stable note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations[0]?.text).toBe('Stable note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('commits existing text Annotation edits when clicking away on the canvas', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Before click-away')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'After click-away'
    events.pointerDown({ x: 320, y: 240 }, { button: 0 })

    expect(store.persisted.annotations[0]?.text).toBe('After click-away')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotation becomes locked before blur commit', async () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Blocked edit'
    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) => (
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation
      ))
    })
    textarea.dispatchEvent(new FocusEvent('blur'))
    await nextAnimationFrame()

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotations Layer becomes locked', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Locked layer edit'
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not commit existing text Annotation edits after the Annotations Layer becomes hidden', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Original note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = 'Hidden layer edit'
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, visible: false } : layer
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations[0]?.text).toBe('Original note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('deletes an existing text Annotation when committed text is empty', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Delete me')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(0)
    expect(selectedObjectIds.value.size).toBe(0)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-annotation-text')
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not delete an existing text Annotation after it becomes locked before empty commit', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Delete me')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([annotationTarget('annotation-1')])

    events.keyDown({ key: 'F2', cancelable: true, target: container })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '   '
    store.updatePersisted((draft) => {
      draft.annotations = draft.annotations.map((annotation) => (
        annotation.id === 'annotation-1' ? { ...annotation, locked: true } : annotation
      ))
    })
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(store.persisted.annotations).toHaveLength(1)
    expect(store.persisted.annotations[0]?.text).toBe('Delete me')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('does not edit locked, locked-Layer, hidden, or grouped text Annotations', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [
        makeTextAnnotation('locked-annotation', { x: 24, y: 32 }, 'Locked', { locked: true }),
        makeTextAnnotation('layer-blocked-annotation', { x: 80, y: 32 }, 'Layer blocked'),
        makeTextAnnotation('hidden-annotation', { x: 140, y: 32 }, 'Hidden'),
        makeTextAnnotation('grouped-annotation', { x: 200, y: 32 }, 'Grouped'),
      ]
      draft.groups = [{
        kind: 'group',
        id: 'group-1',
        locked: false,
        name: null,
        members: [
          { kind: 'annotation', id: 'grouped-annotation' },
          { kind: 'annotation', id: 'missing-partner' },
        ],
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    deps.setSelection([annotationTarget('locked-annotation')])
    events.keyDown({ key: 'F2', cancelable: true, target: container })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: true } : layer
      ))
    })
    events.pointerDown({ x: 82, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, locked: false, visible: false } : layer
      ))
    })
    events.pointerDown({ x: 142, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()

    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'annotations' ? { ...layer, visible: true } : layer
      ))
    })
    events.pointerDown({ x: 202, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('cleans up existing text Annotation editors on tool change and disposal', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Cleanup note')]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const firstTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    firstTextarea.value = 'Discard on tool change'
    session.setTool('rectangle')
    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations[0]?.text).toBe('Cleanup note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()

    session.setTool('select')
    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    const secondTextarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    secondTextarea.value = 'Discard on dispose'
    session.dispose()

    expect(container.querySelector('textarea')).toBeNull()
    expect(store.persisted.annotations[0]?.text).toBe('Cleanup note')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
  })

  it('cleans up existing text Annotation editors when the document no longer contains the Annotation', () => {
    store.updatePersisted((draft) => {
      draft.annotations = [makeTextAnnotation('annotation-1', { x: 24, y: 32 }, 'Document note')]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 26, y: 34 }, { button: 0, detail: 2 })
    expect(container.querySelector('textarea')).not.toBeNull()

    store.updatePersisted((draft) => {
      draft.annotations = []
    })
    session.refreshMeasurements()

    expect(container.querySelector('textarea')).toBeNull()
    session.dispose()
  })

  it('shows elliptical zone measurements when one top-level ellipse is selected', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'ellipse-1', name: 'ellipse-1',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 60 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      'W 60 m',
      'H 40 m',
      '1885 m²',
    ])
    session.dispose()
  })

  it('suppresses elliptical zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          id: 'ellipse-1', name: 'ellipse-1',
          zoneType: 'ellipse',
          rotationDeg: 0,
          points: [
            { x: 50, y: 60 },
            { x: 30, y: 20 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          id: 'ellipse-2', name: 'ellipse-2',
          zoneType: 'ellipse',
          rotationDeg: 0,
          points: [
            { x: 150, y: 60 },
            { x: 30, y: 20 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 180, y: 60 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 180, y: 60 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('selects elliptical zones through ellipse hit testing', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-ellipse', name: null,
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 80, y: 50 }, { button: 0 })
    events.pointerUp({ x: 80, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-ellipse']))
    expect(deps.setSelection).toHaveBeenCalledWith([zoneTarget('zone-ellipse')])
    session.dispose()
  })

  it('moves elliptical zones without changing their radii', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-ellipse', name: null,
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 30, y: 20 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 80, y: 50 }, { button: 0 })
    events.pointerMove({ x: 90, y: 65 }, { button: 0 })
    events.pointerUp({ x: 90, y: 65 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-ellipse']))
    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 60, y: 65 },
      { x: 30, y: 20 },
    ])
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    session.dispose()
  })

  it('shows selected polygonal zone edge measurements and area', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'polygon-1', name: 'polygon-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 40, y: 10 }, { button: 0 })
    events.pointerUp({ x: 40, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '50 m',
      '40 m',
      '64 m',
      '1000 m²',
    ])
    session.dispose()
  })

  it('suppresses polygonal zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          id: 'polygon-1', name: 'polygon-1',
          zoneType: 'polygon',
          rotationDeg: 0,
          points: [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 60, y: 50 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          id: 'polygon-2', name: 'polygon-2',
          zoneType: 'polygon',
          rotationDeg: 0,
          points: [
            { x: 100, y: 10 },
            { x: 150, y: 10 },
            { x: 150, y: 50 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 40, y: 10 }, { button: 0 })
    events.pointerUp({ x: 40, y: 10 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 130, y: 10 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 130, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('does not select polygonal zones from empty bounding-box space', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'polygon-1', name: 'polygon-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 15, y: 45 }, { button: 0 })
    events.pointerUp({ x: 15, y: 45 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('shows selected linear zone length from stroke-proximity hit testing', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'line-1', name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 50, y: 13 }, { button: 0 })
    events.pointerUp({ x: 50, y: 13 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['line-1']))
    expect(zoneMeasurementTexts(container)).toEqual(['100 m'])
    session.dispose()
  })

  it('does not select linear zones from empty bounding-box space', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'line-1', name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 60 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 60, y: 60 }, { button: 0 })
    events.pointerUp({ x: 60, y: 60 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('band-selects linear zones when the selection rectangle crosses the segment', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'line-1', name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 50 },
          { x: 110, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 40, y: 40 }, { button: 0 })
    events.pointerMove({ x: 80, y: 60 }, { button: 0 })
    events.pointerUp({ x: 80, y: 60 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['line-1']))
    session.dispose()
  })

  it('quarantines band-selection completion while another Scene Edit owns authority', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('plant-1', 'Malus domestica', { x: 20, y: 20 }),
        makePlant('plant-2', 'Pyrus communis', { x: 120, y: 120 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')
    deps.setSelection([plantTarget('plant-2')])

    events.pointerDown({ x: 0, y: 0 }, { button: 0, pointerId: 101 })
    events.pointerMove({ x: 50, y: 50 }, { button: 0, pointerId: 101 })
    expect(store.session.selectedTargets).toEqual([])
    const unrelated = deps.sceneEdits.begin('external-preview')
    unrelated.mutate((draft) => {
      draft.plants[1]!.position = { x: 130, y: 130 }
    })

    const blockedPointerUp = events.pointerUp(
      { x: 50, y: 50 },
      { button: 0, pointerId: 101 },
    )

    expect(blockedPointerUp.defaultPrevented).toBe(true)
    expect(store.session.selectedTargets).toEqual([])
    unrelated.abort()

    events.pointerDown({ x: 0, y: 0 }, { button: 0, pointerId: 102 })
    events.pointerMove({ x: 50, y: 50 }, { button: 0, pointerId: 102 })
    events.pointerUp({ x: 50, y: 50 }, { button: 0, pointerId: 102 })

    expect(store.session.selectedTargets).toEqual([plantTarget('plant-1')])
    session.dispose()
  })

  it('shows rectangle zone measurements when one top-level zone is selected', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-1', name: null,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1']))
    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '80 m',
      '100 m',
      '80 m',
      '8000 m²',
    ])
    session.dispose()
  })

  it('suppresses rectangle zone measurements for multi-selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [
        {
          kind: 'zone',
          locked: false,
          id: 'zone-1', name: null,
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 10, y: 10 },
            { x: 110, y: 10 },
            { x: 110, y: 90 },
            { x: 10, y: 90 },
          ],
          fillColor: null,
          notes: null,
        },
        {
          kind: 'zone',
          locked: false,
          id: 'zone-2', name: null,
          zoneType: 'rect',
          rotationDeg: 0,
          points: [
            { x: 150, y: 10 },
            { x: 250, y: 10 },
            { x: 250, y: 90 },
            { x: 150, y: 90 },
          ],
          fillColor: null,
          notes: null,
        },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })
    expect(zoneMeasurementTexts(container)).not.toEqual([])

    events.pointerDown({ x: 150, y: 20 }, { button: 0, shiftKey: true })
    events.pointerUp({ x: 150, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1', 'zone-2']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('suppresses rectangle zone measurements for group selection', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-1', name: null,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
      draft.groups = [{
        kind: 'group',
        locked: false,
        id: 'group-1',
        name: null,
        members: [{ kind: 'zone', id: 'zone-1' }],
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['group-1']))
    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('hides short rectangle edge measurements while keeping the area visible', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-1', name: null,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 110 },
          { x: 10, y: 110 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerUp({ x: 10, y: 20 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '100 m',
      '100 m',
      '2000 m²',
    ])
    session.dispose()
  })

  it('suppresses selected rectangle zone measurements when the zones layer is hidden', () => {
    store.updatePersisted((draft) => {
      const zonesLayer = draft.layers.find((layer) => layer.name === 'zones')
      if (zonesLayer) zonesLayer.visible = false
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'zone-1', name: null,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 90 },
          { x: 10, y: 90 },
        ],
        fillColor: null,
        notes: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection([zoneTarget('zone-1')])
    const session = createTestSession(deps)

    session.refreshMeasurements()

    expect(zoneMeasurementTexts(container)).toEqual([])
    session.dispose()
  })

  it('selects Zones by boundary proximity while interior clicks pass through', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
      ])]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerUp({ x: 60, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalledWith([zoneTarget('zone-1')])

    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    events.pointerUp({ x: 10, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['zone-1']))
    session.dispose()
  })

  it('prioritizes Placed Plants over Zone boundary hits', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 90 },
        { x: 10, y: 90 },
      ])]
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 10, y: 50 })]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    events.pointerUp({ x: 10, y: 50 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['plant-1']))
    session.dispose()
  })

  it('reshapes Linear Zones by dragging endpoint Zone Control Points with live measurements', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'line-1', name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="line-endpoint"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'line-endpoint', 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]?.points[1]).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toEqual(['70 m'])

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    session.dispose()
  })

  it('does not reshape Linear Zones or commit edits from no-op Zone Control Point taps', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'line-1', name: 'line-1',
        zoneType: 'line',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="line-endpoint"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'line-endpoint', 1)
    const hitTargetOffset = { x: start.x + 5, y: start.y }
    events.pointerDown(hitTargetOffset, { button: 0, target: handle })
    events.pointerUp(hitTargetOffset, { button: 0, target: handle })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 10 },
    ])
    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('drags Measurement Guide endpoints with live distance labels', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 10, y: 10 }, { x: 60, y: 10 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    const start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.measurementGuides[0]?.end).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toEqual(['70 m'])

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-measurement-guide-control-point')
    session.dispose()
  })

  it('aborts Measurement Guide endpoint drags on Escape and skips no-op commits', () => {
    store.updatePersisted((draft) => {
      draft.plants = []
      draft.zones = []
      draft.annotations = []
      draft.measurementGuides = [
        makeMeasurementGuide('measurement-guide-1', { x: 10, y: 10 }, { x: 60, y: 10 }),
      ]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 30, y: 10 }, { button: 0 })
    events.pointerUp({ x: 30, y: 10 }, { button: 0 })

    let handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    let start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Escape' })

    expect(store.persisted.measurementGuides[0]).toMatchObject({
      start: { x: 10, y: 10 },
      end: { x: 60, y: 10 },
    })
    expect(zoneMeasurementTexts(container)).toEqual([])

    handle = container.querySelector<HTMLElement>(
      '[data-measurement-guide-control-point-index="1"]',
    )!
    start = measurementGuideControlPointCenter(container, 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerUp(start, { button: 0, target: handle })

    expect(store.persisted.measurementGuides[0]).toMatchObject({
      start: { x: 10, y: 10 },
      end: { x: 60, y: 10 },
    })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('reshapes Polygonal Zones by dragging existing vertex Zone Control Points', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'poly-1', name: 'poly-1',
        zoneType: 'polygon',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 10, y: 60 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    events.pointerUp({ x: 10, y: 30 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="polygon-vertex"][data-zone-control-point-index="1"]',
    )!
    const start = zoneControlPointCenter(container, 'polygon-vertex', 1)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 80, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]?.points[1]).toEqual({ x: 80, y: 10 })
    expect(zoneMeasurementTexts(container)).toContain('1750 m²')

    events.pointerUp({ x: 80, y: 10 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    session.dispose()
  })

  it('resizes Rectangular Zones from corner Zone Control Points while preserving rectangle geometry', () => {
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('rect-1', [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
        { x: 10, y: 50 },
      ])]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 10, y: 30 }, { button: 0 })
    events.pointerUp({ x: 10, y: 30 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
    )!
    const start = zoneControlPointCenter(container, 'rect-corner', 2)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 90, y: 70 }, { button: 0 })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 70 },
      { x: 10, y: 70 },
    ])
    expect(zoneMeasurementTexts(container)).toContain('4800 m²')

    events.pointerUp({ x: 90, y: 70 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    session.dispose()
  })

  it('resizes Elliptical Zones from cardinal Zone Control Points with live measurements', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'ellipse-1', name: 'ellipse-1',
        zoneType: 'ellipse',
        rotationDeg: 0,
        points: [
          { x: 50, y: 50 },
          { x: 20, y: 10 },
        ],
        fillColor: null,
        notes: null,
      }]
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 70, y: 50 }, { button: 0 })
    events.pointerUp({ x: 70, y: 50 }, { button: 0 })

    const handle = container.querySelector<HTMLElement>(
      '[data-zone-control-point-kind="ellipse-east"][data-zone-control-point-index="0"]',
    )!
    const start = zoneControlPointCenter(container, 'ellipse-east', 0)
    events.pointerDown(start, { button: 0, target: handle })
    events.pointerMove({ x: 90, y: 50 }, { button: 0 })

    expect(store.persisted.zones[0]?.points).toEqual([
      { x: 60, y: 50 },
      { x: 30, y: 10 },
    ])
    expect(zoneMeasurementTexts(container)).toEqual(['W 60 m', 'H 20 m', '942 m²'])

    events.pointerUp({ x: 90, y: 50 }, { button: 0 })

    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-zone-control-point')
    session.dispose()
  })

  it('snaps dragged plant to grid when snap is enabled', () => {
    // At scale=4, gridInterval() returns 5m (first NICE_DISTANCE where d*4 >= 20)
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true
    store.updatePersisted((draft) => {
      draft.plants = [
        {
          kind: 'plant',
          locked: false,
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: null,
          stratum: null,
          canopySpreadM: 2,
          position: { x: 50, y: 50 },
          rotationDeg: null,
          notes: null,
          plantedDate: null,
          quantity: 1,
        },
        makePlant('plant-2', 'Pyrus communis', { x: 70, y: 60 }),
      ]
    })

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('select')

    // Plant at (50,50). Screen = world * scale = (200,200).
    // Click screen (201,202) → world (50.25, 50.5). snapRef = plant at (50,50).
    // Drag screen (232,248) → world (58,62). rawDelta = (7.75, 11.5).
    // candidate = (50+7.75, 50+11.5) = (57.75, 61.5) → snaps to (60,60).
    // delta = (60-50, 60-50) = (10,10). Final = (60,60).
    events.pointerDown({ x: 201, y: 202 }, { button: 0 })
    events.pointerMove({ x: 232, y: 248 }, { button: 0 })
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-plant-drag-distance-label]'))
      .map((label) => label.textContent)).toEqual(['10 m'])
    events.pointerUp({ x: 232, y: 248 }, { button: 0 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 60, y: 60 })
    expect(container.querySelector('[data-plant-drag-distance-label]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drag')
    session.dispose()
  })

  it('places Saved Object Stamps from drag-and-drop payloads with full geometry ghost preview', () => {
    camera.setViewport({ x: 0, y: 0, scale: 2 })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    const dragData = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return dragData.get(type) ?? ''
      },
    }
    writeSavedObjectStampDragData(dataTransfer, {
      id: 'stamp-1',
      name: 'Guild',
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
          color: '#C44230',
          symbol: 'canopy',
          position: { x: -4, y: 0 },
          rotationDeg: null,
        }],
        zones: [{
          id: 'zone-1',
          name: 'Kitchen bed',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }],
          rotationDeg: 30,
          fillColor: '#CBA24A',
        }],
        annotations: [{
          id: 'annotation-1',
          annotationType: 'text',
          position: { x: 2, y: -5 },
          text: 'Guild',
          fontSize: 11,
          rotationDeg: 45,
        }],
        groups: [],
      }),
    })

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    container.dispatchEvent(dragOverEvent)
    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(container.querySelectorAll('[data-saved-object-stamp-ghost]')).toHaveLength(1)
    expect(container.querySelector('[data-saved-object-stamp-part="zone"]')?.tagName.toLowerCase())
      .toBe('polygon')
    expect(container.querySelector('[data-saved-object-stamp-part="plant-symbol"] circle')).toBeTruthy()
    expect(container.querySelector('[data-saved-object-stamp-part="annotation"]')).toBeNull()
    expect(container.querySelector('[data-saved-object-stamp-part="annotation-marker"]')).not.toBeNull()
    const overviewViewport = camera.viewport
    camera.setViewport({ ...overviewViewport, scale: 20 })
    container.dispatchEvent(dragOverEvent)
    const annotationGhost = container.querySelector<SVGTextElement>('[data-saved-object-stamp-part="annotation"]')
    expect(annotationGhost?.getAttribute('font-size')).toBe('11')
    expect(annotationGhost?.getAttribute('transform')).toContain('rotate(45')

    camera.setViewport(overviewViewport)
    container.dispatchEvent(dragOverEvent)

    protectedDragData = false
    container.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: '#C44230',
      symbol: 'canopy',
      position: { x: 36, y: 45 },
      locked: false,
    })
    expect(store.persisted.zones[0]).toMatchObject({
      name: 'Kitchen bed',
      rotationDeg: 30,
      fillColor: '#CBA24A',
    })
    expect(store.persisted.annotations[0]).toMatchObject({
      text: 'Guild',
      fontSize: 11,
      rotationDeg: 45,
      position: { x: 42, y: 40 },
    })
    expect(selectedObjectIds.value).toEqual(new Set([
      store.persisted.plants[0]!.id,
      store.persisted.zones[0]!.id,
      store.persisted.annotations[0]!.id,
    ]))
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-saved-object-stamp')
    session.dispose()
  })

  it('preserves Saved Object Stamp drag state while another Scene edit owns admission', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    const dragData = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'copy',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return dragData.get(type) ?? ''
      },
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
    const dragEvent = (type: 'dragover' | 'drop') => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(event, {
        clientX: { configurable: true, value: 80 },
        clientY: { configurable: true, value: 90 },
        dataTransfer: { configurable: true, value: dataTransfer },
      })
      return event
    }
    const active = deps.sceneEdits.begin('external-preview')

    container.dispatchEvent(dragEvent('dragover'))
    expect(dataTransfer.dropEffect).toBe('none')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()

    protectedDragData = false
    container.dispatchEvent(dragEvent('drop'))
    expect(store.persisted.plants).toHaveLength(0)

    active.abort()
    protectedDragData = true
    container.dispatchEvent(dragEvent('dragover'))
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).not.toBeNull()

    protectedDragData = false
    container.dispatchEvent(dragEvent('drop'))
    expect(store.persisted.plants).toHaveLength(1)
    session.dispose()
  })

  it('blocks Saved Object Stamp drops when any target Layer is locked', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) =>
        layer.name === 'zones' ? { ...layer, locked: true } : layer,
      )
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'copy',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        return dragData.get(type) ?? ''
      },
    }
    writeSavedObjectStampDragData(dataTransfer, {
      id: 'stamp-1',
      name: 'Bed',
      sort_order: 0,
      created_at: '2026-06-19T09:00:00Z',
      updated_at: '2026-06-19T09:00:00Z',
      payload_json: JSON.stringify({
        version: 2,
        anchor: { x: 0, y: 0 },
        plants: [],
        zones: [{
          id: 'zone-1',
          name: 'Kitchen bed',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          rotationDeg: 0,
          fillColor: null,
        }],
        annotations: [],
        groups: [],
      }),
    })
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    container.dispatchEvent(dragOverEvent)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()

    container.dispatchEvent(dropEvent)

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates plant placements from drag-and-drop payloads through protected dragover data', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    const dragData = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
      setData(type: string, value: string) {
        dragData.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return dragData.get(type) ?? ''
      },
    }
    writePlantStampDragData(dataTransfer, {
      canonical_name: 'Pyrus communis',
      common_name: 'Pear',
      stratum: 'mid',
      width_max_m: 3,
    })

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent)
    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(preview?.style.display).toBe('block')

    protectedDragData = false
    container.dispatchEvent(dropEvent)
    expect(dropEvent.defaultPrevented).toBe(true)

    expect(store.persisted.plants).toHaveLength(1)
    expect(store.persisted.plants[0]).toMatchObject({
      canonicalName: 'Pyrus communis',
      commonName: 'Pear',
      position: { x: 80, y: 90 },
      canopySpreadM: 3,
    })
    expect(preview?.style.display).toBe('none')
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-drop')
    session.dispose()
  })

  it('previews dragover without invoking recovery-capable command admission', () => {
    const commandAdmission: SceneCommandAdmission = {
      revision: signal(0),
      runWhenSettled: vi.fn(() => {
        throw new Error('dragover must not resume pending maintenance')
      }),
    }
    const readWhenSettled = vi.fn()
    const settledReader: SettledSceneReader = {
      revision: signal(0),
      readWhenSettled<T>(operation: () => T): T {
        readWhenSettled()
        return operation()
      },
    }
    const deps = {
      ...createInteractionDeps(container, store, camera, { commandAdmission }),
      settledReader,
    } as SceneInteractionSessionDeps
    const session = createTestSession(deps)
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
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
    const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(event, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    const errors = captureWindowErrors(() => {
      container.dispatchEvent(event)
    })

    expect(errors).toEqual([])
    expect(commandAdmission.runWhenSettled).not.toHaveBeenCalled()
    expect(readWhenSettled).toHaveBeenCalledOnce()
    expect(dataTransfer.dropEffect).toBe('copy')
    session.dispose()
  })

  it('does not show plant drop feedback for protected ordinary text drags', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    const dataTransfer = {
      dropEffect: 'copy',
      types: ['text/plain'],
      getData() {
        return ''
      },
    }
    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent)

    expect(dragOverEvent.defaultPrevented).toBe(true)
    expect(dataTransfer.dropEffect).toBe('none')
    expect(preview?.style.display).toBe('none')
    session.dispose()
  })

  it('does not create plant placements from drag-and-drop payloads on a locked Plants Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'plants' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
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

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dragOverEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperties(dropEvent, {
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: {
        configurable: true,
        value: dataTransfer,
      },
    })
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent)
    container.dispatchEvent(dropEvent)

    expect(store.persisted.plants).toHaveLength(0)
    expect(preview?.style.display).toBe('none')
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('selects the typed Annotation before an overlapping Zone with the same raw id', () => {
    store.updatePersisted((draft) => {
      draft.zones = [{
        kind: 'zone',
        locked: false,
        id: 'shared', name: 'shared',
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 110, y: 10 },
          { x: 110, y: 80 },
          { x: 10, y: 80 },
        ],
        fillColor: null,
        notes: null,
      }]
      draft.annotations = [{
        kind: 'annotation',
        locked: false,
        id: 'shared',
        annotationType: 'text',
        position: { x: 20, y: 20 },
        text: 'Top note',
        fontSize: 16,
        rotationDeg: null,
      }]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 24, y: 24 }, { button: 0 })
    events.pointerUp({ x: 24, y: 24 }, { button: 0 })

    expect(selectedObjectIds.value).toEqual(new Set(['shared']))
    expect(deps.setSelection).toHaveBeenCalledWith([annotationTarget('shared')])
    session.dispose()
  })

  it('clears selection through the runtime seam when clicking empty canvas', () => {
    selectedObjectIds.value = new Set(['plant-1'])
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 380, y: 280 }, { button: 0 })
    events.pointerUp({ x: 380, y: 280 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it('temporarily pans with the space key while select is active', () => {
    const render = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render })
    const session = createTestSession(deps)
    session.setTool('select')

    events.holdSpace()
    events.pointerDown({ x: 100, y: 100 })
    events.pointerMove({ x: 130, y: 120 })
    events.pointerUp({ x: 130, y: 120 })
    events.releaseSpace()

    expect(camera.viewport.x).toBe(30)
    expect(camera.viewport.y).toBe(20)
    expect(render).toHaveBeenCalled()
    session.dispose()
  })

  it('uses the pointer-down bounds for the full captured gesture', () => {
    events.setBounds({ left: 10, top: 20, width: 400, height: 300 })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 12 })
    events.setBounds({ left: 30, top: 40, width: 400, height: 300 })
    events.pointerMoveClient({ x: 55, y: 75 }, { pointerId: 12 })
    events.pointerUpClient({ x: 55, y: 75 }, { pointerId: 12 })

    expect(store.persisted.plants[0]?.position).toEqual({ x: 45, y: 55 })
    session.dispose()
  })

  it('finishes independent transient cleanup when one presentation callback fails', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    let failHoveredWrite = false
    const setHoveredTarget = vi.fn(() => {
      if (failHoveredWrite) throw new Error('hover cleanup failed')
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      onSceneEditCommit,
      setHoveredTarget,
    })
    const session = createTestSession(deps)
    session.setTool('select')

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 15 })
    events.pointerMove({ x: 35, y: 45 }, { pointerId: 15 })
    events.holdSpace()
    failHoveredWrite = true
    expect(() => session.setTool('rectangle')).toThrow('hover cleanup failed')
    failHoveredWrite = false

    expect(store.persisted.plants[0]?.position).toEqual({ x: 20, y: 30 })
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    expect(container.style.cursor).toBe('default')
    session.dispose()
  })

  it('rolls back earlier resources when a collaborator fails during Session construction', () => {
    const deps = createInteractionDeps(container, store, camera)
    const originalAppendChild = container.appendChild.bind(container)
    const appendChild = vi.spyOn(container, 'appendChild').mockImplementation(
      (<T extends Node>(node: T): T => {
        if (node instanceof HTMLElement && node.dataset.rotationHandle === 'true') {
          throw new Error('rotation handle construction failed')
        }
        return originalAppendChild(node) as T
      }) as typeof container.appendChild,
    )

    try {
      expect(() => createSceneInteractionSession(deps)).toThrow('rotation handle construction failed')
    } finally {
      appendChild.mockRestore()
    }

    expect(container.children).toHaveLength(0)
  })

  it('removes an eager collaborator root when its initialization throws after append', () => {
    let rotationRootAppended = false
    const originalAppendChild = container.appendChild.bind(container)
    const appendChild = vi.spyOn(container, 'appendChild').mockImplementation(
      (<T extends Node>(node: T): T => {
        const appended = originalAppendChild(node) as T
        if (node instanceof HTMLElement && node.dataset.rotationHandle === 'true') {
          rotationRootAppended = true
        }
        return appended
      }) as typeof container.appendChild,
    )
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection: () => {
        if (rotationRootAppended) throw new Error('rotation initialization failed')
        return getDesignObjectSelectionFromStore(store, camera)
      },
    })

    try {
      expect(() => createSceneInteractionSession(deps)).toThrow('rotation initialization failed')
    } finally {
      appendChild.mockRestore()
    }

    expect(rotationRootAppended).toBe(true)
    expect(container.children).toHaveLength(0)
  })

  it.each([
    {
      name: 'Zone Drawing tool',
      failure: 'zone measurement construction failed',
      createFault() {
        let polygonOverlayAppended = false
        let targetReached = false
        return {
          shouldFail(node: Node) {
            if (node instanceof SVGElement && node.dataset.polygonDraftOverlay === 'true') {
              polygonOverlayAppended = true
              return false
            }
            targetReached = polygonOverlayAppended
              && node instanceof HTMLElement
              && node.dataset.zoneMeasurementOverlay === 'true'
            return targetReached
          },
          wasTargetReached: () => targetReached,
        }
      },
    },
    {
      name: 'Measurement Guide Control Points',
      failure: 'measurement control point overlay construction failed',
      createFault() {
        let controlPointRootAppended = false
        let targetReached = false
        return {
          shouldFail(node: Node) {
            if (node instanceof HTMLElement && node.dataset.measurementGuideControlPoints === 'true') {
              controlPointRootAppended = true
              return false
            }
            targetReached = controlPointRootAppended
              && node instanceof HTMLElement
              && node.dataset.zoneMeasurementOverlay === 'true'
            return targetReached
          },
          wasTargetReached: () => targetReached,
        }
      },
    },
  ])('rolls back partial $name resources when a later append fails', ({ failure, createFault }) => {
    const { shouldFail, wasTargetReached } = createFault()
    const deps = createInteractionDeps(container, store, camera)
    const originalAppendChild = container.appendChild.bind(container)
    const appendChild = vi.spyOn(container, 'appendChild').mockImplementation(
      (<T extends Node>(node: T): T => {
        if (shouldFail(node)) throw new Error(failure)
        return originalAppendChild(node) as T
      }) as typeof container.appendChild,
    )

    try {
      expect(() => createSceneInteractionSession(deps)).toThrow(failure)
    } finally {
      appendChild.mockRestore()
    }

    expect(wasTargetReached()).toBe(true)
    expect(container.children).toHaveLength(0)
  })

  it('refreshes presentation after pointer-up cancellation reports an error', () => {
    const getDesignObjectSelection = vi.fn(() => getDesignObjectSelectionFromStore(store, camera))
    let failHoveredWrite = false
    const deps = createInteractionDeps(container, store, camera, {
      getDesignObjectSelection,
      setHoveredTarget: () => {
        if (failHoveredWrite) throw new Error('pointer-up cleanup failed')
      },
    })
    const session = createTestSession(deps)
    session.setTool('select')
    events.pointerDown({ x: 300, y: 200 }, { pointerId: 21 })
    const readsBeforePointerUp = getDesignObjectSelection.mock.calls.length

    failHoveredWrite = true
    const errors = captureWindowErrors(() => {
      events.pointerUp({ x: 300, y: 200 }, { pointerId: 21 })
    })
    failHoveredWrite = false

    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({ message: 'pointer-up cleanup failed' }))
    expect(getDesignObjectSelection.mock.calls.length).toBeGreaterThan(readsBeforePointerUp)
    session.dispose()
  })

  it.each(['Zone', 'Measurement Guide'] as const)(
    'restores selection presentation when %s Control Point cancellation rendering fails',
    (kind) => {
      if (kind === 'Zone') {
        store.updatePersisted((draft) => {
          draft.zones = [makeRectZone('zone-1', [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 60, y: 50 },
            { x: 10, y: 50 },
          ])]
        })
      } else {
        store.updatePersisted((draft) => {
          draft.measurementGuides = [
            makeMeasurementGuide('measurement-guide-1', { x: 10, y: 10 }, { x: 60, y: 10 }),
          ]
        })
      }
      let failRender = false
      const deps = createInteractionDeps(container, store, camera, {
        render: () => {
          if (failRender) throw new Error(`${kind} cancellation render failed`)
        },
      })
      deps.setSelection([
        kind === 'Zone' ? zoneTarget('zone-1') : measurementGuideTarget('measurement-guide-1'),
      ])
      const session = createTestSession(deps)
      session.setTool('select')
      session.refreshMeasurements()
      const rotationHandle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
      const settledHandleDisplay = kind === 'Zone' ? 'inline-flex' : 'none'
      const handle = kind === 'Zone'
        ? container.querySelector<HTMLElement>('[data-zone-control-point-kind="rect-corner"]')!
        : container.querySelector<HTMLElement>('[data-measurement-guide-control-point-index="1"]')!
      const start = kind === 'Zone'
        ? zoneControlPointCenter(container, 'rect-corner', Number(handle.dataset.zoneControlPointIndex))
        : measurementGuideControlPointCenter(container, 1)
      expect(rotationHandle.style.display).toBe(settledHandleDisplay)

      events.pointerDown(start, { pointerId: 22, target: handle })
      events.pointerMove({ x: 90, y: 70 }, { pointerId: 22 })
      expect(rotationHandle.style.display).toBe('none')

      failRender = true
      const errors = captureWindowErrors(() => {
        events.pointerCancel({ x: 90, y: 70 }, { pointerId: 22 })
      })
      failRender = false

      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual(expect.objectContaining({ message: `${kind} cancellation render failed` }))
      expect(rotationHandle.style.display).toBe(settledHandleDisplay)
      session.dispose()
    },
  )

  it.each(['Rotation Handle', 'Zone Control Point', 'Measurement Guide Control Point'] as const)(
    'rolls back live geometry when %s transaction commit fails',
    (kind) => {
      const targetId = kind === 'Measurement Guide Control Point' ? 'measurement-guide-1' : 'zone-1'
      if (kind === 'Measurement Guide Control Point') {
        store.updatePersisted((draft) => {
          draft.measurementGuides = [
            makeMeasurementGuide(targetId, { x: 20, y: 80 }, { x: 120, y: 80 }),
          ]
        })
      } else {
        store.updatePersisted((draft) => {
          draft.zones = [makeRectZone(targetId, [
            { x: 20, y: 80 },
            { x: 120, y: 80 },
            { x: 120, y: 140 },
            { x: 20, y: 140 },
          ])]
        })
      }
      const onSceneEditCommit = vi.fn(() => {
        throw new Error(`${kind} commit failed`)
      })
      const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
      deps.setSelection([
        kind === 'Measurement Guide Control Point'
          ? measurementGuideTarget(targetId)
          : zoneTarget(targetId),
      ])
      const session = createTestSession(deps)
      session.setTool('select')
      session.refreshMeasurements()
      const persistedBefore = store.snapshot().persisted
      const rotationHandle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
      const settledHandleDisplay = kind === 'Measurement Guide Control Point' ? 'none' : 'inline-flex'
      expect(rotationHandle.style.display).toBe(settledHandleDisplay)

      let handle: HTMLElement
      let start: ScenePoint
      let end: ScenePoint
      if (kind === 'Rotation Handle') {
        handle = container.querySelector<HTMLElement>('[data-rotation-handle]')!
        start = rotationHandleCenter(container)
        end = { x: 128, y: 110 }
      } else if (kind === 'Zone Control Point') {
        handle = container.querySelector<HTMLElement>(
          '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
        )!
        start = zoneControlPointCenter(container, 'rect-corner', 2)
        end = { x: 150, y: 170 }
      } else {
        handle = container.querySelector<HTMLElement>(
          '[data-measurement-guide-control-point-index="1"]',
        )!
        start = measurementGuideControlPointCenter(container, 1)
        end = { x: 150, y: 110 }
      }

      events.pointerDown(start, { pointerId: 23, target: handle })
      events.pointerMove(end, { pointerId: 23 })
      expect(store.persisted).not.toEqual(persistedBefore)

      const errors = captureWindowErrors(() => {
        events.pointerUp(end, { pointerId: 23 })
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual(expect.objectContaining({ message: `${kind} commit failed` }))
      expect(onSceneEditCommit).toHaveBeenCalledTimes(1)
      expect(store.persisted).toEqual(persistedBefore)
      expect(rotationHandle.style.display).toBe(settledHandleDisplay)
      if (kind === 'Rotation Handle') {
        expect(handle.dataset.rotationHandleActive).toBeUndefined()
        expect(handle.style.cursor).toBe('grab')
      } else if (kind === 'Zone Control Point') {
        expect(container.querySelector<HTMLElement>('[data-zone-control-points]')
          ?.dataset.zoneControlPointActive).toBeUndefined()
      } else {
        expect(container.querySelector<HTMLElement>('[data-measurement-guide-control-points]')
          ?.dataset.measurementGuideControlPointActive).toBeUndefined()
      }
      session.dispose()
    },
  )

  it.each(['Rotation Handle', 'Zone Control Point', 'Measurement Guide Control Point'] as const)(
    'keeps the %s transaction reachable when abort fails',
    (kind) => {
      const designObjectId = kind === 'Measurement Guide Control Point' ? 'measurement-guide-1' : 'zone-1'
      if (kind !== 'Measurement Guide Control Point') {
        store.updatePersisted((draft) => {
          draft.zones = [makeRectZone(designObjectId, [
            { x: 20, y: 80 },
            { x: 120, y: 80 },
            { x: 120, y: 140 },
            { x: 20, y: 140 },
          ])]
        })
      } else {
        store.updatePersisted((draft) => {
          draft.measurementGuides = [
            makeMeasurementGuide(designObjectId, { x: 20, y: 80 }, { x: 120, y: 80 }),
          ]
        })
      }
      const baseDeps = createInteractionDeps(container, store, camera)
      const editType = kind === 'Rotation Handle'
        ? 'interaction-rotate'
        : kind === 'Zone Control Point'
          ? 'interaction-zone-control-point'
          : 'interaction-measurement-guide-control-point'
      const abortFailure = createAbortFailingSceneEdits(
        baseDeps.sceneEdits,
        editType,
        `${kind} abort failed`,
      )
      const deps: SceneInteractionSessionDeps = { ...baseDeps, sceneEdits: abortFailure.sceneEdits }
      deps.setSelection([
        kind === 'Measurement Guide Control Point'
          ? measurementGuideTarget(designObjectId)
          : zoneTarget(designObjectId),
      ])
      const session = createTestSession(deps)
      session.setTool('select')
      session.refreshMeasurements()
      const persistedBefore = store.snapshot().persisted
      const handle = kind === 'Rotation Handle'
        ? container.querySelector<HTMLElement>('[data-rotation-handle]')!
        : kind === 'Zone Control Point'
          ? container.querySelector<HTMLElement>(
              '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
            )!
          : container.querySelector<HTMLElement>('[data-measurement-guide-control-point-index="1"]')!
      const start = kind === 'Rotation Handle'
        ? rotationHandleCenter(container)
        : kind === 'Zone Control Point'
          ? zoneControlPointCenter(container, 'rect-corner', 2)
          : measurementGuideControlPointCenter(container, 1)
      const end = kind === 'Rotation Handle' ? { x: 128, y: 110 } : { x: 150, y: 170 }

      events.pointerDown(start, { pointerId: 24, target: handle })
      events.pointerMove(end, { pointerId: 24 })
      expect(store.persisted).not.toEqual(persistedBefore)

      const errors = captureWindowErrors(() => {
        events.pointerCancel(end, { pointerId: 24 })
      })

      expect(errors).toHaveLength(1)
      expect(errors[0]).toEqual(expect.objectContaining({ message: `${kind} abort failed` }))
      expect(abortFailure.abortCalls()).toBe(1)
      expect(abortFailure.beginCalls()).toBe(1)
      expect(abortFailure.beginTypes()).toEqual([editType])
      expect(store.persisted).not.toEqual(persistedBefore)
      if (kind === 'Rotation Handle') {
        expect(handle.dataset.rotationHandleActive).toBeUndefined()
        expect(handle.style.cursor).toBe('grab')
        expect(container.querySelector<HTMLElement>('[data-rotation-handle-readout]')?.style.display).toBe('none')
      }

      events.pointerDown(start, { pointerId: 25 })

      expect(abortFailure.abortCalls()).toBe(2)
      expect(abortFailure.beginCalls()).toBe(1)
      expect(abortFailure.beginTypes()).toEqual([editType])
      expect(store.persisted).toEqual(persistedBefore)
      if (kind === 'Rotation Handle') {
        expect(handle.dataset.rotationHandleActive).toBeUndefined()
      } else if (kind === 'Zone Control Point') {
        expect(container.querySelector<HTMLElement>('[data-zone-control-points]')
          ?.dataset.zoneControlPointActive).toBeUndefined()
      } else {
        expect(container.querySelector<HTMLElement>('[data-measurement-guide-control-points]')
          ?.dataset.measurementGuideControlPointActive).toBeUndefined()
      }

      events.pointerMove(end, { pointerId: 25 })
      events.pointerUp(end, { pointerId: 25 })

      expect(abortFailure.beginTypes()).toEqual([editType])
      expect(store.persisted).toEqual(persistedBefore)

      const freshHandle = kind === 'Rotation Handle'
        ? container.querySelector<HTMLElement>('[data-rotation-handle]')!
        : kind === 'Zone Control Point'
          ? container.querySelector<HTMLElement>(
              '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
            )!
          : container.querySelector<HTMLElement>('[data-measurement-guide-control-point-index="1"]')!
      events.pointerDown(start, { pointerId: 26, target: freshHandle })

      expect(abortFailure.beginTypes()).toEqual([editType, editType])
      events.pointerCancel(start, { pointerId: 26 })
      expect(abortFailure.abortCalls()).toBe(3)
      expect(store.persisted).toEqual(persistedBefore)
      session.dispose()
      expect(abortFailure.abortCalls()).toBe(3)
    },
  )

  it.each(['Rotation Handle', 'Zone Control Point', 'Measurement Guide Control Point'] as const)(
    'removes owned %s resources when abort keeps failing during disposal',
    (kind) => {
      const designObjectId = kind === 'Measurement Guide Control Point' ? 'measurement-guide-1' : 'zone-1'
      if (kind === 'Measurement Guide Control Point') {
        store.updatePersisted((draft) => {
          draft.measurementGuides = [
            makeMeasurementGuide(designObjectId, { x: 20, y: 80 }, { x: 120, y: 80 }),
          ]
        })
      } else {
        store.updatePersisted((draft) => {
          draft.zones = [makeRectZone(designObjectId, [
            { x: 20, y: 80 },
            { x: 120, y: 80 },
            { x: 120, y: 140 },
            { x: 20, y: 140 },
          ])]
        })
      }
      const editType = kind === 'Rotation Handle'
        ? 'interaction-rotate'
        : kind === 'Zone Control Point'
          ? 'interaction-zone-control-point'
          : 'interaction-measurement-guide-control-point'
      const baseDeps = createInteractionDeps(container, store, camera)
      const abortFailure = createAbortFailingSceneEdits(
        baseDeps.sceneEdits,
        editType,
        `${kind} abort failed`,
        'always',
      )
      const session = createTestSession({ ...baseDeps, sceneEdits: abortFailure.sceneEdits })
      baseDeps.setSelection([
        kind === 'Measurement Guide Control Point'
          ? measurementGuideTarget(designObjectId)
          : zoneTarget(designObjectId),
      ])
      session.setTool('select')
      session.refreshMeasurements()
      const handle = kind === 'Rotation Handle'
        ? container.querySelector<HTMLElement>('[data-rotation-handle]')!
        : kind === 'Zone Control Point'
          ? container.querySelector<HTMLElement>(
              '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]',
            )!
          : container.querySelector<HTMLElement>('[data-measurement-guide-control-point-index="1"]')!
      const start = kind === 'Rotation Handle'
        ? rotationHandleCenter(container)
        : kind === 'Zone Control Point'
          ? zoneControlPointCenter(container, 'rect-corner', 2)
          : measurementGuideControlPointCenter(container, 1)

      events.pointerDown(start, { pointerId: 27, target: handle })
      events.pointerMove({ x: 150, y: 170 }, { pointerId: 27 })

      expect(() => session.dispose()).toThrow('Scene Interaction Session disposal failed')
      expect(abortFailure.abortCalls()).toBe(2)
      expect(container.querySelector('[data-rotation-handle]')).toBeNull()
      expect(container.querySelector('[data-zone-control-points]')).toBeNull()
      expect(container.querySelector('[data-measurement-guide-control-points]')).toBeNull()
      expect(container.querySelector('[data-zone-measurement-overlay]')).toBeNull()
    },
  )

  it('retries failed shared-drag cancellation before admitting another pointerdown', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const baseDeps = createInteractionDeps(container, store, camera)
    const abortFailure = createAbortFailingSceneEdits(
      baseDeps.sceneEdits,
      'interaction-drag',
      'shared drag abort failed',
    )
    const deps: SceneInteractionSessionDeps = { ...baseDeps, sceneEdits: abortFailure.sceneEdits }
    const session = createTestSession(deps)
    session.setTool('select')
    const persistedBefore = store.snapshot().persisted

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 26 })
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 26 })
    expect(store.persisted).not.toEqual(persistedBefore)

    const errors = captureWindowErrors(() => {
      events.pointerCancel({ x: 40, y: 50 }, { pointerId: 26 })
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({ message: 'shared drag abort failed' }))
    expect(abortFailure.abortCalls()).toBe(1)
    expect(abortFailure.beginCalls()).toBe(1)
    expect(store.persisted).not.toEqual(persistedBefore)

    events.pointerDown({ x: 40, y: 50 }, { pointerId: 27 })

    expect(abortFailure.abortCalls()).toBe(2)
    expect(abortFailure.beginCalls()).toBe(1)
    expect(store.persisted).toEqual(persistedBefore)
    session.dispose()
    expect(abortFailure.abortCalls()).toBe(2)
  })

  it('retries failed shared-drag cancellation instead of committing on a later pointerup', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const baseDeps = createInteractionDeps(container, store, camera)
    const abortFailure = createAbortFailingSceneEdits(
      baseDeps.sceneEdits,
      'interaction-drag',
      'shared drag abort failed',
    )
    const deps: SceneInteractionSessionDeps = { ...baseDeps, sceneEdits: abortFailure.sceneEdits }
    const session = createTestSession(deps)
    session.setTool('select')
    const persistedBefore = store.snapshot().persisted

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 28 })
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 28 })
    expect(store.persisted).not.toEqual(persistedBefore)

    const errors = captureWindowErrors(() => {
      events.pointerCancel({ x: 40, y: 50 }, { pointerId: 28 })
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toEqual(expect.objectContaining({ message: 'shared drag abort failed' }))
    expect(abortFailure.abortCalls()).toBe(1)
    expect(abortFailure.beginCalls()).toBe(1)

    events.pointerUp({ x: 40, y: 50 }, { pointerId: 28 })

    expect(abortFailure.abortCalls()).toBe(2)
    expect(abortFailure.beginCalls()).toBe(1)
    expect(store.persisted).toEqual(persistedBefore)
    session.dispose()
    expect(abortFailure.abortCalls()).toBe(2)
  })

  it('retries failed shared-drag cancellation instead of admitting a plant drop', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const baseDeps = createInteractionDeps(container, store, camera)
    const abortFailure = createAbortFailingSceneEdits(
      baseDeps.sceneEdits,
      'interaction-drag',
      'shared drag abort failed',
    )
    const deps: SceneInteractionSessionDeps = { ...baseDeps, sceneEdits: abortFailure.sceneEdits }
    const session = createTestSession(deps)
    session.setTool('select')
    const persistedBefore = store.snapshot().persisted

    events.pointerDown({ x: 20, y: 30 }, { pointerId: 29 })
    events.pointerMove({ x: 40, y: 50 }, { pointerId: 29 })
    const errors = captureWindowErrors(() => {
      events.pointerCancel({ x: 40, y: 50 }, { pointerId: 29 })
    })
    expect(errors).toHaveLength(1)

    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      get types() {
        return Array.from(dragData.keys())
      },
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
      clientX: { configurable: true, value: 80 },
      clientY: { configurable: true, value: 90 },
      dataTransfer: { configurable: true, value: dataTransfer },
    })

    container.dispatchEvent(dropEvent)

    expect(dropEvent.defaultPrevented).toBe(true)
    expect(abortFailure.abortCalls()).toBe(2)
    expect(abortFailure.beginCalls()).toBe(1)
    expect(store.persisted).toEqual(persistedBefore)
    session.dispose()
    expect(abortFailure.abortCalls()).toBe(2)
  })

  it('quarantines failed cancellation before earlier global keyboard shortcuts', () => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 20, y: 30 })]
    })
    const shortcut = vi.fn()
    window.addEventListener('keydown', shortcut)
    try {
      const baseDeps = createInteractionDeps(container, store, camera)
      const abortFailure = createAbortFailingSceneEdits(
        baseDeps.sceneEdits,
        'interaction-drag',
        'shared drag abort failed',
      )
      const deps: SceneInteractionSessionDeps = { ...baseDeps, sceneEdits: abortFailure.sceneEdits }
      const session = createTestSession(deps)
      session.setTool('select')
      const persistedBefore = store.snapshot().persisted

      events.pointerDown({ x: 20, y: 30 }, { pointerId: 30 })
      events.pointerMove({ x: 40, y: 50 }, { pointerId: 30 })
      const errors = captureWindowErrors(() => {
        events.pointerCancel({ x: 40, y: 50 }, { pointerId: 30 })
      })
      expect(errors).toHaveLength(1)

      const keydown = events.keyDown({ key: 'Delete', code: 'Delete' })

      expect(keydown.defaultPrevented).toBe(true)
      expect(shortcut).not.toHaveBeenCalled()
      expect(abortFailure.abortCalls()).toBe(2)
      expect(store.persisted).toEqual(persistedBefore)
      session.dispose()
    } finally {
      window.removeEventListener('keydown', shortcut)
    }
  })

  it('clears hover when disposed', () => {
    const setHoveredTarget = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { setHoveredTarget })
    const session = createTestSession(deps)

    session.dispose()

    expect(setHoveredTarget).toHaveBeenCalledWith(null)
  })
})
