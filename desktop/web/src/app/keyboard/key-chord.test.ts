import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { keyLike } from '../../__tests__/support/key-router'
import type { InputPlatform } from '../../canvas/runtime/input/platform'
import { composeShellCommandCatalog } from '../shell-commands'
import { chordMatches, chordOf, chordsOfShortcut, type KeyboardEventLike } from './key-chord'
import { installKeyRouter } from './key-router'
import { CANVAS_KEYMAP_ROWS, shellKeymapRows } from './keymap'

/** Whether a press is the catalogue shortcut. */
function pressMatches(shortcut: string, press: KeyboardEventLike): boolean {
  const chord = chordOf(press, { os: press.metaKey ? 'mac' : 'linux' })
  return chord !== null && chordsOfShortcut(shortcut).some((row) => chordMatches(row, chord))
}

describe('key chords', () => {
  it('names letters in lower case, and Ctrl (Cmd on a Mac) as mod', () => {
    expect(chordOf(keyLike('Z', { ctrlKey: true, shiftKey: true }), { os: 'linux' })).toEqual({ key: 'z', mod: true, ctrl: false, shift: true, alt: false })
    expect(chordOf(keyLike('z', { metaKey: true }), { os: 'mac' })).toEqual({ key: 'z', mod: true, ctrl: false, shift: false, alt: false })
    expect(chordOf(keyLike('ArrowLeft'), { os: 'linux' })).toEqual({ key: 'ArrowLeft', mod: false, ctrl: false, shift: false, alt: false })
    // Ctrl and Cmd together name no shortcut.
    expect(chordOf(keyLike('z', { ctrlKey: true, metaKey: true }), { os: 'linux' })).toBeNull()
  })

  it('reads catalogue shortcuts, with Plus and Minus as the zoom keys', () => {
    expect(chordsOfShortcut('Ctrl+Shift+Z')).toEqual([{ key: 'z', mod: true, ctrl: false, shift: true, alt: false }])
    expect(chordsOfShortcut('Shift+F10')).toEqual([{ key: 'F10', mod: false, ctrl: false, shift: true, alt: false }])
    expect(chordsOfShortcut('Ctrl+Plus').map((chord) => chord.key)).toEqual(['+', '='])
    expect(chordsOfShortcut('Ctrl+Minus').map((chord) => chord.key)).toEqual(['-', '_'])
  })

  it('matches single keys, Shift toggles and Ctrl edits without confusing them', () => {
    expect(pressMatches('Z', keyLike('z'))).toBe(true)
    expect(pressMatches('Z', keyLike('z', { ctrlKey: true }))).toBe(false)
    expect(pressMatches('Ctrl+Z', keyLike('z', { ctrlKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Shift+Z', keyLike('Z', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Z', keyLike('z', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(pressMatches('Shift+G', keyLike('G', { shiftKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+G', keyLike('g', { ctrlKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Shift+G', keyLike('g', { ctrlKey: true }))).toBe(false)
    expect(pressMatches('Ctrl+0', keyLike('0', { ctrlKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Plus', keyLike('=', { ctrlKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Plus', keyLike('+', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(pressMatches('Ctrl+Minus', keyLike('-', { ctrlKey: true }))).toBe(true)
    expect(pressMatches('Shift+E', keyLike('E', { shiftKey: true }))).toBe(true)
    expect(pressMatches('E', keyLike('E', { shiftKey: true }))).toBe(false)
    expect(pressMatches('Ctrl+Alt+R', keyLike('r', { ctrlKey: true, altKey: true, code: 'KeyR' }))).toBe(true)
    expect(pressMatches('Ctrl+Alt+R', keyLike('r', { ctrlKey: true }))).toBe(false)
    // macOS Option changes the character (⌘⌥R is ®); the physical key still names the shortcut.
    expect(pressMatches('Ctrl+Alt+R', keyLike('®', { metaKey: true, altKey: true, code: 'KeyR' }))).toBe(true)
    // AltGr (Ctrl Alt) typing a character on Windows or Linux is not the shortcut.
    expect(pressMatches('Ctrl+Alt+R', keyLike('¶', { ctrlKey: true, altKey: true, code: 'KeyR' }))).toBe(false)
    expect(pressMatches('Ctrl+1', keyLike('1', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})

const LINUX = { os: 'linux' } as const
const MAC = { os: 'mac' } as const

/** The command a press runs through a router over one platform's keymap: a few shell rows and the canvas rows. */
function commandFor(
  press: Partial<KeyboardEventInit> & { readonly key: string },
  options: { readonly platform?: Pick<InputPlatform, 'os'>, readonly singleKeys?: boolean, readonly web?: boolean } = {},
): string | null {
  const execute = () => undefined
  const catalog = composeShellCommandCatalog({
    saveDesign: { execute },
    closeDesign: { execute },
    navigateLayers: { execute },
    navigateSpeciesKey: { execute },
  })
  const ran: string[] = []
  const host = document.createElement('div')
  host.tabIndex = 0
  document.body.append(host)
  const router = installKeyRouter({
    target: window,
    keymap: [...shellKeymapRows(catalog, options.web ? { omit: new Set(['Ctrl+W', 'Ctrl+1', 'Ctrl+2']) } : {}), ...CANVAS_KEYMAP_ROWS],
    commands: { run: (command) => { ran.push(command); return true } },
    canvas: () => null,
    singleKeys: signal(options.singleKeys ?? true),
    focus: { cycleRegion: () => false },
    isModalOpen: () => false,
    platform: { engine: 'chromium', gestureEvents: false, ...(options.platform ?? LINUX) },
    document,
  })
  try {
    host.focus()
    host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...press }))
  } finally {
    router.dispose()
    host.remove()
  }
  return ran[0] ?? null
}

describe('layouts (spec §5.8)', () => {
  it.each([
    ['H1 AZERTY Ctrl+Z', { key: 'z', code: 'KeyW', ctrlKey: true }, {}, 'edit.undo'],
    ['H2 AZERTY physical Z', { key: 'w', code: 'KeyZ', ctrlKey: true }, { web: true }, null],
    ['H3 QWERTZ Ctrl+Z', { key: 'z', code: 'KeyY', ctrlKey: true }, {}, 'edit.undo'],
    ['H3 QWERTZ Ctrl+Y', { key: 'y', code: 'KeyZ', ctrlKey: true }, {}, 'edit.redo'],
    ['H4 Russian Ctrl+Z', { key: 'я', code: 'KeyZ', ctrlKey: true }, {}, 'edit.undo'],
    ['H5 Russian single key', { key: 'м', code: 'KeyV' }, {}, 'canvas.tool.select'],
    ['H6 AZERTY Ctrl+1', { key: '&', code: 'Digit1', ctrlKey: true }, {}, 'nav.layers'],
    ['H7 AZERTY Ctrl+Shift+1', { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true }, {}, 'nav.layers'],
    ['AZERTY Ctrl+é', { key: 'é', code: 'Digit2', ctrlKey: true }, {}, 'nav.speciesKey'],
    ['AZERTY Ctrl+- keeps zoom out', { key: '-', code: 'Digit6', ctrlKey: true }, {}, 'view.zoomOut'],
    ['Czech Ctrl++ keeps zoom in', { key: '+', code: 'Digit1', ctrlKey: true, shiftKey: true }, {}, 'view.zoomIn'],
    ['H8 AltGr', { key: '@', code: 'Digit0', ctrlKey: true, altKey: true }, {}, null],
    ['AltGr types a character', { key: '¶', code: 'KeyR', ctrlKey: true, altKey: true }, {}, null],
    ['Ctrl+Alt+R', { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }, {}, 'canvas.rotateSelected'],
    ['H9 macOS Cmd+Option+R', { key: '®', code: 'KeyR', metaKey: true, altKey: true }, { platform: MAC }, 'canvas.rotateSelected'],
    ['macOS Cmd+Z', { key: 'z', code: 'KeyZ', metaKey: true }, { platform: MAC }, 'edit.undo'],
    ['macOS Ctrl+Z is not Cmd+Z', { key: 'z', code: 'KeyZ', ctrlKey: true }, { platform: MAC }, null],
    ['Windows key+Z is no shortcut', { key: 'z', code: 'KeyZ', metaKey: true }, {}, null],
    ['ja direct input Ctrl+Z', { key: 'z', code: 'KeyZ', ctrlKey: true }, {}, 'edit.undo'],
    ['ja IME composing', { key: 'z', code: 'KeyZ', isComposing: true }, {}, null],
    ['H12 single keys off', { key: 'v', code: 'KeyV' }, { singleKeys: false }, null],
    ['H13 Web reserved Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true }, { web: true }, null],
    ['Russian bracket', { key: 'ъ', code: 'BracketRight' }, {}, 'canvas.bringToFront'],
    ['Turkish ğ is a letter, not [', { key: 'ğ', code: 'BracketLeft' }, {}, null],
  ] as const)('%s', (_name, press, options, expected) => {
    expect(commandFor(press, options)).toBe(expected)
  })

  it('reads the Mac chord rule: Cmd is mod, a physical Ctrl stays ctrl', () => {
    expect(chordOf(keyLike('z', { metaKey: true }), MAC)).toMatchObject({ key: 'z', mod: true, ctrl: false })
    expect(chordOf(keyLike('z', { ctrlKey: true }), MAC)).toMatchObject({ key: 'z', mod: false, ctrl: true })
    expect(chordOf(keyLike('z', { ctrlKey: true }), LINUX)).toMatchObject({ key: 'z', mod: true, ctrl: false })
    expect(chordOf(keyLike('z', { metaKey: true }), LINUX)).toBeNull()
  })
})
