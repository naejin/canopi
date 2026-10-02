import { describe, expect, it } from 'vitest'
import { keyLike } from '../../__tests__/support/key-router'
import { chordMatches, chordOf, chordsOfShortcut, type KeyboardEventLike } from './key-chord'

/** Whether a press is the catalogue shortcut. */
function pressMatches(shortcut: string, press: KeyboardEventLike): boolean {
  const chord = chordOf(press)
  return chord !== null && chordsOfShortcut(shortcut).some((row) => chordMatches(row, chord))
}

describe('key chords', () => {
  it('names letters in lower case and Ctrl or Cmd as one modifier', () => {
    expect(chordOf(keyLike('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ key: 'z', mod: true, ctrl: false, shift: true, alt: false })
    expect(chordOf(keyLike('z', { metaKey: true }))).toEqual({ key: 'z', mod: true, ctrl: false, shift: false, alt: false })
    expect(chordOf(keyLike('ArrowLeft'))).toEqual({ key: 'ArrowLeft', mod: false, ctrl: false, shift: false, alt: false })
    // Ctrl and Cmd together name no shortcut.
    expect(chordOf(keyLike('z', { ctrlKey: true, metaKey: true }))).toBeNull()
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
