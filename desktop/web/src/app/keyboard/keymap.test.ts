import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keyLike } from '../../__tests__/support/key-router'
import { DESKTOP_KEYMAP } from '../../commands/graph/shortcuts'
import { createBrowserShellCatalog } from '../../web/browser-shell-commands'
import { canvasCommandDefinitions } from '../canvas-commands'
import { composeShellCommandCatalog } from '../shell-commands'
import { chordMatches, chordOf, chordsOfShortcut, type KeyboardEventLike } from './key-chord'
import { installKeyRouter, type KeyRouterHandle } from './key-router'
import { CANVAS_KEYMAP_ROWS, shellKeymapRows, type KeymapRow } from './keymap'

/** The rows a press names, in keymap order. */
function rowsFor(rows: readonly KeymapRow[], press: KeyboardEventLike): readonly KeymapRow[] {
  const chord = chordOf(press)
  return chord ? rows.filter((row) => row.chords.some((rowChord) => chordMatches(rowChord, chord))) : []
}

/** The catalogue command a press names among the canvas rows: a command row's, else a key row's fallback. */
function canvasCommandFor(press: KeyboardEventLike): string | null {
  const rows = rowsFor(CANVAS_KEYMAP_ROWS, press)
  const row = rows.find((candidate) => !candidate.canvas) ?? rows.find((candidate) => candidate.fallback)
  return row ? (row.canvas ? row.fallback! : row.command) : null
}

function webKeymap(): readonly KeymapRow[] {
  const catalog = createBrowserShellCatalog({
    newDesign: vi.fn(), openCanopi: vi.fn(), downloadCanopi: vi.fn(), revertDesign: vi.fn(),
    importGeoJson: vi.fn(), exportGeoJson: vi.fn(), exportBudgetCsv: vi.fn(), closeDesign: vi.fn(), navigate: vi.fn(),
  }, { templatesEnabled: true, canvasReady: () => true })
  // Without the shortcuts a browser keeps, which the Web omits: a superset of its keymap.
  return [...shellKeymapRows(catalog), ...CANVAS_KEYMAP_ROWS]
}

let router: KeyRouterHandle | null = null

afterEach(() => {
  router?.dispose()
  router = null
  document.body.replaceChildren()
})

