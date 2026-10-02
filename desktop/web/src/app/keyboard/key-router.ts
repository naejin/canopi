// app/keyboard/key-router.ts
//
// Owns the only window key listeners (spec §1.6, ADR 0020; policy P8): keydown in capture and bubble, keyup in capture.
// A key that is part of an IME composition runs nothing (WebKit sends the composition's Enter with keyCode 229).
// Capture hands every other key to the canvas keyboard port first (keyState: the nudge commit, the physical Ctrl, the Menu
// key's time, the Space hold), cycles the F6 regions and runs Esc on the canvas. It also keeps the keys held down and
// lets them go (a keyup to the port): those pressed under Cmd when Meta comes up, since macOS sends no keyup for them
// (a Space held from before Cmd keeps its pan), and every key on a window blur or a visibility change. Bubble skips a key an element handler
// already took, then runs, by focus class, the modal rows, the global rows, the pushed scopes and the keymap's
// canvas-focus, view-arrows and command rows, each chord's one row per scope, through the canvas port or the edition's
// CommandSink. Installed once per edition: Desktop's platform/desktop.ts passes installKeyRouter to commands/registry.ts
// installDesktopKeyRouter; Web's main.web.tsx calls web/browser-shell-commands.ts installWebKeyRouter.

import type { ReadonlySignal } from '@preact/signals'
import type { CanvasCommandId } from '../canvas-commands'
import type { ShellCommandId } from '../shell-commands'
import type { InputPlatform } from '../../canvas/runtime/input/platform'
import type { CanvasKeyboardPort, CanvasKeyState, CanvasKeyVerdict } from '../../canvas/runtime/runtime'
import { chordMatches, chordOf, digitChordOf, type KeyboardEventLike, type KeyChord } from './key-chord'
import { pushedKeyScopes, type CommandSink, type KeymapRow, type KeyScope } from './keymap'
import { classifyKeyTarget, ownsArrows, type KeyTarget } from './target-class'

/** F6 and Shift+F6 move between the workspace regions (app/shell/focus-regions.ts). */
interface KeyRouterFocus {
  cycleRegion(step: 1 | -1): boolean
}

export interface KeyRouterDeps {
  readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'>   // window in production
  readonly keymap: readonly KeymapRow[]            // composed per edition: its shellKeymapRows(…), then CANVAS_KEYMAP_ROWS
  readonly commands: CommandSink
  readonly canvas: () => CanvasKeyboardPort | null // canvas/session.ts currentCanvasKeyboardPort
  readonly singleKeys: ReadonlySignal<boolean>     // Settings › Keyboard
  readonly focus: KeyRouterFocus
  readonly isModalOpen: () => boolean              // modalLayerOpen, saveProblem, savedViewDialogOpen
  readonly platform: InputPlatform                 // the Mac chord rule; detectPlatform runs in the platforms
  readonly document: Pick<Document, 'addEventListener' | 'removeEventListener'>   // visibilitychange
}

export interface KeyRouterHandle { dispose(): void }

/** Step 9 tries the narrowest scope first: a canvas-focus row before the command row of the same chord. */
const KEYMAP_SCOPES: readonly Exclude<KeyScope, 'global'>[] = ['canvas-focus', 'view-arrows', 'command']

