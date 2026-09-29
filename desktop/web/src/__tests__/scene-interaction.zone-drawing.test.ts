// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm Polygon, Rectangle, Ellipse, Line or Measure.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { describe, expect, it, vi } from 'vitest'
import { selectPlantStampSource } from '../canvas/plant-stamp-source'
import { selectedObjectIds } from '../canvas/session-state'
import { snapToGridEnabled, snapToGuidesEnabled } from '../app/canvas-settings/signals'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import type {
  SceneInteractionSession,
  SceneInteractionSessionDeps,
} from '../canvas/runtime/scene-interaction'
import { SceneHistory } from '../canvas/runtime/scene-history'
import {
  SceneRuntimeEditCoordinator,
  type SceneEditTransaction,
} from '../canvas/runtime/scene-runtime/transactions'
import type { SceneInteractionEventHarness } from './support/scene-interaction-events'
import {
  storedGeo,
  contextMenuCommand,
  createInteractionDeps,
  createSelectionCommands,
  plantTarget,
  createAbortFailingSceneEdits,
  withoutNativeRandomUUID,
  zoneMeasurementTexts,
  captureWindowErrors,
  makePlant,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession, openContextMenu } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('opens the context menu during a drawing gesture without committing the draft', () => {
    const pasteAt = vi.fn()
    const deps = createInteractionDeps(container, store, camera, {
      selectionCommands: createSelectionCommands({
        canPaste: () => true,
        pasteAt,
      }),
    })
    const session = createTestSession(deps)
    session.setTool('polygon')
    events.pointerDown({ x: 20, y: 20 })
    events.pointerDown({ x: 80, y: 20 })
    events.pointerDown({ x: 80, y: 80 })

    openContextMenu({ x: 200, y: 180 })
    contextMenuCommand('paste').run()

    expect(pasteAt).toHaveBeenCalledWith({ x: 200, y: 180 })
    expect(store.persisted.zones).toHaveLength(0)
    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    session.dispose()
  })

  it('uses primary drag for navigation in overview regardless of the armed tool', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')
    session.setOverviewMode(true)
    const scene = structuredClone(store.persisted)
    const before = camera.viewport

    events.pointerDown({ x: 100, y: 100 }, { button: 0 })
    events.pointerMove({ x: 140, y: 125 }, { button: 0 })
    events.pointerUp({ x: 140, y: 125 }, { button: 0 })

    expect(camera.viewport).toEqual({ x: before.x + 40, y: before.y + 25, scale: before.scale })
    expect(store.persisted).toEqual(scene)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('aborts an active drawing when overview begins and quarantines its late pointer-up', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 20, y: 20 }, { button: 0, pointerId: 72 })
    events.pointerMove({ x: 80, y: 60 }, { button: 0, pointerId: 72 })
    session.setOverviewMode(true)
    events.pointerUp({ x: 80, y: 60 }, { button: 0, pointerId: 72 })

    expect(store.persisted.zones).toEqual([])
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates a rectangle zone from the rectangle tool drag', () => {
    const render = vi.fn()
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { render, onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 })
    events.pointerMove({ x: 40, y: 60 })
    events.pointerUp({ x: 40, y: 60 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 60 },
        { x: 10, y: 60 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rectangle')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it.each([
    { label: 'Rectangle', tool: 'rectangle' },
    { label: 'Measurement Guide', tool: 'measurement-guide' },
  ])('keeps a $label drag authoritative until pointer-up commits it', ({ tool }) => {
    const history = new SceneHistory()
    const record = history.record.bind(history)
    let unrelatedRecordFailures = 2
    vi.spyOn(history, 'record').mockImplementation((command, transaction) => {
      const recorded = record(command, transaction)
      if (command.type === 'unrelated-immediate' && unrelatedRecordFailures > 0) {
        unrelatedRecordFailures -= 1
        throw new Error('unrelated publication failed')
      }
      return recorded
    })
    const baseDeps = createInteractionDeps(container, store, camera)
    const coordinator = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: baseDeps.setSelection,
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    })
    const deps: SceneInteractionSessionDeps = {
      ...baseDeps,
      sceneEdits: coordinator,
      commandAdmission: coordinator,
    }
    const session = createTestSession(deps)
    session.setTool(tool)

    events.pointerDown({ x: 10, y: 20 })
    events.pointerMove({ x: 40, y: 60 })
    const unrelatedEdit = vi.fn((tx: SceneEditTransaction) => {
      tx.mutate((draft) => {
        draft.plantSpeciesColors['Malus domestica'] = '#335577'
      })
    })
    let unrelatedResult: boolean | undefined
    expect(() => {
      unrelatedResult = coordinator.run('unrelated-immediate', unrelatedEdit)
    }).not.toThrow()
    expect(unrelatedResult).toBe(false)
    events.pointerUp({ x: 40, y: 60 })

    expect(unrelatedEdit).not.toHaveBeenCalled()
    if (tool === 'rectangle') {
      expect(store.persisted.zones).toHaveLength(1)
      expect(store.persisted.zones[0]).toMatchObject({
        zoneType: 'rect',
        points: [
          { x: 10, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 60 },
          { x: 10, y: 60 },
        ],
      })
    } else {
      expect(store.persisted.measurementGuides).toEqual([
        expect.objectContaining({
          start: { x: 10, y: 20 },
          end: { x: 40, y: 60 },
        }),
      ])
    }
    session.dispose()
  })

  it.each([
    {
      label: 'Rectangle',
      tool: 'rectangle',
      editType: 'interaction-rectangle',
    },
    {
      label: 'Measurement Guide',
      tool: 'measurement-guide',
      editType: 'interaction-measurement-guide',
    },
  ])('retries a failed $label drag abort before admitting another gesture', ({
    tool,
    editType,
  }) => {
    const baseDeps = createInteractionDeps(container, store, camera)
    const abortFailure = createAbortFailingSceneEdits(
      baseDeps.sceneEdits,
      editType,
      `${editType} abort failed`,
    )
    const session = createTestSession({
      ...baseDeps,
      sceneEdits: abortFailure.sceneEdits,
    })
    session.setTool(tool)

    events.pointerDown({ x: 10, y: 20 }, { pointerId: 71 })
    events.pointerMove({ x: 40, y: 60 }, { pointerId: 71 })
    const errors = captureWindowErrors(() => {
      events.pointerCancel({ x: 40, y: 60 }, { pointerId: 71 })
    })

    expect(errors).toEqual([
      expect.objectContaining({ message: `${editType} abort failed` }),
    ])
    expect(abortFailure.abortCalls()).toBe(1)
    expect(abortFailure.beginTypes()).toEqual([editType])

    events.pointerDown({ x: 10, y: 20 }, { pointerId: 72 })
    expect(abortFailure.abortCalls()).toBe(2)
    expect(abortFailure.beginTypes()).toEqual([editType])
    events.pointerMove({ x: 40, y: 60 }, { pointerId: 72 })
    events.pointerUp({ x: 40, y: 60 }, { pointerId: 72 })

    events.pointerDown({ x: 10, y: 20 }, { pointerId: 73 })
    events.pointerMove({ x: 40, y: 60 }, { pointerId: 73 })
    events.pointerUp({ x: 40, y: 60 }, { pointerId: 73 })

    expect(abortFailure.beginTypes()).toEqual([editType, editType])
    if (tool === 'rectangle') {
      expect(store.persisted.zones).toHaveLength(1)
    } else {
      expect(store.persisted.measurementGuides).toHaveLength(1)
    }
    session.dispose()
  })

  it('quarantines pointer-up while a drag commit finishes retained publication', () => {
    const history = new SceneHistory()
    const record = history.record.bind(history)
    let publicationFailures = 2
    vi.spyOn(history, 'record').mockImplementation((command, transaction) => {
      const recorded = record(command, transaction)
      if (command.type === 'interaction-rectangle' && publicationFailures > 0) {
        publicationFailures -= 1
        throw new Error('rectangle publication failed')
      }
      return recorded
    })
    const baseDeps = createInteractionDeps(container, store, camera)
    const coordinator = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: baseDeps.setSelection,
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    })
    const session = createTestSession({
      ...baseDeps,
      sceneEdits: coordinator,
      commandAdmission: coordinator,
    })
    session.setTool('rectangle')
    const downstreamPointerUp = vi.fn()
    window.addEventListener('pointerup', downstreamPointerUp)

    try {
      events.pointerDown({ x: 10, y: 20 }, { pointerId: 81 })
      events.pointerMove({ x: 40, y: 60 }, { pointerId: 81 })
      const pointerUpEvents: PointerEvent[] = []
      const errors = captureWindowErrors(() => {
        pointerUpEvents.push(events.pointerUp({ x: 40, y: 60 }, { pointerId: 81 }))
      })

      expect(errors).toHaveLength(1)
      expect(pointerUpEvents[0]?.defaultPrevented).toBe(true)
      expect(downstreamPointerUp).not.toHaveBeenCalled()
      expect(store.persisted.zones).toHaveLength(1)
      expect(coordinator.canUndo.value).toBe(false)

      events.pointerDown({ x: 10, y: 20 }, { pointerId: 82 })

      expect(store.persisted.zones).toHaveLength(1)
      expect(coordinator.canUndo.value).toBe(true)
      expect(coordinator.undo()).toBe(true)
      expect(coordinator.undo()).toBe(false)
      expect(store.persisted.zones).toHaveLength(0)
    } finally {
      window.removeEventListener('pointerup', downstreamPointerUp)
      session.dispose()
    }
  })

  it.each([
    { label: 'Rectangle', tool: 'rectangle' },
    { label: 'Measurement Guide', tool: 'measurement-guide' },
  ])('retries retained $label cleanup before admitting another drag', ({ tool }) => {
    const history = new SceneHistory()
    const baseDeps = createInteractionDeps(container, store, camera)
    const coordinator = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: baseDeps.setSelection,
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    })
    const session = createTestSession({
      ...baseDeps,
      sceneEdits: coordinator,
      commandAdmission: coordinator,
    })
    session.setTool(tool)

    events.pointerDown({ x: 10, y: 20 }, { pointerId: 91 })
    events.pointerMove({ x: 40, y: 60 }, { pointerId: 91 })
    const measurementOverlay = Array.from(
      container.querySelectorAll<HTMLElement>('[data-zone-measurement-overlay]'),
    ).find((overlay) => overlay.childElementCount > 0 && overlay.style.display === 'block')
    if (!measurementOverlay) throw new Error(`Expected ${tool} draft measurements`)
    const originalReplaceChildrenDescriptor = Object.getOwnPropertyDescriptor(
      measurementOverlay,
      'replaceChildren',
    )
    const originalReplaceChildren = measurementOverlay.replaceChildren.bind(measurementOverlay)
    let cleanupFailures = 2
    Object.defineProperty(measurementOverlay, 'replaceChildren', {
      configurable: true,
      value: (...nodes: (Node | string)[]) => {
        if (cleanupFailures > 0) {
          cleanupFailures -= 1
          throw new Error(`${tool} cleanup failed`)
        }
        originalReplaceChildren(...nodes)
      },
    })

    try {
      const errors = captureWindowErrors(() => {
        events.pointerUp({ x: 40, y: 60 }, { pointerId: 91 })
      })

      expect(errors).toHaveLength(1)
      expect(cleanupFailures).toBe(0)
      expect(coordinator.canUndo.value).toBe(false)
      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(1)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(1)
      }

      const retryEvent = events.pointerDown({ x: 10, y: 20 }, { pointerId: 92 })

      expect(retryEvent.defaultPrevented).toBe(true)
      expect(coordinator.canUndo.value).toBe(true)
      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(1)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(1)
      }

      events.pointerDown({ x: 50, y: 70 }, { pointerId: 93 })
      events.pointerMove({ x: 80, y: 100 }, { pointerId: 93 })
      events.pointerUp({ x: 80, y: 100 }, { pointerId: 93 })

      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(2)
        expect(coordinator.undo()).toBe(true)
        expect(store.persisted.zones).toHaveLength(1)
        expect(coordinator.undo()).toBe(true)
        expect(store.persisted.zones).toHaveLength(0)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(2)
        expect(coordinator.undo()).toBe(true)
        expect(store.persisted.measurementGuides).toHaveLength(1)
        expect(coordinator.undo()).toBe(true)
        expect(store.persisted.measurementGuides).toHaveLength(0)
      }
      expect(coordinator.undo()).toBe(false)
    } finally {
      if (originalReplaceChildrenDescriptor) {
        Object.defineProperty(
          measurementOverlay,
          'replaceChildren',
          originalReplaceChildrenDescriptor,
        )
      } else {
        Reflect.deleteProperty(measurementOverlay, 'replaceChildren')
      }
      session.dispose()
    }
  })

  it.each([
    { label: 'Rectangle', tool: 'rectangle' },
    { label: 'Measurement Guide', tool: 'measurement-guide' },
  ])('keeps the $label handle through retained post-commit backfill publication', ({ tool }) => {
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('plant-1', 'Malus domestica', { x: 150, y: 150 }, {
        stratum: null,
        canopySpreadM: null,
      })]
    })
    const history = new SceneHistory()
    let invalidationCalls = 0
    const baseDeps = createInteractionDeps(container, store, camera)
    const coordinator = new SceneRuntimeEditCoordinator({
      sceneStore: store,
      history,
      setSelection: baseDeps.setSelection,
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {
        invalidationCalls += 1
        if (invalidationCalls === 2 || invalidationCalls === 3) {
          throw new Error(`${tool} late backfill publication failed`)
        }
      },
    })
    const session = createTestSession({
      ...baseDeps,
      sceneEdits: coordinator,
      commandAdmission: coordinator,
    })
    session.setTool(tool)

    events.pointerDown({ x: 10, y: 20 }, { pointerId: 94 })
    events.pointerMove({ x: 40, y: 60 }, { pointerId: 94 })
    const measurementOverlay = Array.from(
      container.querySelectorAll<HTMLElement>('[data-zone-measurement-overlay]'),
    ).find((overlay) => overlay.childElementCount > 0 && overlay.style.display === 'block')
    if (!measurementOverlay) throw new Error(`Expected ${tool} draft measurements`)
    const originalReplaceChildrenDescriptor = Object.getOwnPropertyDescriptor(
      measurementOverlay,
      'replaceChildren',
    )
    const originalReplaceChildren = measurementOverlay.replaceChildren.bind(measurementOverlay)
    let enqueueBackfill = true
    Object.defineProperty(measurementOverlay, 'replaceChildren', {
      configurable: true,
      value: (...nodes: (Node | string)[]) => {
        if (enqueueBackfill) {
          enqueueBackfill = false
          const ticket = coordinator.issueTicket()
          expect(coordinator.applyBackfills(ticket, [{
            plantId: 'plant-1',
            canonicalName: 'Malus domestica',
            stratum: 'canopy',
            canopySpreadM: 4,
          }])).toBe('deferred')
        }
        originalReplaceChildren(...nodes)
      },
    })

    try {
      const errors = captureWindowErrors(() => {
        events.pointerUp({ x: 40, y: 60 }, { pointerId: 94 })
      })

      expect(errors).toHaveLength(1)
      expect(store.persisted.plants[0]).toMatchObject({
        stratum: 'canopy',
        canopySpreadM: 4,
      })
      expect(coordinator.canUndo.value).toBe(false)
      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(1)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(1)
      }

      const retryEvent = events.pointerDown({ x: 10, y: 20 }, { pointerId: 95 })

      expect(retryEvent.defaultPrevented).toBe(true)
      expect(coordinator.canUndo.value).toBe(true)
      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(1)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(1)
      }

      events.pointerDown({ x: 50, y: 70 }, { pointerId: 96 })
      events.pointerMove({ x: 80, y: 100 }, { pointerId: 96 })
      events.pointerUp({ x: 80, y: 100 }, { pointerId: 96 })

      if (tool === 'rectangle') {
        expect(store.persisted.zones).toHaveLength(2)
      } else {
        expect(store.persisted.measurementGuides).toHaveLength(2)
      }
      expect(coordinator.undo()).toBe(true)
      expect(coordinator.undo()).toBe(true)
      expect(coordinator.undo()).toBe(false)
    } finally {
      if (originalReplaceChildrenDescriptor) {
        Object.defineProperty(
          measurementOverlay,
          'replaceChildren',
          originalReplaceChildrenDescriptor,
        )
      } else {
        Reflect.deleteProperty(measurementOverlay, 'replaceChildren')
      }
      session.dispose()
    }
  })

  it('does not create rectangle zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })
    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates a linear zone from the Line tool drag', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('10px')
    expect(preview?.style.top).toBe('20px')
    expect(preview?.style.width).toBe('50px')

    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'line',
      rotation: 0,
      locked: false,
      points: [
        storedGeo(store, { x: 10, y: 20 }),
        storedGeo(store, { x: 40, y: 60 }),
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-line')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it('does not create linear zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 40, y: 60 }, { button: 0 })
    events.pointerUp({ x: 40, y: 60 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('shows live linear zone length while drawing without persisting it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('line')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 20 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual(['60 m'])
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('previews and commits linear zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('line')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 35, y: 65 },
      ],
    })
    session.dispose()
  })

  it('does not commit too-short linear zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('line')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 10.2, y: 10.2 }, { button: 0 })
    events.pointerUp({ x: 10.2, y: 10.2 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates an elliptical zone from the ellipse tool drag', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.borderRadius).toBe('50%')

    events.pointerUp({ x: 70, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 40, y: 60 },
        { x: 30, y: 40 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'ellipse',
      rotation: 0,
      locked: false,
      // Files store the opposite corners of the unrotated bounding box.
      points: [
        storedGeo(store, { x: 10, y: 20 }),
        storedGeo(store, { x: 70, y: 100 }),
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-ellipse')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it('does not create elliptical zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })
    events.pointerUp({ x: 70, y: 100 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('normalizes elliptical zone drags in any direction', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 110, y: 90 }, { button: 0 })
    events.pointerMove({ x: 10, y: 10 }, { button: 0 })
    events.pointerUp({ x: 10, y: 10 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 60, y: 50 },
        { x: 50, y: 40 },
      ],
    })
    session.dispose()
  })

  it('previews and commits elliptical zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')
    expect(preview?.style.borderRadius).toBe('50%')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      rotationDeg: 0,
      points: [
        { x: 22.5, y: 42.5 },
        { x: 12.5, y: 22.5 },
      ],
    })
    session.dispose()
  })

  it('shows live elliptical zone measurements while drawing without persisting them', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      'W 60 m',
      'H 80 m',
      '3770 m²',
    ])
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('does not commit too-small elliptical zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('ellipse')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 10.2, y: 10.4 }, { button: 0 })
    events.pointerUp({ x: 10.2, y: 10.4 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates a polygonal zone from clicked vertices and an Enter close action', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,10')

    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(store.toCanopiFile().zones[0]).toMatchObject({
      zone_type: 'polygon',
      rotation: 0,
      locked: false,
      points: [
        storedGeo(store, { x: 10, y: 10 }),
        storedGeo(store, { x: 60, y: 10 }),
        storedGeo(store, { x: 60, y: 50 }),
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    expect(deps.setSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it('does not create polygonal zones on a locked Zones Layer', () => {
    store.updatePersisted((draft) => {
      draft.layers = draft.layers.map((layer) => (
        layer.name === 'zones' ? { ...layer, locked: true } : layer
      ))
    })
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 40 }, { button: 0 })
    events.keyDown({ key: 'Enter', cancelable: true })

    expect(store.persisted.zones).toHaveLength(0)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('previews polygonal zone active edges from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('40,80 140,260')
    session.dispose()
  })

  it('shows a live polygonal zone active-edge measurement while drawing', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])
    session.dispose()
  })

  it('clears existing selection when starting a polygonal zone draft', () => {
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
        position: { x: 80, y: 80 },
        rotationDeg: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }]
    })
    const deps = createInteractionDeps(container, store, camera)
    deps.setSelection([plantTarget('plant-1')])
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })

    expect(selectedObjectIds.value.size).toBe(0)
    expect(deps.clearSelection).toHaveBeenCalledTimes(1)
    session.dispose()
  })

  it('shows polygonal zone draft edge measurements, closing edge, and live area', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '50 m',
      '40 m',
      '64 m',
      '1000 m²',
    ])
    session.dispose()
  })

  it('closes a polygonal zone by clicking the first vertex', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerDown({ x: 12, y: 11 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    session.dispose()
  })

  it('cancels polygonal zone drafts with Escape without dirtying the scene', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Escape' })

    expect(store.persisted.zones).toHaveLength(0)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('removes the last polygonal zone draft vertex with Backspace', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })
    events.keyDown({ key: 'Backspace' })

    const line = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(line?.getAttribute('points')).toBe('10,10 60,50')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('keeps a Backspace the polygon draft consumed from reaching the app shortcuts', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    // App shortcuts (Delete/Backspace deletes the selection) listen in the bubble
    // phase and stand down for a defaultPrevented key; the event still reaches them.
    const appShortcuts = vi.fn((event: KeyboardEvent) => event.defaultPrevented)
    window.addEventListener('keydown', appShortcuts)
    try {
      const event = events.keyDown({ key: 'Backspace', target: container })
      expect(event.defaultPrevented).toBe(true)
      expect(appShortcuts).toHaveLastReturnedWith(true)
      const passthrough = events.keyDown({ key: 'a', target: container })
      expect(passthrough.defaultPrevented).toBe(false)
      expect(appShortcuts).toHaveLastReturnedWith(false)
      expect(appShortcuts).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener('keydown', appShortcuts)
    }
    session.dispose()
  })

  it('keeps a polygon draft at its lon/lat when the session plane re-origins mid-draw', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')
    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    const previous = store.sessionPlane
    // The viewport is 1 px per metre at the origin, so screen (10, 10) is plane (10, 10).
    const firstVertexGeo = previous.toGeo({ x: 10, y: 10 })
    const secondVertexGeo = previous.toGeo({ x: 60, y: 10 })

    // Panning 20 km east re-origins the plane; the camera follows it.
    const transform = (deps.sceneEdits as SceneRuntimeEditCoordinator)
      .reoriginSessionPlane(previous.toGeo({ x: 20_000, y: 0 }))!
    expect(transform).not.toBeNull()
    camera.reprojectViewport(transform)
    expect(store.sessionPlane).not.toBe(previous)

    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.keyDown({ key: 'Enter' })

    const zone = store.persisted.zones[0]!
    const plane = store.sessionPlane
    const near = (geo: { lon: number; lat: number }) => ({ lon: expect.closeTo(geo.lon, 8), lat: expect.closeTo(geo.lat, 8) })
    expect(plane.toGeo(zone.points[0]!)).toEqual(near(firstVertexGeo))
    expect(plane.toGeo(zone.points[1]!)).toEqual(near(secondVertexGeo))
    expect(plane.toGeo(zone.points[2]!)).toEqual(near(plane.toGeo(camera.screenToWorld({ x: 60, y: 50 }))))
    session.dispose()
  })

  it('undoes and redoes polygonal zone draft vertices without dirtying the scene', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 50 }, { button: 0 })

    expect(session.canUndoTransientHistory()).toBe(true)
    expect(session.undoTransientHistory()).toBe(true)

    const afterUndo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterUndo?.getAttribute('points')).toBe('10,10 60,50')
    expect(session.canRedoTransientHistory()).toBe(true)

    expect(session.redoTransientHistory()).toBe(true)

    const afterRedo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterRedo?.getAttribute('points')).toBe('10,10 60,10 60,50')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('undoes the only polygonal zone draft vertex and can redo it', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })

    expect(session.undoTransientHistory()).toBe(true)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(session.canUndoTransientHistory()).toBe(false)
    expect(session.canRedoTransientHistory()).toBe(true)

    expect(session.redoTransientHistory()).toBe(true)

    const afterRedo = container.querySelector<SVGPolylineElement>('[data-polygon-draft-line]')
    expect(afterRedo?.getAttribute('points')).toBe('10,10 10,10')
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('cancels redo-only polygonal zone draft history with Escape', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    expect(session.undoTransientHistory()).toBe(true)
    expect(session.canRedoTransientHistory()).toBe(true)

    events.keyDown({ key: 'Escape' })

    expect(session.canRedoTransientHistory()).toBe(false)
    expect(session.redoTransientHistory()).toBe(false)
    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('clears polygonal zone draft redo when a new vertex branches the draft', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    expect(session.undoTransientHistory()).toBe(true)
    expect(session.canRedoTransientHistory()).toBe(true)

    events.pointerDown({ x: 60, y: 50 }, { button: 0 })

    expect(session.canRedoTransientHistory()).toBe(false)
    expect(session.redoTransientHistory()).toBe(false)
    session.dispose()
  })

  it('commits only visible polygonal zone draft vertices after undo', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 50 }, { button: 0 })
    events.pointerDown({ x: 10, y: 50 }, { button: 0 })
    expect(session.undoTransientHistory()).toBe(true)
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    })
    expect(session.canRedoTransientHistory()).toBe(false)
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-polygon')
    session.dispose()
  })

  it('clears polygonal zone draft redo on cancellation and tool switch', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    expect(session.undoTransientHistory()).toBe(true)
    expect(session.canRedoTransientHistory()).toBe(true)
    events.keyDown({ key: 'Escape' })
    expect(session.canRedoTransientHistory()).toBe(false)

    events.pointerDown({ x: 20, y: 20 }, { button: 0 })
    events.pointerDown({ x: 80, y: 20 }, { button: 0 })
    expect(session.undoTransientHistory()).toBe(true)
    expect(session.canRedoTransientHistory()).toBe(true)
    session.setTool('select')

    expect(session.canUndoTransientHistory()).toBe(false)
    expect(session.canRedoTransientHistory()).toBe(false)
    session.dispose()
  })

  it('preserves polygonal zone drafts while space-panning the canvas', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()

    events.keyDown({ code: 'Space' })
    events.pointerDown({ x: 200, y: 150 }, { button: 0 })
    events.pointerMove({ x: 220, y: 150 }, { button: 0 })
    events.pointerUp({ x: 220, y: 150 }, { button: 0 })
    events.keyUp({ code: 'Space' })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it.each(['pointercancel', 'blur'] as const)(
    'preserves a polygon draft while %s cancels Space panning',
    (cancellation) => {
      const onSceneEditCommit = vi.fn()
      const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
      const session = createTestSession(deps)
      session.setTool('polygon')

      events.pointerDown({ x: 10, y: 10 }, { pointerId: 1 })
      events.pointerMove({ x: 60, y: 10 }, { pointerId: 1 })
      events.holdSpace()
      events.pointerDown({ x: 200, y: 150 }, { pointerId: 2 })
      events.pointerMove({ x: 220, y: 150 }, { pointerId: 2 })
      if (cancellation === 'pointercancel') {
        events.pointerCancel({ x: 220, y: 150 }, { pointerId: 2 })
      } else {
        events.windowBlur()
      }

      expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
      expect(store.persisted.zones).toHaveLength(0)
      expect(onSceneEditCommit).not.toHaveBeenCalled()

      events.pointerMove({ x: 60, y: 10 }, { pointerId: 3 })
      events.pointerDown({ x: 60, y: 10 }, { pointerId: 3 })
      expect(session.undoTransientHistory()).toBe(true)
      expect(session.canUndoTransientHistory()).toBe(true)
      session.dispose()
    },
  )

  it('preserves polygonal zone drafts while middle-button panning the canvas', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 200, y: 150 }, { button: 1 })
    events.pointerMove({ x: 220, y: 150 }, { button: 1 })
    events.pointerUp({ x: 220, y: 150 }, { button: 1 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('removes polygonal zone draft and measurement overlays on session dispose', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerMove({ x: 60, y: 10 }, { button: 0 })

    expect(container.querySelector('[data-polygon-draft-line]')).not.toBeNull()
    expect(zoneMeasurementTexts(container)).toEqual(['50 m'])

    session.dispose()

    expect(container.querySelector('[data-polygon-draft-line]')).toBeNull()
    expect(zoneMeasurementTexts(container)).toEqual([])
  })

  it('does not commit degenerate polygonal zones', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 }, { button: 0 })
    events.pointerDown({ x: 60, y: 10 }, { button: 0 })
    events.pointerDown({ x: 100, y: 10 }, { button: 0 })
    events.keyDown({ key: 'Enter' })

    expect(store.persisted.zones).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('previews and commits rectangle zones from snap-adjusted grid points', () => {
    // At scale=4, gridInterval() returns 5m.
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGridEnabled.value = true

    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 43, y: 87 }, { button: 0 })
    events.pointerMove({ x: 148, y: 254 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('40px')
    expect(preview?.style.top).toBe('80px')
    expect(preview?.style.width).toBe('100px')
    expect(preview?.style.height).toBe('180px')

    events.pointerUp({ x: 148, y: 254 }, { button: 0 })

    expect(store.persisted.zones).toHaveLength(1)
    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 10, y: 20 },
        { x: 35, y: 20 },
        { x: 35, y: 65 },
        { x: 10, y: 65 },
      ],
    })
    expect(onSceneEditCommit).toHaveBeenCalledWith('interaction-rectangle')
    session.dispose()
  })

  it('previews and commits rectangle zones from snap-adjusted guide points', () => {
    camera.setViewport({ x: 0, y: 0, scale: 4 })
    snapToGuidesEnabled.value = true
    store.updatePersisted((draft) => {
      draft.guides = [
        { id: 'guide-v-start', axis: 'v', position: 12 },
        { id: 'guide-h-start', axis: 'h', position: 22 },
        { id: 'guide-v-end', axis: 'v', position: 36 },
        { id: 'guide-h-end', axis: 'h', position: 61 },
      ]
    })

    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 49, y: 85 }, { button: 0 })
    events.pointerMove({ x: 142, y: 243 }, { button: 0 })

    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined
    expect(preview?.style.left).toBe('48px')
    expect(preview?.style.top).toBe('88px')
    expect(preview?.style.width).toBe('96px')
    expect(preview?.style.height).toBe('156px')

    events.pointerUp({ x: 142, y: 243 }, { button: 0 })

    expect(store.persisted.zones[0]).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [
        { x: 12, y: 22 },
        { x: 36, y: 22 },
        { x: 36, y: 61 },
        { x: 12, y: 61 },
      ],
    })
    session.dispose()
  })

  it('shows live rectangle zone measurements while drawing without persisting them', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, camera, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')

    events.pointerDown({ x: 10, y: 20 }, { button: 0 })
    events.pointerMove({ x: 70, y: 100 }, { button: 0 })

    expect(zoneMeasurementTexts(container)).toEqual([
      '60 m',
      '80 m',
      '60 m',
      '80 m',
      '4800 m²',
    ])
    expect(store.persisted.annotations).toHaveLength(0)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })

  it('creates tool objects when native randomUUID is unavailable', () => {
    withoutNativeRandomUUID(() => {
      let rectangleSession: SceneInteractionSession | null = null
      let plantSession: SceneInteractionSession | null = null

      try {
        rectangleSession = createTestSession(createInteractionDeps(container, store, camera))
        rectangleSession.setTool('rectangle')

        events.pointerDown({ x: 10, y: 20 }, { button: 0 })
        events.pointerMove({ x: 40, y: 60 }, { button: 0 })
        events.pointerUp({ x: 40, y: 60 }, { button: 0 })

        expect(store.persisted.zones).toHaveLength(1)
        rectangleSession.dispose()
        rectangleSession = null

        selectPlantStampSource({
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          stratum: 'high',
          width_max_m: 4,
        })
        plantSession = createTestSession(createInteractionDeps(container, store, camera))
        plantSession.setTool('plant-stamp')

        events.pointerDown({ x: 50, y: 70 }, { button: 0 })

        expect(store.persisted.plants).toHaveLength(1)
      } finally {
        rectangleSession?.dispose()
        plantSession?.dispose()
      }
    })
  })

  it('keeps a polygon edge on 45° angles while Shift is held', () => {
    const session = createTestSession(createInteractionDeps(container, store, camera))
    session.setTool('polygon')

    events.pointerDown({ x: 10, y: 10 })
    events.pointerDown({ x: 60, y: 14 }, { shiftKey: true })
    events.pointerDown({ x: 60, y: 50 })
    events.keyDown({ key: 'Enter' })

    const [first, second, third] = store.persisted.zones[0]!.points
    expect(first).toEqual({ x: 10, y: 10 })
    expect(second!.y).toBeCloseTo(10)
    expect(second!.x).toBeCloseTo(Math.hypot(50, 4) + 10)
    expect(third).toEqual({ x: 60, y: 50 })
    session.dispose()
  })
})
