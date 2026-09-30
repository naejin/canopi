// canvas/runtime/keyboard-port.ts
//
// Owns the canvas's key handling behind CanvasKeyboardPort (spec §1.2a, ADR 0020): the arrow nudge and pan, the Menu key,
// the armed tool's keys, Esc (the nudge series, the tool, a live pointer session, then the chain back to Select and an
// empty selection), Enter or F2 on a note and Space for panning. In 0B it is today's window key handling in today's order,
// fed by the DOM input source's `legacyKeys` through `keydown` and `keyup`: a registered tool's keys become ToolCommands,
// and a tool still on the legacy bridge keeps its own key hook (`legacy.bridge`). 0C feeds the same port from the key
// router and removes the legacy half. The arrow nudge series is the ToolHost's; the port only reads its outcome.

import type { ToolHost } from './interaction-ports'
import type { Modifiers, ToolId } from './interaction-types'
import { isEditableTarget } from './input/editable-target'
import type { CanvasEscapeLayer, CanvasKeyboardPort, CanvasKeyCommand } from './runtime'
import type { ToolCommand } from './tools/tool'
import type { ViewNavigation } from './view/navigation'
import type { ScreenPoint, ViewFrameSource } from './view/types'

/** Arrow-key pan steps with nothing selected, in screen pixels. */
const ARROW_PAN_STEP_PX = 64
const ARROW_PAN_LARGE_STEP_PX = 256
/** `[` and `]` turn a held stamp by this much; positive is clockwise on the map. */
const ROTATE_HELD_STEP_DEG = 15 as const
const ARROW_DIRECTIONS: Readonly<Record<string, ScreenPoint>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}
const DIRECTIONS: Readonly<Record<'left' | 'right' | 'up' | 'down', ScreenPoint>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])
const KEYBOARD_INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menu"]',
  '[role="dialog"]',
  'dialog',
].join(',')

export interface CanvasKeyboardPortDeps {
  readonly host: HTMLElement
  readonly toolHost: ToolHost
  /** Today's getSelection().length > 0, read per key: on a 'pass' nudge the arrow pans with nothing selected and is let through
   *  otherwise; the Esc 'selection' layer is live while it holds. */
  hasSelection(): boolean
  /** Arrow pans (64 or 256 px), + / −, N, Shift+N and Shift+←/→/↑. */
  readonly navigation: Pick<ViewNavigation, 'panByPx' | 'zoomIn' | 'zoomOut' | 'resetNorth' | 'rotateBy'>
  readonly frames: ViewFrameSource
  /** 0B only: the session's side of today's key handling (0C replaces it with the key router and the FocusOwner). */
  readonly legacy: LegacyKeySession
}

/**
 * 0B only: what today's key handling needs from the interaction session. The session answers for the recogniser (a
 * registered tool) or the legacy bridge (a bridged one).
 */
export interface LegacyKeySession {
  /** A tool still on the legacy bridge keeps its own keys there. */
  readonly bridge: LegacyKeyBridge
  /** A pointer press or pan is live: the arrows and the Menu key wait, Esc cancels it. */
  pointerSessionLive(): boolean
  /** The map is in overview (the session's mode). */
  overview(): boolean
  /** Space is held for panning. */
  spaceHeld(): boolean
  /** Space and the modifiers as the keys left them: the recogniser's key state and the navigation cursor. */
  keyState(state: { readonly space: boolean; readonly mods: Modifiers }): void
  /** Esc with a registered tool's pointer session live: the recogniser's 'escape' cancels it and releases Space. */
  escapeGesture(): void
  /** The Esc chain leaves the armed tool for Select (the runtime's setTool, as a tool's own request). */
  requestTool(id: ToolId): void
  /** The Esc chain's last layer: an empty selection, history-free, redrawn. */
  clearSelection(): void
  /** Settings › Keyboard › Single-key shortcuts: with them off, `[` and `]` work only while the map has focus. */
  readSingleKeyShortcuts(): boolean
}