export function installKeyRouter(deps: KeyRouterDeps): KeyRouterHandle {
  /** The keys down now, by code: what a lost keyup would leave held in the port, and whether Cmd was down at the press. */
  const held = new Map<string, { readonly key: string, readonly underCmd: boolean }>()
  const letGo = (timeStamp: number, onlyUnderCmd: boolean): void => {
    const keys = [...held].filter(([, down]) => !onlyUnderCmd || down.underCmd)
    for (const [code] of keys) held.delete(code)
    const port = deps.canvas()
    if (!port) return
    for (const [code, down] of keys) port.keyState(releasedKey(down.key, code, timeStamp))
  }
  // The listeners are registered for keydown and keyup only, so a KeyboardEvent here is a KeyboardEventLike.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    // Step 1: a key that is part of a composition is the IME's.
    if (isComposing(event)) return
    const code = event.code || event.key
    // A repeat keeps the press's own answer: a key held from before Cmd still sends its keyup.
    if (!held.has(code)) held.set(code, { key: event.key, underCmd: event.metaKey })
    keyDownCapture(deps, event as KeyboardEventLike)
  }
  const onKeyDownBubble = (event: KeyboardEvent): void => keyDownBubble(deps, event as KeyboardEventLike)
  const onKeyUpCapture = (event: KeyboardEvent): void => {
    held.delete(event.code || event.key)
    const port = deps.canvas()
    if (port) port.keyState(keyState(event as KeyboardEventLike, 'keyup', where(deps, port, event as KeyboardEventLike)))
    if (event.key === 'Meta') letGo(event.timeStamp, true)
  }
  const onLeave = (event: Event): void => letGo(event.timeStamp, false)
  deps.target.addEventListener('keydown', onKeyDownCapture as EventListener, true)
  deps.target.addEventListener('keydown', onKeyDownBubble as EventListener)
  deps.target.addEventListener('keyup', onKeyUpCapture as EventListener, true)
  deps.target.addEventListener('blur', onLeave)
  deps.document.addEventListener('visibilitychange', onLeave)
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      deps.target.removeEventListener('keydown', onKeyDownCapture as EventListener, true)
      deps.target.removeEventListener('keydown', onKeyDownBubble as EventListener)
      deps.target.removeEventListener('keyup', onKeyUpCapture as EventListener, true)
      deps.target.removeEventListener('blur', onLeave)
      deps.document.removeEventListener('visibilitychange', onLeave)
    },
  }
}

function keyDownCapture(deps: KeyRouterDeps, event: KeyboardEventLike): void {
  const port = deps.canvas()
  const at = where(deps, port, event)
  const verdict: CanvasKeyVerdict = port ? port.keyState(keyState(event, 'keydown', at)) : 'pass'
  if (verdict === 'held') {
    if (event.cancelable) event.preventDefault()
    return
  }
  if (event.key === 'F6') {
    // Capture, so a widget that stops propagation cannot keep focus in its region (fixture I11).
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || at.focus === 'modal') return
    if (deps.focus.cycleRegion(event.shiftKey ? -1 : 1) && event.cancelable) event.preventDefault()
    return
  }
  if (event.key === 'Escape' && port) escapeOnCanvas(port, event, at, verdict === 'pass-live')
}

/**
 * Esc on the canvas in today's order and with today's reach, until the Esc chain takes it (plan Phase F, K2): the port's
 * live layers in the order it lists them, until one consumes the key; a nudge series aborts from anywhere, the other
 * layers not from a control unless a pointer session is live, and leaving the tool or clearing the selection needs the
 * map focused and no modifier.
 */
function escapeOnCanvas(port: CanvasKeyboardPort, event: KeyboardEventLike, at: KeyTarget, live: boolean): void {
  const modified = event.shiftKey || event.ctrlKey || event.altKey || event.metaKey
  for (const layer of port.escapeLayers()) {
    if (layer !== 'nudge-series') {
      if (at.control && !live) return
      if ((layer === 'tool' || layer === 'selection') && (at.focus !== 'map' || modified)) return
    }
    if (!port.escape(layer)) continue
    if (event.cancelable) event.preventDefault()
    return
  }
}

