import { describe, expect, it, vi } from 'vitest'

import { CameraController } from '../canvas/runtime/camera'
import { createMeasurementGuideControlPoints } from '../canvas/runtime/interaction/measurement-guide-control-points'
import { createZoneControlPoints } from '../canvas/runtime/interaction/zone-control-points'
import type { CanvasDesignObjectSelectionModel } from '../canvas/runtime/runtime'
import { SceneHistory } from '../canvas/runtime/scene-history'
import { SceneStore, type SceneDesignObjectTarget, type ScenePoint } from '../canvas/runtime/scene'
import {
  SceneRuntimeEditCoordinator,
  type SceneEditCoordinator,
} from '../canvas/runtime/scene-runtime/transactions'
import type { SceneToolPointerDrag } from '../canvas/runtime/interaction/tool-adapter'

interface TestControlPointController {
  readonly dragActive: boolean
  refresh(enabled: boolean): void
  pointerDown(context: { readonly event: PointerEvent; readonly rawWorld: ScenePoint }): SceneToolPointerDrag | null
  cancelActiveDrag(): boolean
  dispose(): void
}

interface ControlPointHarness {
  readonly container: HTMLDivElement
  readonly controller: TestControlPointController
  readonly handle: HTMLElement
  readonly history: SceneHistory
  readonly pointerEvent: PointerEvent
  readonly start: ScenePoint
  readonly draggedPoint: () => ScenePoint
}

const cases = [
  { label: 'Zone', kind: 'zone' },
  { label: 'Measurement Guide', kind: 'measurement-guide' },
] as const

describe.each(cases)('$label Control Point adapter shared lifecycle', ({ kind }) => {
  it('rolls back Scene Edit admission when drag presentation setup fails', () => {
    const beginDragPresentation = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('presentation setup failed')
      })
    const harness = createHarness(kind, beginDragPresentation)

    try {
      expect(() => harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })).toThrow('presentation setup failed')

      expect(harness.controller.dragActive).toBe(false)

      const retry = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      expect(retry).not.toBeNull()
      expect(harness.controller.cancelActiveDrag()).toBe(true)
    } finally {
      harness.controller.dispose()
      harness.container.remove()
    }
  })

  it('treats movement inside the screen-space threshold as a no-op', () => {
    const harness = createHarness(kind, () => {})

    try {
      const drag = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      expect(drag).not.toBeNull()

      const belowThreshold = {
        event: harness.pointerEvent,
        screen: { x: harness.start.x + 1, y: harness.start.y },
        rawWorld: { x: 120, y: 90 },
      }
      drag?.update(belowThreshold)
      drag?.commit(belowThreshold)

      expect(harness.draggedPoint()).toEqual(harness.start)
      expect(harness.history.canUndo.value).toBe(false)
      expect(harness.controller.dragActive).toBe(false)
    } finally {
      harness.controller.dispose()
      harness.container.remove()
    }
  })

  it('applies the final pointer position and commits one changed edit', () => {
    const harness = createHarness(kind, () => {})

    try {
      const drag = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      expect(drag).not.toBeNull()

      const finalPoint = { x: 90, y: 70 }
      drag?.commit({
        event: harness.pointerEvent,
        screen: finalPoint,
        rawWorld: finalPoint,
      })

      expect(harness.draggedPoint()).toEqual(finalPoint)
      expect(harness.history.canUndo.value).toBe(true)
      expect(harness.controller.dragActive).toBe(false)
    } finally {
      harness.controller.dispose()
      harness.container.remove()
    }
  })

  it('cancels a live preview without committing history', () => {
    const harness = createHarness(kind, () => {})

    try {
      const drag = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      const moved = { x: 90, y: 70 }
      drag?.update({
        event: harness.pointerEvent,
        screen: moved,
        rawWorld: moved,
      })
      expect(harness.draggedPoint()).toEqual(moved)

      expect(harness.controller.cancelActiveDrag()).toBe(true)

      expect(harness.draggedPoint()).toEqual(harness.start)
      expect(harness.history.canUndo.value).toBe(false)
      expect(harness.controller.dragActive).toBe(false)
    } finally {
      harness.controller.dispose()
      harness.container.remove()
    }
  })

  it('retains a failed abort for cancellation retry', () => {
    let beginCalls = 0
    let abortCalls = 0
    const harness = createHarness(kind, () => {}, (base) => ({
      run: (type, edit, options) => base.run(type, edit, options),
      begin(type, options) {
        beginCalls += 1
        const transaction = base.begin(type, options)
        return {
          mutate: (edit) => transaction.mutate(edit),
          setSelection: (targets) => transaction.setSelection(targets),
          commit: (commitOptions) => transaction.commit(commitOptions),
          get changed() {
            return transaction.changed
          },
          abort() {
            abortCalls += 1
            if (abortCalls === 1) throw new Error('abort failed')
            transaction.abort()
          },
        }
      },
    }))

    try {
      const drag = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      const moved = { x: 90, y: 70 }
      drag?.update({
        event: harness.pointerEvent,
        screen: moved,
        rawWorld: moved,
      })

      expect(() => harness.controller.cancelActiveDrag()).toThrow('abort failed')
      expect(harness.controller.dragActive).toBe(true)
      expect(harness.draggedPoint()).toEqual(moved)

      expect(harness.controller.cancelActiveDrag()).toBe(true)
      expect(harness.controller.dragActive).toBe(false)
      expect(harness.draggedPoint()).toEqual(harness.start)
      expect(beginCalls).toBe(1)
      expect(abortCalls).toBe(2)
    } finally {
      harness.controller.dispose()
      harness.container.remove()
    }
  })

  it('aborts a live preview and removes every owned root on disposal', () => {
    const harness = createHarness(kind, () => {})

    try {
      const drag = harness.controller.pointerDown({
        event: harness.pointerEvent,
        rawWorld: harness.start,
      })
      const moved = { x: 90, y: 70 }
      drag?.update({
        event: harness.pointerEvent,
        screen: moved,
        rawWorld: moved,
      })
      expect(harness.draggedPoint()).toEqual(moved)

      harness.controller.dispose()
      harness.controller.dispose()

      expect(harness.draggedPoint()).toEqual(harness.start)
      expect(harness.container.querySelector('[data-zone-control-points]')).toBeNull()
      expect(harness.container.querySelector('[data-measurement-guide-control-points]')).toBeNull()
      expect(harness.container.querySelector('[data-zone-measurement-overlay]')).toBeNull()
    } finally {
      harness.container.remove()
    }
  })
})

