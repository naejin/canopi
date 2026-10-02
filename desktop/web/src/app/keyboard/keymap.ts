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
import { chordMatches, chordsOfShortcut, type KeyboardEventLike, type KeyChord } from './key-chord'

export type KeyScope =
  | 'global'          // every focus class except modal; in text only with worksInTextFields (every shell chord, Ctrl+K)
  | 'command'         // anywhere except text fields and dialogs: tool letters, [ ], N, Ctrl+V, Ctrl+Z…
  | 'view-arrows'     // like 'command', but not inside an arrow-owning widget
  | 'canvas-focus'    // the map host (not text or a control in it), or <body> after a press or focus on the map: arrows,
                      // Enter, F2, and the edits of the map's selection (Ctrl+C, Ctrl+A, Delete…)

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
  /** Also runs while a text field has focus: every shell row but a single key (F2 too), and Ctrl+K. */
  readonly worksInTextFields?: boolean
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

/**
 * The edits of the map's selection need the map, so a press on a dock panel's text or a dock control leaves the
 * browser's copy and select all to the page. `[` `]` stay with their `command` key rows (a held stamp turns); paste,
 * undo and redo run from any focus but a text field, as before phase F.
 */
const MAP_SELECTION_EDITS: ReadonlySet<CanvasCommandId> = new Set<CanvasCommandId>([
  'canvas.cut',
  'canvas.copy',
  'canvas.duplicateSelected',
  'canvas.deleteSelected',
  'canvas.selectAll',
  'canvas.selectSameSpecies',
  'canvas.groupSelected',
  'canvas.ungroupSelected',
  'canvas.rotateSelected',
  'canvas.lockSelected',
])

/** Both editions' canvas rows: the key commands, then each catalogue definition's shortcuts through the switch. */
export const CANVAS_KEYMAP_ROWS: readonly KeymapRow[] = [
  ...CANVAS_KEY_ROWS,
  ...canvasCommandDefinitions.flatMap((definition) => (definition.shortcuts ?? []).flatMap((shortcut): KeymapRow[] => {
    const scope: KeyScope = definition.worksInTextFields
      ? 'global'
      : MAP_SELECTION_EDITS.has(definition.commandId) ? 'canvas-focus' : 'command'
    // A chord a key row of the same scope falls back to the catalogue command with is that row's: `[` `]`, Backspace.
    const chords = chordsOfShortcut(shortcut).filter((chord) => !CANVAS_KEY_ROWS.some((row) =>
      row.scope === scope && row.fallback === definition.commandId
      && row.chords.some((rowChord) => chordMatches(rowChord, chord))))
    if (chords.length === 0) return []
    return [{
      command: definition.commandId,
      chords,
      scope,
      singleKey: isCharacterKeyShortcut(shortcut) ? 'follows-switch' : 'n/a',
      ...(definition.worksInTextFields ? { worksInTextFields: true } : {}),
    }]
  })),
]

/** F2 asks the map first (edit the selected note), so its shell row waits for the command step. */
const SHELL_COMMAND_SCOPE_ROWS: ReadonlySet<ShellCommandId> = new Set(['file.rename'])

/**
 * One edition's shell rows from its own catalogue (capability-filtered; Web omits the shortcuts a browser keeps). Each
 * edition composes [...shellKeymapRows(…), ...CANVAS_KEYMAP_ROWS]. Shell shortcuts work everywhere but a modal, text
 * fields included (a single key there types, so it would not).
 */
export function shellKeymapRows(
  catalog: readonly ShellCommandCatalogEntry[],
  options: { readonly omit?: ReadonlySet<string> } = {},
): readonly KeymapRow[] {
  return catalog.flatMap((command): KeymapRow[] => {
    const shortcut = command.shortcut
    if (!shortcut || options.omit?.has(shortcut)) return []
    const singleKey = isCharacterKeyShortcut(shortcut)
    return [{
      command: command.id,
      chords: chordsOfShortcut(shortcut),
      scope: SHELL_COMMAND_SCOPE_ROWS.has(command.id) ? 'command' : 'global',
      singleKey: singleKey ? 'follows-switch' : 'n/a',
      ...(singleKey ? {} : { worksInTextFields: true }),
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