/** 0B only: the legacy bridge's key hooks for the tool it runs (today's scene-interaction.ts key steps). */
export interface LegacyKeyBridge {
  /** Today's _retryPendingTransientCancellation: true when it swallowed the key. */
  retryPendingCancellation(event: KeyboardEvent): boolean
  /** Today's _cancelInterruptedInteraction (Esc in overview or with a live pointer session). */
  cancelInterrupted(): void
  /** A Scene Edit is live: the keyboard menu is swallowed. */
  hasActiveSceneEdit(): boolean
  /** The selection's menu from the keyboard, admitted when the scene is settled, the note editor committed first. */
  openMenuFromKeyboard(event: KeyboardEvent): void
  /** The armed tool adapter's own key; true when it consumed the key. */
  toolKeyDown(event: KeyboardEvent): boolean
  /** The armed tool adapter keeps Space and Enter for itself. */
  suppressesSharedKeyboard(event: KeyboardEvent): boolean
  /** Enter or F2 with one editable note selected under Select: the note editor opens. */
  editSelectedNote(): boolean
  /** Today's tool guidance after every key. */
  publishGuidance(): void
}

/** 0B only: the source's `legacyKeys` sink and the physical keys it reports. */
export interface LegacyCanvasKeyboardPort extends CanvasKeyboardPort {
  keydown(event: KeyboardEvent): void
  keyup(event: KeyboardEvent): void
  /** Whether Control is physically down (a Ctrl wheel without it is a trackpad pinch). */
  physicalCtrl(): boolean
  /** When the keyboard last opened the canvas menu (event time), for the contextmenu echo; null before. */
  lastKeyboardMenuAt(): number | null
  /** A window blur: every key is up. */
  releaseKeys(): void
}