function createHarness(
  kind: (typeof cases)[number]['kind'],
  beginDragPresentation: () => void,
  wrapSceneEdits: (base: SceneEditCoordinator) => SceneEditCoordinator = (base) => base,
): ControlPointHarness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const camera = new CameraController()
  camera.initialize({ width: 400, height: 300 })
  camera.setViewport({ x: 0, y: 0, scale: 1 })
  const store = new SceneStore()
  const target: SceneDesignObjectTarget = kind === 'zone'
    ? { kind: 'zone', id: 'zone-1' }
    : { kind: 'measurement-guide', id: 'guide-1' }

  store.updatePersisted((draft) => {
    if (kind === 'zone') {
      draft.zones = [{
        kind: 'zone',
        name: target.id,
        locked: false,
        zoneType: 'rect',
        rotationDeg: 0,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 50 },
          { x: 10, y: 50 },
        ],
        fillColor: null,
        notes: null,
      }]
    } else {
      draft.measurementGuides = [{
        kind: 'measurement-guide',
        id: target.id,
        locked: false,
        start: { x: 10, y: 10 },
        end: { x: 60, y: 10 },
      }]
    }
  })
  store.setSelection([target])

  const selection: CanvasDesignObjectSelectionModel = {
    editableTargets: [target],
    lockedTargets: [],
    blockedTargets: [],
    bounds: null,
    sameSpeciesReferenceCanonicalName: null,
  }
  const history = new SceneHistory()
  const baseSceneEdits: SceneEditCoordinator = new SceneRuntimeEditCoordinator({
    sceneStore: store,
    history,
    setSelection: (targets) => store.setSelection(targets),
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidate: () => {},
  })
  const sceneEdits = wrapSceneEdits(baseSceneEdits)
  const sharedOptions = {
    container,
    camera,
    getSceneStore: () => store,
    getSelection: () => selection,
    sceneEdits,
    applySnapping: (point: ScenePoint) => point,
    render: () => {},
    refreshSelectionDependent: () => {},
    beginDragPresentation,
    endDragPresentation: () => {},
  }
  const controller = kind === 'zone'
    ? createZoneControlPoints(sharedOptions)
    : createMeasurementGuideControlPoints(sharedOptions)
  controller.refresh(true)
  const selector = kind === 'zone'
    ? '[data-zone-control-point-kind="rect-corner"][data-zone-control-point-index="2"]'
    : '[data-measurement-guide-control-point-index="1"]'
  const handle = container.querySelector<HTMLElement>(selector)
  if (!handle) throw new Error(`Expected ${kind} Control Point handle`)
  const start = kind === 'zone' ? { x: 60, y: 50 } : { x: 60, y: 10 }
  const pointerEvent = {
    button: 0,
    target: handle,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as PointerEvent

  const draggedPoint = (): ScenePoint => kind === 'zone'
    ? store.persisted.zones[0]!.points[2]!
    : store.persisted.measurementGuides[0]!.end

  return { container, controller, handle, history, pointerEvent, start, draggedPoint }
}
