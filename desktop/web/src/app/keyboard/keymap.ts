// app/keyboard/keymap.ts
//
// Owns the keymap the key router matches (spec §1.6, §3.6): which chord runs which command, in which focus scope, and
// whether Settings › Keyboard's single-key switch turns it off. Canvas rows come from each catalogue definition's
// `shortcuts` (never its key hint, so no row has Escape) and from the canvas key commands the keyboard port runs; each
// edition composes its shell rows from its own catalogue and runs them through its own CommandSink (Desktop:
// commands/registry.ts; Web: web/browser-shell-commands.ts), so this module names no edition (P14). Also the stack of
// pushed key scopes: non-modal surfaces that own a key while open.

import type { CanvasCommandId } from '../canvas-commands'
import { canvasCommandDefinitions } from '../canvas-commands'
import type { ShellCommandCatalogEntry, ShellCommandId } from '../shell-commands'
import { isCharacterKeyShortcut } from '../shell-commands/shortcut-text'
import type { CanvasKeyCommand } from '../../canvas/runtime/runtime'
import { chordsOfShortcut, type KeyboardEventLike, type KeyChord } from './key-chord'

export type KeyScope =
  | 'global'          // every focus class except modal; in text only with worksInTextFields (Ctrl+K, Ctrl+S, F1, F6)
  | 'command'         // anywhere except text fields and dialogs: tool letters, Delete, [ ], N, Ctrl+Z…
  | 'view-arrows'     // like 'command', but not inside an arrow-owning widget
  | 'canvas-focus'    // focus on the map host (not text or a control inside it) or <body>: arrows, Enter, Backspace, F2, Menu

/** A shell command, a canvas catalogue command or a canvas key command ('canvas.<CanvasKeyCommand kind>'). */
type KeyCommandId = ShellCommandId | CanvasCommandId | `canvas.${CanvasKeyCommand['kind']}`

export interface KeymapRow {
  readonly command: KeyCommandId
  /** The port command a canvas key row sends; absent on rows the edition's CommandSink runs. */
  readonly canvas?: CanvasKeyCommand
  readonly chords: readonly KeyChord[]
  readonly scope: KeyScope
  /** The single-key shortcut switch: 'follows-switch' rows stop when it is off; a canvas key row that follows it still runs
   *  its port command, without its fallback, while the map host has focus (a held stamp's `[` `]`, spec §3.6). */
  readonly singleKey: 'follows-switch' | 'always-on' | 'n/a'
  readonly worksInTextFields?: boolean        // 'global' rows only: Ctrl+K, Ctrl+S, F1, Ctrl+F
  readonly worksInModal?: boolean             // Desktop's help.commandPalette only: its sink closes the open palette
  /** A canvas row whose port command() returns false runs this instead (F2 → file.rename; Backspace → delete). */
  readonly fallback?: ShellCommandId | CanvasCommandId
}

/** Where a keymap row runs. Injected, so this module stays neutral (P14). */
export interface CommandSink {
  /** False when the key is not consumed; the router prevents and stops a consumed key. */
  run(command: ShellCommandId | CanvasCommandId): boolean
}

/** The canvas key commands, ahead of the catalogue rows they share a chord with (Backspace, F2, `[` `]`). */
const CANVAS_KEY_ROWS: readonly KeymapRow[] = [
  keyRow({ kind: 'confirm' }, ['Enter']),
  keyRow({ kind: 'remove-last' }, ['Backspace'], { fallback: 'canvas.deleteSelected' }),
  keyRow({ kind: 'edit-text' }, ['F2'], { fallback: 'file.rename' }),
  keyRow({ kind: 'context-menu' }, ['ContextMenu', 'Shift+F10']),
  keyRow({ kind: 'rotate-held', stepDeg: -15 }, ['['], { scope: 'command', singleKey: 'follows-switch', fallback: 'canvas.sendToBack' }),
  keyRow({ kind: 'rotate-held', stepDeg: 15 }, [']'], { scope: 'command', singleKey: 'follows-switch', fallback: 'canvas.bringToFront' }),
  ...(['left', 'right', 'up', 'down'] as const).flatMap((dir) => {
    const key = `Arrow${dir[0]!.toUpperCase()}${dir.slice(1)}`
    return [
      keyRow({ kind: 'arrow', dir, large: false }, [key]),
      keyRow({ kind: 'arrow', dir, large: true }, [`Shift+${key}`]),
    ]
  }),
]

