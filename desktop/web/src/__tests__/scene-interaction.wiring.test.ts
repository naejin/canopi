// SceneInteractionSession tests, split by the first tool a test arms (canvas v2 plan §4, Seams):
// tests that arm Pan, or arm no tool and assert listener installation or removal,
// and the tool guidance describe.
// Shared fakes, helpers and fixture: support/scene-interaction-setup.ts.
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { writePlantStampDragData } from '../canvas/plant-stamp-source'
import { writeSavedObjectStampDragData } from '../canvas/saved-object-stamp-source'
import { selectedObjectIds, type CanvasToolGuidance } from '../canvas/session-state'
import { CameraController } from '../canvas/runtime/camera'
import { SceneStore } from '../canvas/runtime/scene'
import {
  createSceneInteractionSession,
  type SceneInteractionSession,
  type SceneInteractionSessionDeps,
} from '../canvas/runtime/interaction-session'
import type { SettledSceneReader } from '../canvas/runtime/scene-runtime/transactions'
import {
  createSceneInteractionEventHarness,
  type SceneInteractionEventHarness,
} from './support/scene-interaction-events'
import {
  createInteractionDeps,
  captureWindowErrors,
  makePlant,
  installSceneInteractionFixture,
} from './support/scene-interaction-setup'

describe('SceneInteractionSession', () => {
  let container: HTMLDivElement
  let camera: CameraController
  let store: SceneStore
  let events: SceneInteractionEventHarness

  const { createTestSession } = installSceneInteractionFixture(
    (f) => {
      ({ container, camera, store, events } = f)
    },
    () => ({ events }),
  )

  it('does not run Species Selection outside the Select tool', () => {
    store.updatePersisted((draft) => {
      draft.plants = [
        makePlant('apple-1', 'Malus domestica', { x: 20, y: 30 }),
        makePlant('apple-2', 'Malus domestica', { x: 80, y: 30 }),
      ]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    session.setTool('hand')

    events.pointerDown({ x: 20, y: 30 }, { button: 0, detail: 2 })
    events.pointerUp({ x: 20, y: 30 }, { button: 0, detail: 2 })

    expect(selectedObjectIds.value).toEqual(new Set())
    expect(deps.setSelection).not.toHaveBeenCalled()
    session.dispose()
  })

  it('quarantines Scene events when admission recovery throws', () => {
    const admissionFailure = new Error('admission recovery failed')
    const deps = createInteractionDeps(container, store, camera, {
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

    expect(errors).toEqual([admissionFailure, admissionFailure, admissionFailure])
    expect(pointerDown.defaultPrevented).toBe(true)
    expect(contextMenu.defaultPrevented).toBe(true)
    expect(drop.defaultPrevented).toBe(true)
    expect(downstreamPointerDown).not.toHaveBeenCalled()
    expect(downstreamContextMenu).not.toHaveBeenCalled()
    expect(downstreamDrop).not.toHaveBeenCalled()
  })

  it('clears and quarantines accepted dragover feedback when the settled read fails', () => {
    const settledReadFailure = new Error('dragover settled read failed')
    let failRead = false
    const settledReader: SettledSceneReader = {
      revision: signal(0),
      readWhenSettled<T>(operation: () => T): T {
        if (failRead) throw settledReadFailure
        return operation()
      },
    }
    const deps = createInteractionDeps(container, store, camera, { settledReader })
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
    const dragOverEvent = () => {
      const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperties(event, {
        clientX: { configurable: true, value: 80 },
        clientY: { configurable: true, value: 90 },
        dataTransfer: { configurable: true, value: dataTransfer },
      })
      return event
    }
    const preview = Array.from(container.children)
      .find((child) => (child as HTMLElement).style.zIndex === '2') as HTMLElement | undefined

    container.dispatchEvent(dragOverEvent())
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(preview?.style.display).toBe('block')

    failRead = true
    const downstreamDragOver = vi.fn()
    container.addEventListener('dragover', downstreamDragOver)
    const rejectedDragOver = dragOverEvent()
    const errors = captureWindowErrors(() => {
      container.dispatchEvent(rejectedDragOver)
    })

    expect(errors).toEqual([settledReadFailure])
    expect(rejectedDragOver.defaultPrevented).toBe(true)
    expect(downstreamDragOver).not.toHaveBeenCalled()
    expect(dataTransfer.dropEffect).toBe('none')
    expect(preview?.style.display).toBe('none')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()

    container.removeEventListener('dragover', downstreamDragOver)
    failRead = false
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
    container.dispatchEvent(dragOverEvent())
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).not.toBeNull()

    failRead = true
    const savedStampErrors = captureWindowErrors(() => {
      container.dispatchEvent(dragOverEvent())
    })
    expect(savedStampErrors).toEqual([settledReadFailure])
    expect(dataTransfer.dropEffect).toBe('none')
    expect(container.querySelector('[data-saved-object-stamp-ghost]')).toBeNull()
    session.dispose()
  })

  it('continues Session teardown after one owned resource fails', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container, { trackListeners: true })
    store.updatePersisted((draft) => {
      draft.plants = [makePlant('locked-plant', 'Malus domestica', { x: 300, y: 250 }, { locked: true })]
    })
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    // Hovering a directly locked plant brings the session's Unlock affordance onto the map.
    events.pointerMove({ x: 300, y: 250 })
    expect(container.querySelector('[data-locked-object-affordance]')).not.toBeNull()
    expect(container.hasAttribute('tabindex')).toBe(true)
    expect(container.querySelector('[data-canvas-handle-layer]')).not.toBeNull()
    // The bridge's drop preview (today's band element): the host, the chrome, the handle layer and the map host's keyboard
    // stop are torn down after it.
    const preview = [...container.children].find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.style.border.includes('--canvas-selection-stroke'))!
    const removePreview = vi.spyOn(preview, 'remove').mockImplementation(() => {
      throw new Error('drop preview removal failed')
    })

    expect(() => session.dispose()).toThrow('drop preview removal failed')

    expect(events.listenerLog?.containerRemoves('pointerdown')).toHaveLength(1)
    expect(events.listenerLog?.windowRemoves('pointermove')).toHaveLength(1)
    expect(container.querySelector('[data-locked-object-affordance]')).toBeNull()
    expect(container.querySelector('[data-canvas-handle-layer]')).toBeNull()
    expect(container.hasAttribute('tabindex')).toBe(false)
    expect(() => session.dispose()).not.toThrow()
    removePreview.mockRestore()
  })

  it('attempts every host-listener removal when one removal fails', () => {
    const deps = createInteractionDeps(container, store, camera)
    const session = createTestSession(deps)
    const originalRemoveEventListener = window.removeEventListener.bind(window)
    const removeWindowListener = vi.spyOn(window, 'removeEventListener').mockImplementation(
      ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        originalRemoveEventListener(type, listener, options)
        if (type === 'pointermove') throw new Error('pointermove removal failed')
      }) as typeof window.removeEventListener,
    )

    try {
      expect(() => session.dispose()).toThrow('pointermove removal failed')
      expect(removeWindowListener.mock.calls.filter(([type]) => type === 'blur')).toHaveLength(1)
    } finally {
      removeWindowListener.mockRestore()
    }
  })

  it('rolls back installed listeners and resources when Session construction fails', () => {
    events.dispose()
    events = createSceneInteractionEventHarness(container)
    const deps = createInteractionDeps(container, store, camera)
    const removeContainerListener = vi.spyOn(container, 'removeEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const originalAddEventListener = window.addEventListener.bind(window)
    const addWindowListener = vi.spyOn(window, 'addEventListener').mockImplementation(
      ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type === 'blur') throw new Error('listener installation failed')
        originalAddEventListener(type, listener, options)
      }) as typeof window.addEventListener,
    )

    try {
      expect(() => createSceneInteractionSession(deps)).toThrow('listener installation failed')
    } finally {
      addWindowListener.mockRestore()
    }

    expect(removeContainerListener.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1)
    expect(removeWindowListener.mock.calls.filter(([type]) => type === 'pointermove')).toHaveLength(1)
    expect(container.children).toHaveLength(0)
    removeContainerListener.mockRestore()
    removeWindowListener.mockRestore()
  })

  describe('tool guidance for the tool card', () => {
    function guidedSession(): { session: SceneInteractionSession, deps: SceneInteractionSessionDeps, latest: () => CanvasToolGuidance } {
      const published: CanvasToolGuidance[] = []
      const deps = createInteractionDeps(container, store, camera, {
        publishToolGuidance: (guidance) => { published.push(guidance) },
      })
      return { session: createTestSession(deps), deps, latest: () => published.at(-1)! }
    }

    it('reports a polygon draft as a gesture until it is cancelled', () => {
      const { session, latest } = guidedSession()
      session.setTool('polygon')
      expect(latest()).toEqual({ gesture: false, stamp: null, stampRotationDeg: null, promptSpecies: false, plantRow: null })

      events.pointerDown({ x: 10, y: 10 })
      events.pointerUp({ x: 10, y: 10 })
      expect(latest().gesture).toBe(true)

      events.keyDown({ key: 'Escape', target: container })
      expect(latest().gesture).toBe(false)
      session.dispose()
    })

    it('reports a zone drag as a gesture while the pointer is down', () => {
      const { session, latest } = guidedSession()
      session.setTool('rectangle')

      events.pointerDown({ x: 10, y: 10 })
      events.pointerMove({ x: 60, y: 40 })
      expect(latest().gesture).toBe(true)

      events.pointerUp({ x: 60, y: 40 })
      expect(latest().gesture).toBe(false)
      session.dispose()
    })

    it('reports an open text note field as a gesture until it closes', () => {
      const { session, latest } = guidedSession()
      session.setTool('text')

      events.pointerDown({ x: 24, y: 32 })
      expect(latest().gesture).toBe(true)

      container.querySelector('textarea')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(latest().gesture).toBe(false)
      session.dispose()
    })

    it('names a picked plant and counts a picked group for Place a stamp', () => {
      store.updatePersisted((draft) => {
        draft.plants = [
          makePlant('apple', 'Malus domestica', { x: 20, y: 30 }),
          makePlant('pear-1', 'Pyrus communis', { x: 200, y: 200 }),
          makePlant('pear-2', 'Pyrus communis', { x: 210, y: 200 }),
          makePlant('plum', 'Prunus domestica', { x: 220, y: 200 }),
        ]
        draft.groups = [{
          kind: 'group',
          id: 'guild',
          locked: false,
          name: 'Pear guild',
          members: [
            { kind: 'plant', id: 'pear-1' },
            { kind: 'plant', id: 'pear-2' },
            { kind: 'plant', id: 'plum' },
          ],
        }]
      })
      const { session, latest } = guidedSession()
      session.setTool('object-stamp')
      expect(latest().stamp).toBeNull()

      events.pointerDown({ x: 20, y: 30 })
      expect(latest().stamp).toEqual({ kind: 'plant', name: 'Malus domestica', plants: 1, species: 1 })

      session.setTool('select')
      session.setTool('object-stamp')
      events.pointerDown({ x: 200, y: 200 })
      expect(latest().stamp).toEqual({ kind: 'group', name: 'Pear guild', plants: 3, species: 2 })
      session.dispose()
    })

    it('goes idle when the session ends', () => {
      const { session, latest } = guidedSession()
      session.setTool('polygon')
      events.pointerDown({ x: 10, y: 10 })

      session.dispose()

      expect(latest()).toEqual({ gesture: false, stamp: null, stampRotationDeg: null, promptSpecies: false, plantRow: null })
    })
  })
})