export function createCanvasKeyboardPort(deps: CanvasKeyboardPortDeps): LegacyCanvasKeyboardPort {
  const { host, toolHost, legacy } = deps
  let physicalCtrl = false
  let lastMenuAt: number | null = null

  function bridged(): boolean {
    return !toolHost.isRegistered(toolHost.activeTool.peek())
  }

  function modifiersOf(event: KeyboardEvent): Modifiers {
    return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey }
  }

  /** The arrow's rule after the host's nudge (spec §3.6): a handled or refused nudge takes the key, and on 'pass' the map
   *  pans with nothing selected; otherwise the key goes on. */
  function arrow(direction: ScreenPoint, large: boolean): boolean {
    const outcome = toolHost.nudge(direction, large)
    if (outcome !== 'pass') return true
    if (deps.hasSelection()) return false
    const step = large ? ARROW_PAN_LARGE_STEP_PX : ARROW_PAN_STEP_PX
    deps.navigation.panByPx({ x: -direction.x * step + 0, y: -direction.y * step + 0 })
    return true
  }

  /** Arrows on the focused map: never with Ctrl, Cmd or Alt, from a field or control, or while a pointer session is live. */
  function arrowFromKeyboard(event: KeyboardEvent): boolean {
    const direction = ARROW_DIRECTIONS[event.key]
    if (!direction || event.ctrlKey || event.metaKey || event.altKey || legacy.pointerSessionLive()) return false
    const target = event.target
    if (!(target instanceof Node) || !host.contains(target) || isKeyboardInteractiveEventTarget(target)) return false
    if (!arrow(direction, event.shiftKey)) return false
    event.preventDefault()
    return true
  }

  function holdSpace(event: KeyboardEvent): void {
    event.preventDefault()
    legacy.keyState({ space: true, mods: modifiersOf(event) })
  }

  /** Esc in overview or with a live pointer session: today's interrupted-gesture cancel, Space released. */
  function cancelInterrupted(isBridged: boolean): void {
    if (isBridged) {
      legacy.bridge.cancelInterrupted()
      return
    }
    legacy.escapeGesture()
    toolHost.interrupted()
  }

  function openMenu(): boolean {
    return !toolHost.menuAt('selection', 'keyboard').quarantine
  }

  /** Menu key or Shift F10 while the map has focus: the menu for the current selection. */
  function menuFromKeyboard(event: KeyboardEvent, isBridged: boolean): boolean {
    const menuKey = event.key === 'ContextMenu'
      || (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
    if (!menuKey || legacy.pointerSessionLive()) return false
    if (!isCanvasKeyboardShortcutTarget(event.target, host)) return false
    event.preventDefault()
    event.stopPropagation()
    if (isBridged) {
      if (legacy.bridge.hasActiveSceneEdit()) return true
      lastMenuAt = event.timeStamp
      legacy.bridge.openMenuFromKeyboard(event)
      return true
    }
    lastMenuAt = event.timeStamp
    if (!openMenu()) quarantine(event)
    return true
  }

  /** A registered tool's key as a command (spec §3.6): Esc, Enter, Backspace, and `[` `]` under today's gating. */
  function toolCommandFor(event: KeyboardEvent): ToolCommand | null {
    switch (event.key) {
      case 'Escape': return { kind: 'escape' }
      case 'Enter': return { kind: 'confirm' }
      case 'Backspace': return { kind: 'remove-last' }
      case '[':
      case ']': {
        // Like other single-key shortcuts they never act in a text field or with Ctrl, Cmd or Alt; with single-key
        // shortcuts off they still work while the map has focus, as the arrow keys do.
        if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return null
        const onMap = event.target instanceof Node && host.contains(event.target)
        if (!onMap && !legacy.readSingleKeyShortcuts()) return null
        return { kind: 'rotate-held', stepDeg: event.key === ']' ? ROTATE_HELD_STEP_DEG : -ROTATE_HELD_STEP_DEG as -15 }
      }
      default: return null
    }
  }

  /** The armed tool's own key; a consumed key is not also an app shortcut (Backspace in a draft must not delete). */
  function toolKey(event: KeyboardEvent, isBridged: boolean): boolean {
    if (isBridged) {
      if (!legacy.bridge.toolKeyDown(event)) return false
      event.preventDefault()
      return true
    }
    const command = toolCommandFor(event)
    if (!command || toolHost.command(command) !== 'handled') return false
    event.preventDefault()
    if (command.kind === 'rotate-held') event.stopPropagation()
    return true
  }

  /**
   * Esc on the map once the active tool has had its turn (a live pointer session cancels first): leave the tool for
   * Select, then clear the selection. Tools that keep a pick (a stamp, a row source) drop it first.
   */
  function escapeChain(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape' || event.defaultPrevented) return false
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
    if (!isCanvasKeyboardShortcutTarget(event.target, host)) return false
    if (!toolHost.activeToolIsSelect()) {
      event.preventDefault()
      legacy.requestTool('select')
      return true
    }
    if (!deps.hasSelection()) return false
    event.preventDefault()
    legacy.clearSelection()
    return true
  }

  function editSelectedNote(event: KeyboardEvent, isBridged: boolean): boolean {
    if (!toolHost.activeToolIsSelect()) return false
    if (event.key !== 'Enter' && event.key !== 'F2') return false
    if (!isCanvasKeyboardShortcutTarget(event.target, host)) return false
    if (isEditableTarget(event.target)) return false
    if (isBridged) {
      if (legacy.bridge.suppressesSharedKeyboard(event) || !legacy.bridge.editSelectedNote()) return false
    } else if (toolHost.command({ kind: 'edit-text' }) !== 'handled') {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  /** Today's _handleKeyDown, step by step. */
  function handleKeyDown(event: KeyboardEvent, isBridged: boolean): void {
    if (isBridged) {
      if (legacy.bridge.retryPendingCancellation(event)) return
    } else if (toolHost.retryPendingCancellation()) {
      quarantine(event)
      return
    }
    if (toolHost.hasNudgeSeries() && !(event.key in ARROW_DIRECTIONS) && !MODIFIER_KEYS.has(event.key)) {
      // Esc cancels the series like any gesture in progress; any other key keeps it.
      if (event.key === 'Escape') {
        event.preventDefault()
        toolHost.endNudgeSeries(false)
        return
      }
      toolHost.endNudgeSeries(true)
    }
    if (arrowFromKeyboard(event)) return
    if (!legacy.pointerSessionLive() && isKeyboardInteractiveEventTarget(event.target)) return
    if (legacy.overview()) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelInterrupted(isBridged)
        return
      }
      if (event.code === 'Space' && !legacy.spaceHeld() && !isEditableTarget(event.target)) holdSpace(event)
      return
    }
    if (menuFromKeyboard(event, isBridged)) return
    if (toolKey(event, isBridged)) return
    if (event.key === 'Escape' && legacy.pointerSessionLive()) {
      event.preventDefault()
      if (isBridged) legacy.bridge.cancelInterrupted()
      else legacy.escapeGesture()
      return
    }
    if (escapeChain(event)) return
    if (editSelectedNote(event, isBridged)) return
    if (
      event.code !== 'Space'
      || legacy.spaceHeld()
      || isEditableTarget(event.target)
      || (isBridged && legacy.bridge.suppressesSharedKeyboard(event))
    ) return
    holdSpace(event)
  }

  function escapeLayers(): readonly CanvasEscapeLayer[] {
    const layers: CanvasEscapeLayer[] = []
    if (legacy.pointerSessionLive()) layers.push('gesture')
    if (toolHost.hasNudgeSeries()) layers.push('nudge-series')
    if (toolHost.activeToolHasTransient()) layers.push('tool-transient')
    if (!toolHost.activeToolIsSelect()) layers.push('tool')
    if (deps.hasSelection()) layers.push('selection')
    return layers
  }

  return {
    host,
    escapeLayers,
    escape(layer) {
      switch (layer) {
        case 'gesture':
          if (bridged()) legacy.bridge.cancelInterrupted()
          else legacy.escapeGesture()
          return
        case 'nudge-series':
          toolHost.endNudgeSeries(false)
          return
        case 'tool-transient':
          toolHost.command({ kind: 'escape' })
          return
        case 'tool':
          legacy.requestTool('select')
          return
        case 'selection':
          legacy.clearSelection()
          return
      }
    },
    describeEscape() {
      return escapeLayers()[0] ?? null
    },
    command(c: CanvasKeyCommand): boolean {
      switch (c.kind) {
        case 'arrow':
          if (legacy.pointerSessionLive()) return false
          return arrow(DIRECTIONS[c.dir], c.large)
        case 'rotate-held':
          return toolHost.command({ kind: 'rotate-held', stepDeg: c.stepDeg }) === 'handled'
        case 'confirm':
        case 'remove-last':
        case 'edit-text':
        case 'delete-handle':
          return toolHost.command({ kind: c.kind }) === 'handled'
        case 'rotate-view':
          deps.navigation.rotateBy(c.direction)
          return true
        case 'reset-north':
          deps.navigation.resetNorth()
          return true
        case 'zoom-step':
          if (c.direction > 0) deps.navigation.zoomIn()
          else deps.navigation.zoomOut()
          return true
        case 'context-menu':
          if (legacy.pointerSessionLive()) return false
          openMenu()
          return true
      }
    },
    keyState(state) {
      legacy.keyState(state)
    },
    keydown(event) {
      if (event.key === 'Control') physicalCtrl = true
      const isBridged = bridged()
      try {
        handleKeyDown(event, isBridged)
      } finally {
        if (isBridged) legacy.bridge.publishGuidance()
      }
    },
    keyup(event) {
      if (event.key === 'Control') physicalCtrl = false
      if (event.code !== 'Space') return
      legacy.keyState({ space: false, mods: modifiersOf(event) })
    },
    physicalCtrl: () => physicalCtrl,
    lastKeyboardMenuAt: () => lastMenuAt,
    releaseKeys() {
      physicalCtrl = false
    },
  }
}

/** Today's app-wide swallow while a failed cancellation is pending. */
function quarantine(event: KeyboardEvent): void {
  if (event.cancelable) event.preventDefault()
  event.stopImmediatePropagation()
}

/** Keys on the map itself (or the window): not from a control, a field, a menu or a dialog inside it. */
export function isCanvasKeyboardShortcutTarget(target: EventTarget | null, host: HTMLElement): boolean {
  if (typeof window !== 'undefined' && target === window) return true
  if (!(target instanceof Node)) return false
  if (!host.contains(target)) return false
  const element = target instanceof HTMLElement ? target : target.parentElement
  if (!element) return false
  return element.closest(KEYBOARD_INTERACTIVE_SELECTOR) === null
}

/** A control, a field, a menu or a dialog keeps its own keys. */
export function isKeyboardInteractiveEventTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return element ? element.closest(KEYBOARD_INTERACTIVE_SELECTOR) !== null : false
}