/** Both editions' canvas rows: the key commands, then each catalogue definition's shortcuts through the switch. */
export const CANVAS_KEYMAP_ROWS: readonly KeymapRow[] = [
  ...CANVAS_KEY_ROWS,
  ...canvasCommandDefinitions.flatMap((definition) => (definition.shortcuts ?? []).flatMap((shortcut): KeymapRow[] => {
    const scope: KeyScope = definition.worksInTextFields ? 'global' : 'command'
    const chords = chordsOfShortcut(shortcut)
    // `[` and `]` belong to their key rows, which fall back to the catalogue command.
    const claimed = CANVAS_KEY_ROWS.some((row) => row.scope === scope && row.fallback === definition.commandId)
    if (claimed) return []
    return [{
      command: definition.commandId,
      chords,
      scope,
      singleKey: isCharacterKeyShortcut(shortcut) ? 'follows-switch' : 'n/a',
      ...(definition.worksInTextFields ? { worksInTextFields: true } : {}),
    }]
  })),
]

/** Shell rows that also work while a text field has focus (spec §3.6). */
const SHELL_ROWS_IN_TEXT_FIELDS: ReadonlySet<ShellCommandId> = new Set([
  'file.save',
  'file.downloadCanopi',
  'help.shortcuts',
  'edit.findPlants',
])
/** F2 asks the map first (edit the selected note), so its shell row waits for the command step. */
const SHELL_COMMAND_SCOPE_ROWS: ReadonlySet<ShellCommandId> = new Set(['file.rename'])

/**
 * One edition's shell rows from its own catalogue (capability-filtered; Web omits the shortcuts a browser keeps). Each
 * edition composes [...shellKeymapRows(…), ...CANVAS_KEYMAP_ROWS].
 */
export function shellKeymapRows(
  catalog: readonly ShellCommandCatalogEntry[],
  options: { readonly omit?: ReadonlySet<string> } = {},
): readonly KeymapRow[] {
  return catalog.flatMap((command): KeymapRow[] => {
    const shortcut = command.shortcut
    if (!shortcut || options.omit?.has(shortcut)) return []
    return [{
      command: command.id,
      chords: chordsOfShortcut(shortcut),
      scope: SHELL_COMMAND_SCOPE_ROWS.has(command.id) ? 'command' : 'global',
      singleKey: isCharacterKeyShortcut(shortcut) ? 'follows-switch' : 'n/a',
      ...(SHELL_ROWS_IN_TEXT_FIELDS.has(command.id) ? { worksInTextFields: true } : {}),
      ...(command.id === 'help.commandPalette' ? { worksInModal: true } : {}),
    }]
  })
}

/** Pushed scopes: non-modal surfaces that own keys while open (spec §1.6, step 7). Modal surfaces push none. */
interface KeyScopeHandle { dispose(): void }

interface PushedKeyScope {
  readonly id: 'stories-undo-toast'
  handle(e: KeyboardEventLike, chord: KeyChord): boolean
}

const pushedScopes: PushedKeyScope[] = []

export function pushKeyScope(scope: PushedKeyScope): KeyScopeHandle {
  const entry = { ...scope }
  pushedScopes.push(entry)
  return {
    dispose() {
      const index = pushedScopes.lastIndexOf(entry)
      if (index >= 0) pushedScopes.splice(index, 1)
    },
  }
}

/** The pushed scopes, the latest first. */
export function pushedKeyScopes(): readonly PushedKeyScope[] {
  return [...pushedScopes].reverse()
}

function keyRow(
  canvas: CanvasKeyCommand,
  shortcuts: readonly string[],
  options: Partial<Pick<KeymapRow, 'scope' | 'singleKey' | 'fallback'>> = {},
): KeymapRow {
  return {
    command: `canvas.${canvas.kind}`,
    canvas,
    chords: shortcuts.flatMap(chordsOfShortcut),
    scope: options.scope ?? 'canvas-focus',
    singleKey: options.singleKey ?? 'n/a',
    ...(options.fallback ? { fallback: options.fallback } : {}),
  }
}