function keyDownBubble(deps: KeyRouterDeps, event: KeyboardEventLike): void {
  // An element handler of a focused widget took the key.
  if (event.defaultPrevented) return
  const named = chordOf(event, deps.platform)
  if (!named) return
  const port = deps.canvas()
  const at = where(deps, port, event)
  // A layout's digit row names its digits when no row takes its label (AZERTY Ctrl+& is Ctrl+1).
  let chord: KeyChord = named
  let rows = rowsFor(deps.keymap, named)
  const digit = rows.length === 0 ? digitChordOf(named, event) : null
  if (digit) {
    chord = digit
    rows = rowsFor(deps.keymap, digit)
  }
  const singleKeys = deps.singleKeys.peek()

  // Step 5: a modal dialog's own element handlers have run; only its rows remain.
  if (at.focus === 'modal') {
    const row = rows.find((candidate) => candidate.worksInModal)
    if (row) dispatch(deps, port, event, row, true)
    return
  }
  // Step 6: in a text field only the rows that work there (the shell's, F2 included); elsewhere the global rows.
  if (at.focus === 'text') {
    const row = rows.find((candidate) => candidate.worksInTextFields)
    if (row) dispatch(deps, port, event, row, true)
    return
  }
  const global = rows.find((row) => row.scope === 'global')
  if (global) {
    dispatch(deps, port, event, global, true)
    return
  }
  // Step 7: the pushed scopes, the latest first.
  for (const scope of pushedKeyScopes()) {
    if (!scope.handle(event, chord)) continue
    consume(event)
    return
  }
  // Step 9: one row per chord and scope, never tried in turn.
  for (const scope of KEYMAP_SCOPES) {
    if (!scopeAdmits(scope, at, event)) continue
    for (const row of rows) {
      if (row.scope !== scope) continue
      const switchOn = row.singleKey !== 'follows-switch' || singleKeys
      // A canvas key that follows the switch still runs on the focused map with it off (a held stamp's `[` `]`).
      if (!switchOn && !(row.canvas && at.focus === 'map')) continue
      dispatch(deps, port, event, row, switchOn)
      return
    }
  }
}

function isComposing(event: Pick<KeyboardEventLike, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229
}

function rowsFor(keymap: readonly KeymapRow[], chord: KeyChord): readonly KeymapRow[] {
  return keymap.filter((row) => row.chords.some((rowChord) => chordMatches(rowChord, chord)))
}

function scopeAdmits(scope: Exclude<KeyScope, 'global'>, at: KeyTarget, event: KeyboardEventLike): boolean {
  switch (scope) {
    case 'canvas-focus':
      return at.focus === 'map' || at.focus === 'body'
    case 'view-arrows':
      return !ownsArrows(event.target)
    case 'command':
      return true
  }
}

/** Step 10: canvas commands through the port, a refused one through its fallback, the rest through the sink. */
function dispatch(
  deps: KeyRouterDeps,
  port: CanvasKeyboardPort | null,
  event: KeyboardEventLike,
  row: KeymapRow,
  fallbackAllowed: boolean,
): void {
  let consumed: boolean
  if (row.canvas) {
    consumed = port?.command(row.canvas) ?? false
    if (!consumed && row.fallback && fallbackAllowed) consumed = deps.commands.run(row.fallback)
  } else {
    consumed = deps.commands.run(row.command as ShellCommandId | CanvasCommandId)
  }
  if (consumed) consume(event)
}

function consume(event: KeyboardEventLike): void {
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
}

function where(deps: KeyRouterDeps, port: CanvasKeyboardPort | null, event: KeyboardEventLike): KeyTarget {
  return classifyKeyTarget(event.target, port?.host ?? null, deps.isModalOpen())
}

/** A keyup the browser never sent, for a key held when Meta came up or the window lost the keys. */
function releasedKey(key: string, code: string, timeStamp: number): CanvasKeyState {
  return {
    type: 'keyup',
    key,
    code,
    mods: { shift: false, ctrl: false, alt: false, meta: false },
    timeStamp,
    text: false,
    onCanvas: false,
  }
}

function keyState(event: KeyboardEventLike, type: CanvasKeyState['type'], at: KeyTarget): CanvasKeyState {
  return {
    type,
    key: event.key,
    code: event.code,
    mods: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey },
    timeStamp: event.timeStamp,
    text: at.text,
    onCanvas: at.focus === 'map' || at.focus === 'body',
  }
}
