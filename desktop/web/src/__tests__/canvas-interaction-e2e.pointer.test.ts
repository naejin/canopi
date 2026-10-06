// The canvas interaction end to end through the session (canvas v2 plan §4): the native context menu and the overview's
// primary drag, the pointer cases phase 2's right button and overview binding change.
// Shared fakes, helpers and fixture: support/canvas-interaction-setup.ts.
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { currentCanvasSelection } from '../canvas/session-state'
import type { SceneStore } from '../canvas/runtime/scene'
import type { SceneInteractionEventHarness } from './support/canvas-interaction-events'
import {
  contextMenuHost,
  createInteractionDeps,
  plantTarget,
  captureWindowErrors,
  makePlant,
  makeRectZone,
  rotationHandle,
  installSceneInteractionFixture,
  enterOverview,
} from './support/canvas-interaction-setup'
import type { TestView } from './support/test-view'
import './support/camera-tolerance'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let testView: TestView
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, testView, store, events } = f)
    },
    () => ({ events }),
  )

  it('suppresses native context menus only on canvas interaction surfaces', () => {
    // The rotation handle sits above the drawn shapes (select/selection-hull.ts), so the selected zone must exist.
    store.updatePersisted((draft) => {
      draft.zones = [makeRectZone('zone-1', [{ x: 160, y: 100 }, { x: 220, y: 150 }])]
    })
    const deps = {
      ...createInteractionDeps(container, store, testView),
      getDesignObjectSelection: () => ({
        editableTargets: [{ kind: 'zone' as const, id: 'zone-1' }],
        lockedTargets: [],
        blockedTargets: [],
        bounds: { minX: 160, minY: 100, maxX: 220, maxY: 150 },
        sameSpeciesReferenceCanonicalName: null,
        plantNamePinning: { plantIds: [], allPinned: false },
      }),
    }
    const session = createTestSession(deps)
    session.refreshMeasurements()

    const canvasContext = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.dispatchEvent(canvasContext)
    expect(canvasContext.defaultPrevented).toBe(true)

    const handle = rotationHandle(container)!
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
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
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
    expect(currentCanvasSelection.value).toEqual(new Set(['plant-1']))
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

  it('quarantines a press when admission recovery throws, but lets a context menu or a drop reach the app', () => {
    const admissionFailure = new Error('admission recovery failed')
    const deps = createInteractionDeps(container, store, testView, {
      commandAdmission: {
        revision: signal(0),
        runWhenSettled: () => {
          throw admissionFailure
        },
      },
    })
    createTestSession(deps)
    const downstreamPointerDown = vi.fn()
    const downstreamContextMenu = vi.fn()
    const downstreamDrop = vi.fn()
    container.addEventListener('pointerdown', downstreamPointerDown)
    container.addEventListener('contextmenu', downstreamContextMenu)
    container.addEventListener('drop', downstreamDrop)
    let pointerDown!: PointerEvent
    let contextMenu!: MouseEvent
    let drop!: DragEvent

    const errors = captureWindowErrors(() => {
      pointerDown = events.pointerDown({ x: 20, y: 30 })
      const point = events.clientPoint({ x: 20, y: 30 })
      contextMenu = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      })
      container.dispatchEvent(contextMenu)
      drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(drop, {
        clientX: { configurable: true, value: point.x },
        clientY: { configurable: true, value: point.y },
        dataTransfer: { configurable: true, value: null },
      })
      container.dispatchEvent(drop)
    })

    // Only a press on the map host is quarantined; a context menu and a drop rethrow and reach the app.
    expect(errors).toEqual([admissionFailure, admissionFailure, admissionFailure])
    expect(pointerDown.defaultPrevented).toBe(true)
    expect(downstreamPointerDown).not.toHaveBeenCalled()
    expect(downstreamContextMenu).toHaveBeenCalled()
    expect(downstreamDrop).toHaveBeenCalled()
  })

  it('uses primary drag for navigation in overview regardless of the armed tool', () => {
    const onSceneEditCommit = vi.fn()
    const deps = createInteractionDeps(container, store, testView, { onSceneEditCommit })
    const session = createTestSession(deps)
    session.setTool('rectangle')
    enterOverview(testView)
    const scene = structuredClone(store.persisted)
    const before = testView.viewport()

    events.pointerDown({ x: 100, y: 100 }, { button: 0 })
    events.pointerMove({ x: 140, y: 125 }, { button: 0 })
    events.pointerUp({ x: 140, y: 125 }, { button: 0 })

    const after = testView.viewport()
    expect(after.x).toBeCloseTo(before.x + 40, 6)
    expect(after.y).toBeCloseTo(before.y + 25, 6)
    expect(after.scale).toBeCloseTo(before.scale, 9)
    expect(store.persisted).toEqual(scene)
    expect(onSceneEditCommit).not.toHaveBeenCalled()
    session.dispose()
  })
})
