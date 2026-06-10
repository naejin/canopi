import { describe, expect, it, vi } from 'vitest'
import {
  createSceneInteractionFrame,
  type SceneInteractionFrameHandlers,
} from '../canvas/runtime/interaction/frame'
import { createSceneInteractionEventHarness } from './support/scene-interaction-frame'

function createHandlers(): SceneInteractionFrameHandlers {
  return {
    pointerDown: vi.fn(),
    pointerLeave: vi.fn(),
    pointerMove: vi.fn(),
    pointerUp: vi.fn(),
    keyDown: vi.fn(),
    keyUp: vi.fn(),
    wheel: vi.fn(),
    dragOver: vi.fn(),
    dragLeave: vi.fn(),
    drop: vi.fn(),
  }
}

describe('Scene Interaction Frame', () => {
  it('dispatches user-equivalent pointer, keyboard, and wheel events through the frame', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const harness = createSceneInteractionEventHarness(container, {
      bounds: { left: 10, top: 20, width: 400, height: 300 },
      trackListeners: true,
    })
    const received: string[] = []
    let cachedRect: DOMRect | null = null
    const handlers: SceneInteractionFrameHandlers = {
      pointerDown: (event) => {
        cachedRect = container.getBoundingClientRect()
        received.push(`down:${event.pointerId}:${harness.screenPointFrom(event, cachedRect).x}:${event.shiftKey}`)
      },
      pointerLeave: (event) => {
        received.push(`leave:${event.pointerId}`)
      },
      pointerMove: (event) => {
        if (!cachedRect) throw new Error('pointer move before pointer down')
        const screen = harness.screenPointFrom(event, cachedRect)
        received.push(`move:${event.pointerId}:${screen.x}:${screen.y}:${event.altKey}`)
      },
      pointerUp: (event) => {
        received.push(`up:${event.pointerId}`)
        cachedRect = null
      },
      keyDown: (event) => {
        received.push(`keydown:${event.code}`)
      },
      keyUp: (event) => {
        received.push(`keyup:${event.code}`)
      },
      wheel: (event) => {
        event.preventDefault()
        received.push(`wheel:${harness.screenPointFrom(event).x}:${event.deltaY}`)
      },
      dragOver: vi.fn(),
      dragLeave: vi.fn(),
      drop: vi.fn(),
    }
    const frame = createSceneInteractionFrame({ container, handlers })

    frame.attach()
    harness.pointerDown({ x: 12, y: 14 }, { pointerId: 7, shiftKey: true })
    harness.setBounds({ left: 30, top: 40, width: 400, height: 300 })
    harness.pointerMoveClient({ x: 35, y: 48 }, { pointerId: 7, altKey: true })
    harness.holdSpace()
    harness.releaseSpace()
    const wheel = harness.wheel({ x: 44, y: 55 }, { deltaY: -120 })
    harness.pointerLeave({ x: 44, y: 55 }, { pointerId: 7 })
    harness.pointerUpClient({ x: 35, y: 48 }, { pointerId: 7 })
    frame.dispose(() => {})
    harness.pointerDown({ x: 99, y: 99 }, { pointerId: 8 })

    expect(wheel.defaultPrevented).toBe(true)
    expect(harness.listenerLog?.containerAdds('pointerdown')).toHaveLength(1)
    expect(harness.listenerLog?.containerRemoves('pointerdown')).toHaveLength(1)
    expect(received).toEqual([
      'down:7:12:true',
      'move:7:25:28:true',
      'keydown:Space',
      'keyup:Space',
      'wheel:44:-120',
      'leave:7',
      'up:7',
    ])

    harness.dispose()
    container.remove()
  })

  it('owns listener setup, teardown, transition cleanup, and disposal cleanup', () => {
    const container = document.createElement('div')
    const handlers = createHandlers()
    const transition = vi.fn()
    const updateCursor = vi.fn()
    const disposeCleanup = vi.fn()
    const addContainerListener = vi.spyOn(container, 'addEventListener')
    const removeContainerListener = vi.spyOn(container, 'removeEventListener')
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const frame = createSceneInteractionFrame({ container, handlers })

    frame.attach()
    frame.attach()
    expect(addContainerListener.mock.calls.filter(([event]) => event === 'pointerdown')).toHaveLength(1)
    expect(addWindowListener.mock.calls.filter(([event]) => event === 'pointermove')).toHaveLength(1)

    frame.transitionTool({
      toolName: 'plant-stamp',
      transition,
      updateCursor,
    })
    expect(transition).toHaveBeenCalledWith('plant-stamp')
    expect(updateCursor).toHaveBeenCalledWith('plant-stamp')

    frame.dispose(disposeCleanup)
    frame.dispose(disposeCleanup)

    expect(removeContainerListener.mock.calls.filter(([event]) => event === 'pointerdown')).toHaveLength(1)
    expect(removeWindowListener.mock.calls.filter(([event]) => event === 'pointermove')).toHaveLength(1)
    expect(disposeCleanup).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['completed interaction', {}],
    ['cancelled interaction', { preserveActiveDraft: true }],
  ] as const)('owns transient cleanup ordering for a %s', (_name, options) => {
    const container = document.createElement('div')
    const handlers = createHandlers()
    const frame = createSceneInteractionFrame({ container, handlers })
    const order: string[] = []

    frame.cleanupTransient(options, {
      clearPointerGesture: () => order.push('pointer'),
      cancelSharedGestures: () => order.push('shared'),
      cancelToolTransient: (received) => {
        expect(received).toBe(options)
        order.push('tool')
      },
      clearHover: () => order.push('hover'),
      resetCursor: () => order.push('cursor'),
    })

    expect(order).toEqual(['pointer', 'shared', 'tool', 'hover', 'cursor'])
  })

  it('owns captured pointer state, cached bounds, and tool drag lifecycle', () => {
    const container = document.createElement('div')
    const harness = createSceneInteractionEventHarness(container, {
      bounds: { left: 10, top: 20, width: 400, height: 300 },
    })
    const frame = createSceneInteractionFrame({ container, handlers: createHandlers() })
    const pointerDown = harness.pointerDown({ x: 12, y: 14 }, { pointerId: 7 })
    const cachedRect = container.getBoundingClientRect()

    frame.startPointerGesture({
      pointerId: pointerDown.pointerId,
      startScreen: { x: 12, y: 14 },
      startWorld: { x: 120, y: 140 },
      containerRect: cachedRect,
    })
    harness.setBounds({ left: 30, top: 40, width: 400, height: 300 })

    expect(frame.hasPointerGesture()).toBe(true)
    expect(frame.currentContainerRect().left).toBe(10)
    expect(frame.pointerGestureFor({ pointerId: 8 })).toBeNull()
    expect(frame.pointerGestureFor({ pointerId: 7 })).toMatchObject({
      pointerId: 7,
      startScreen: { x: 12, y: 14 },
      startWorld: { x: 120, y: 140 },
    })

    const drag = {
      update: vi.fn(),
      commit: vi.fn(),
    }
    frame.beginToolPointerDrag(drag)
    expect(frame.activeToolPointerDrag()).toBe(drag)

    frame.clearPointerGesture()

    expect(frame.hasPointerGesture()).toBe(false)
    expect(frame.pointerGestureFor({ pointerId: 7 })).toBeNull()
    expect(frame.activeToolPointerDrag()).toBeNull()
    expect(frame.currentContainerRect().left).toBe(30)

    harness.dispose()
  })

  it('owns shared space-key lifecycle state', () => {
    const container = document.createElement('div')
    const frame = createSceneInteractionFrame({ container, handlers: createHandlers() })

    expect(frame.isSpaceHeld()).toBe(false)

    frame.holdSpace()
    expect(frame.isSpaceHeld()).toBe(true)

    frame.releaseSpace()
    expect(frame.isSpaceHeld()).toBe(false)

    frame.holdSpace()
    frame.dispose(() => {})

    expect(frame.isSpaceHeld()).toBe(false)
  })
})
