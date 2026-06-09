import { describe, expect, it, vi } from 'vitest'
import {
  createSceneInteractionFrame,
  type SceneInteractionFrameHandlers,
} from '../canvas/runtime/interaction/frame'

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

  it('owns transient cleanup ordering for shared gestures, tools, hover, and cursor state', () => {
    const container = document.createElement('div')
    const handlers = createHandlers()
    const frame = createSceneInteractionFrame({ container, handlers })
    const order: string[] = []
    const options = { preserveActiveDraft: true }

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
})
