// The key router as the canvas suites install it: the canvas rows alone over one canvas port. The editions' own are
// support/desktop-key-router.ts and web/browser-shell-commands.ts installWebKeyRouter.
import type { KeyboardEventLike } from '../../app/keyboard/key-chord'
import { installKeyRouter, type KeyRouterHandle } from '../../app/keyboard/key-router'
import { CANVAS_KEYMAP_ROWS } from '../../app/keyboard/keymap'
import { singleKeyShortcuts } from '../../app/settings/state'
import type { CanvasKeyboardPort } from '../../canvas/runtime/runtime'

/** The canvas rows over one port, with a command sink that consumes nothing. */
export function installCanvasKeyRouter(canvas: () => CanvasKeyboardPort | null): KeyRouterHandle {
  return installKeyRouter({
    target: window,
    keymap: CANVAS_KEYMAP_ROWS,
    commands: { run: () => false },
    canvas,
    singleKeys: singleKeyShortcuts,
    focus: { cycleRegion: () => false },
    isModalOpen: () => false,
  })
}

/** A keydown dispatched as a browser does: bubbling and cancelable, on the window unless a target is given. */
export function pressKey(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

/** A keydown literal, as the router reads one (app/keyboard tests). */
export function keyLike(key: string, init: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    type: 'keydown',
    key,
    code: '',
    keyCode: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    cancelable: true,
    timeStamp: 0,
    target: null,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...init,
  }
}
