// app/keyboard/key-chord.ts
//
// Owns what a key press names (spec §1.6): the KeyboardEvent fields the key router reads, as a literal-friendly
// interface, and the chord a press or a catalogue shortcut string (`Ctrl+Shift+Z`, see shell-commands/shortcut-text.ts)
// stands for. Ctrl and Cmd are one modifier, `mod`, as the catalogue has always matched them.

/** The KeyboardEvent fields the router reads; tests pass literals. */
export interface KeyboardEventLike {
  readonly type: 'keydown' | 'keyup'
  readonly key: string; readonly code: string; readonly keyCode: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean
  readonly repeat: boolean; readonly isComposing: boolean; readonly defaultPrevented: boolean
  readonly cancelable: boolean; readonly timeStamp: number
  readonly target: EventTarget | null
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
}

/** `mod` is Ctrl or Cmd; `ctrl` a physical Ctrl that is not `mod`. Letters are lower case; named keys keep their name. */
export interface KeyChord { readonly key: string; readonly mod: boolean; readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean }

/** Keys a chord matches by the character produced, whatever Shift did to produce it (US Shift+= is `+`). */
const SHIFT_FREE_KEYS: ReadonlySet<string> = new Set(['+', '='])

/** The chord a press names; null when Ctrl and Cmd are both down, which no shortcut means. */
export function chordOf(e: KeyboardEventLike): KeyChord | null {
  if (e.ctrlKey && e.metaKey) return null
  let key = chordKey(e.key)
  // Option on macOS types another character (⌘⌥R types ®): with Cmd, the letter comes from the physical key.
  if (e.altKey && e.metaKey && !/^[a-z]$/.test(key) && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
  return { key, mod: e.ctrlKey || e.metaKey, ctrl: false, shift: e.shiftKey, alt: e.altKey }
}

/**
 * The chords a catalogue shortcut string stands for: `Ctrl` is `mod`; `Plus` is `+` or `=` (Shift ignored), `Minus`
 * is `-` or `_` without Shift.
 */
export function chordsOfShortcut(shortcut: string): readonly KeyChord[] {
  const parts = shortcut.split('+')
  const name = parts.at(-1) ?? ''
  const base = { mod: parts.includes('Ctrl'), ctrl: false, shift: parts.includes('Shift'), alt: parts.includes('Alt') }
  if (name === 'Plus') return [{ ...base, key: '+' }, { ...base, key: '=' }]
  if (name === 'Minus') return [{ ...base, key: '-', shift: false }, { ...base, key: '_', shift: false }]
  return [{ ...base, key: chordKey(name) }]
}

/** Whether a press's chord is a row's chord. */
export function chordMatches(row: KeyChord, press: KeyChord): boolean {
  return row.key === press.key
    && row.mod === press.mod
    && row.ctrl === press.ctrl
    && row.alt === press.alt
    && (row.shift === press.shift || SHIFT_FREE_KEYS.has(row.key))
}

function chordKey(key: string): string {
  return [...key].length === 1 ? key.toLowerCase() : key
}
