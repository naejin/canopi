import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentCanvasSession } from '../canvas/session'
import { activeTool } from '../canvas/session-state'
import {
  disposeWebCanvasShortcuts,
  installWebCanvasShortcuts,
} from '../web/canvas-shortcuts'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('Web Canvas shortcuts', () => {
  beforeEach(() => {
    activeTool.value = 'select'
    setCurrentCanvasSession(null)
    disposeWebCanvasShortcuts()
  })

  afterEach(() => {
    disposeWebCanvasShortcuts()
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('dispatches tool and history shortcuts with exact Ctrl, Meta, Shift, and Alt semantics', () => {
    const setTool = vi.fn()
    const undo = vi.fn()
    const redo = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: { setTool },
        history: {
          canUndo: signal(true),
          canRedo: signal(true),
          undo,
          redo,
        },
      }),
    }))
    installWebCanvasShortcuts()

    expect(dispatchShortcut({ key: 'e' }).defaultPrevented).toBe(true)
    expect(dispatchShortcut({ key: 'E', shiftKey: true }).defaultPrevented).toBe(false)
    expect(dispatchShortcut({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(dispatchShortcut({ key: 'z', metaKey: true }).defaultPrevented).toBe(true)
    expect(dispatchShortcut({ key: 'z', ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false)
    expect(dispatchShortcut({ key: 'z', ctrlKey: true, altKey: true }).defaultPrevented).toBe(false)
    expect(dispatchShortcut({ key: 'Z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(dispatchShortcut({ key: 'Z', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true)
    expect(dispatchShortcut({
      key: 'Z',
      metaKey: true,
      shiftKey: true,
      altKey: true,
    }).defaultPrevented).toBe(false)

    expect(setTool).toHaveBeenCalledOnce()
    expect(setTool).toHaveBeenCalledWith('ellipse')
    expect(activeTool.value).toBe('ellipse')
    expect(undo).toHaveBeenCalledTimes(2)
    expect(redo).toHaveBeenCalledTimes(2)
  })

  it('suppresses Canvas shortcuts from editable targets', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const setTool = vi.fn()
    const undo = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        tools: { setTool },
        history: { canUndo: signal(true), undo },
      }),
    }))
    installWebCanvasShortcuts()

    input.dispatchEvent(shortcutEvent({ key: 'e', bubbles: true }))
    input.dispatchEvent(shortcutEvent({ key: 'z', ctrlKey: true, bubbles: true }))

    expect(setTool).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(activeTool.value).toBe('select')
  })

  it('re-reads the live Canvas surface across detach and replacement', () => {
    const firstUndo = vi.fn()
    const replacementUndo = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        history: { canUndo: signal(true), undo: firstUndo },
      }),
    }))
    installWebCanvasShortcuts()

    dispatchShortcut({ key: 'z', ctrlKey: true })
    setCurrentCanvasSession(null)
    const detachedShortcut = dispatchShortcut({ key: 'z', ctrlKey: true })
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        history: { canUndo: signal(true), undo: replacementUndo },
      }),
    }))
    dispatchShortcut({ key: 'z', metaKey: true })

    expect(firstUndo).toHaveBeenCalledOnce()
    expect(replacementUndo).toHaveBeenCalledOnce()
    expect(detachedShortcut.defaultPrevented).toBe(false)
  })

  it('does not swallow disabled undo or redo shortcuts', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({
        history: {
          canUndo: signal(false),
          canRedo: signal(false),
          undo,
          redo,
        },
      }),
    }))
    installWebCanvasShortcuts()

    const undoShortcut = dispatchShortcut({ key: 'z', ctrlKey: true })
    const redoShortcut = dispatchShortcut({ key: 'Z', metaKey: true, shiftKey: true })

    expect(undoShortcut.defaultPrevented).toBe(false)
    expect(redoShortcut.defaultPrevented).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })

  it('replaces and disposes its one owned window listener idempotently', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const disposeFirst = installWebCanvasShortcuts()
    const firstHandler = add.mock.calls.find(([type]) => type === 'keydown')?.[1]
    const disposeReplacement = installWebCanvasShortcuts()
    const keydownHandlers = add.mock.calls.filter(([type]) => type === 'keydown')
    const replacementHandler = keydownHandlers.at(-1)?.[1]

    expect(firstHandler).toBeDefined()
    expect(replacementHandler).toBeDefined()
    expect(replacementHandler).not.toBe(firstHandler)
    expect(remove).toHaveBeenCalledWith('keydown', firstHandler)

    disposeFirst()
    expect(remove).not.toHaveBeenCalledWith('keydown', replacementHandler)

    disposeReplacement()
    disposeReplacement()
    expect(remove.mock.calls.filter(
      ([type, handler]) => type === 'keydown' && handler === replacementHandler,
    )).toHaveLength(1)
  })
})

interface ShortcutEventInit {
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
  readonly bubbles?: boolean
}

function shortcutEvent(init: ShortcutEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    ...init,
    cancelable: true,
  })
}

function dispatchShortcut(init: ShortcutEventInit): KeyboardEvent {
  const event = shortcutEvent(init)
  window.dispatchEvent(event)
  return event
}