describe('keymap', () => {
  it('single keys follow the switch', () => {
    const singleKey = (press: KeyboardEventLike) => rowsFor(CANVAS_KEYMAP_ROWS, press).map((row) => row.singleKey)

    expect(singleKey(keyLike('v'))).toEqual(['follows-switch'])
    expect(singleKey(keyLike('n'))).toEqual(['follows-switch'])
    expect(singleKey(keyLike('G', { shiftKey: true }))).toEqual(['follows-switch'])
    expect(singleKey(keyLike('F', { shiftKey: true }))).toEqual(['follows-switch'])
    // A held stamp's turn follows it too, and still runs on the focused map with it off (the router's rule).
    expect(singleKey(keyLike(']'))).toEqual(['follows-switch'])
    expect(singleKey(keyLike('z', { ctrlKey: true }))).toEqual(['n/a'])
    expect(singleKey(keyLike('0', { ctrlKey: true }))).toEqual(['n/a'])
    expect(singleKey(keyLike('Delete'))).toEqual(['n/a'])
    expect(singleKey(keyLike('ArrowLeft'))).toEqual(['n/a'])
    expect(singleKey(keyLike('Enter'))).toEqual(['n/a'])
  })

  it('command rows run outside text fields and dialogs', () => {
    const run = vi.fn(() => true)
    let modal = false
    router = installKeyRouter({
      target: window,
      keymap: CANVAS_KEYMAP_ROWS,
      commands: { run },
      canvas: () => null,
      singleKeys: signal(true),
      focus: { cycleRegion: () => false },
      isModalOpen: () => modal,
    })
    const press = (target: EventTarget) => {
      const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const button = document.createElement('button')
    const list = document.createElement('div')
    const field = document.createElement('input')
    const area = document.createElement('textarea')
    document.body.append(button, list, field, area)

    expect([press(window), press(button), press(list)]).toEqual([true, true, true])
    expect(run).toHaveBeenCalledTimes(3)
    expect(run).toHaveBeenCalledWith('canvas.tool.select')
    expect([press(field), press(area)]).toEqual([false, false])
    modal = true
    expect(press(button)).toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('each platform\'s keymap has one row per chord', () => {
    for (const keymap of [DESKTOP_KEYMAP, webKeymap()]) {
      const seen = new Map<string, string>()
      const duplicates: string[] = []
      for (const row of keymap) {
        for (const chord of row.chords) {
          const id = `${row.scope} ${JSON.stringify(chord)}`
          const other = seen.get(id)
          if (other) duplicates.push(`${id}: ${other} and ${row.command}`)
          seen.set(id, row.command)
        }
      }
      expect(duplicates).toEqual([])
    }
    expect(rowsFor(shellKeymapRows([], { omit: new Set(['Ctrl+1']) }), keyLike('1', { ctrlKey: true }))).toEqual([])
    expect(rowsFor(DESKTOP_KEYMAP, keyLike('1', { ctrlKey: true })).map((row) => row.command)).toEqual(['nav.layers'])
  })

  it('canvas rows come from definition.shortcuts through the switch, never from keyHint; no row has Escape', () => {
    for (const definition of canvasCommandDefinitions) {
      for (const shortcut of definition.shortcuts ?? []) {
        const named = CANVAS_KEYMAP_ROWS.some((row) =>
          (row.command === definition.commandId || row.fallback === definition.commandId)
          && chordsOfShortcut(shortcut).every((chord) => row.chords.some((rowChord) => chordMatches(rowChord, chord))))
        expect(named, `${definition.commandId} ${shortcut}`).toBe(true)
      }
    }
    expect(CANVAS_KEYMAP_ROWS.flatMap((row) => row.chords).some((chord) => chord.key === 'Escape')).toBe(false)
    expect(CANVAS_KEYMAP_ROWS.some((row) => row.command === 'canvas.clearSelection')).toBe(false)

    expect(canvasCommandFor(keyLike('z'))).toBe('canvas.tool.polygon')
    expect(canvasCommandFor(keyLike('z', { ctrlKey: true }))).toBe('edit.undo')
    expect(canvasCommandFor(keyLike('Z', { metaKey: true, shiftKey: true }))).toBe('edit.redo')
    expect(canvasCommandFor(keyLike('y', { ctrlKey: true }))).toBe('edit.redo')
    expect(canvasCommandFor(keyLike('z', { ctrlKey: true, metaKey: true }))).toBeNull()
    expect(canvasCommandFor(keyLike('z', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(canvasCommandFor(keyLike('G', { shiftKey: true }))).toBe('canvas.toggleGrid')
    expect(canvasCommandFor(keyLike('g', { ctrlKey: true }))).toBe('canvas.groupSelected')
    expect(canvasCommandFor(keyLike('G', { ctrlKey: true, shiftKey: true }))).toBe('canvas.ungroupSelected')
    expect(canvasCommandFor(keyLike('F', { shiftKey: true }))).toBe('view.fitToDesign')
    expect(canvasCommandFor(keyLike('0', { ctrlKey: true }))).toBe('view.fitToDesign')
    expect(canvasCommandFor(keyLike('=', { ctrlKey: true }))).toBe('view.zoomIn')
    expect(canvasCommandFor(keyLike('+', { ctrlKey: true, shiftKey: true }))).toBe('view.zoomIn')
    expect(canvasCommandFor(keyLike('-', { ctrlKey: true }))).toBe('view.zoomOut')
    expect(canvasCommandFor(keyLike('k', { ctrlKey: true }))).toBe('view.searchPlace')
    expect(canvasCommandFor(keyLike('f', { ctrlKey: true }))).toBeNull()
    expect(canvasCommandFor(keyLike('A', { ctrlKey: true, shiftKey: true }))).toBe('canvas.selectSameSpecies')
    expect(canvasCommandFor(keyLike('Backspace'))).toBe('canvas.deleteSelected')
    expect(canvasCommandFor(keyLike('E', { shiftKey: true }))).toBeNull()
    expect(canvasCommandFor(keyLike('r', { ctrlKey: true, altKey: true, code: 'KeyR' }))).toBe('canvas.rotateSelected')
    expect(canvasCommandFor(keyLike('r', { ctrlKey: true }))).toBeNull()
    expect(canvasCommandFor(keyLike(']'))).toBe('canvas.bringToFront')
    expect(canvasCommandFor(keyLike('['))).toBe('canvas.sendToBack')
    expect(canvasCommandFor(keyLike('Escape'))).toBeNull()
  })

  it('composes an edition\'s shell rows from its catalogue, F2 after the map and the text-field rows marked', () => {
    const execute = () => undefined
    const catalog = composeShellCommandCatalog({
      saveDesignAs: { execute },
      navigateCanvas: { execute },
      navigatePlantDatabase: { execute },
      renameDesign: { execute },
      saveDesign: { execute },
      showShortcuts: { execute },
    })
    const rows = shellKeymapRows(catalog)
    const command = (press: KeyboardEventLike) => rowsFor(rows, press).map((row) => row.command)

    expect(command(keyLike('S', { metaKey: true, shiftKey: true }))).toEqual(['file.saveAs'])
    expect(command(keyLike('3', { ctrlKey: true }))).toEqual(['nav.plantDb'])
    expect(command(keyLike('2', { ctrlKey: true }))).toEqual([])
    expect(command(keyLike('3', { ctrlKey: true, altKey: true }))).toEqual([])
    expect(command(keyLike('s', { ctrlKey: true, metaKey: true }))).toEqual([])
    expect(command(keyLike('3'))).toEqual([])
    expect(rows.find((row) => row.command === 'file.rename')?.scope).toBe('command')
    expect(rows.filter((row) => row.worksInTextFields).map((row) => row.command)).toEqual(['file.save', 'help.shortcuts'])
    expect(rows.every((row) => !row.worksInModal)).toBe(true)
  })
})
