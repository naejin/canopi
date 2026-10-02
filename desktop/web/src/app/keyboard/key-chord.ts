// app/keyboard/key-chord.ts
//
// Owns what a key press names (spec §1.6, fixtures H1–H13): the KeyboardEvent fields the key router reads, as a
// literal-friendly interface, and the chord a press or a catalogue shortcut string (`Ctrl+Shift+Z`, see
// shell-commands/shortcut-text.ts) stands for. `mod` is Cmd on a Mac and Ctrl elsewhere; a non-Latin layout's letters
// and brackets fall back to the physical key, a layout's digit row to its digits, and AltGr typing a character names
// no shortcut.

import type { InputPlatform } from '../../canvas/runtime/input/platform'

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

/** mod = Cmd on Mac, Ctrl elsewhere. A physical Ctrl on Mac is `ctrl`, never `mod`. Letters are lower case; named keys
 *  keep their name. */
export interface KeyChord { readonly key: string; readonly mod: boolean; readonly ctrl: boolean; readonly shift: boolean; readonly alt: boolean }

/** Keys a chord matches by the character produced, whatever Shift did to produce it (US Shift+= is `+`). */
const SHIFT_FREE_KEYS: ReadonlySet<string> = new Set(['+', '='])

/** The keys whose physical position names them when the layout types another script there (Russian я on KeyZ). */
const CODE_KEYS: Readonly<Record<string, string>> = { BracketLeft: '[', BracketRight: ']' }

/**
 * The chord a press names. Letters and brackets typed in a non-Latin script fall back to `event.code` (Russian Ctrl+я
 * is Ctrl+Z; macOS Option's ® on R is R); a Latin label wins over its position (AZERTY's Z key is Z). Null for the OS key
 * outside a Mac and for AltGr (Ctrl+Alt) typing a symbol.
 */
export function chordOf(e: KeyboardEventLike, platform: Pick<InputPlatform, 'os'>): KeyChord | null {
  const mac = platform.os === 'mac' || platform.os === 'ios'
  if (!mac && e.metaKey) return null
  if (!mac && e.ctrlKey && e.altKey && [...e.key].length === 1 && !/[\p{L}\p{N}]/u.test(e.key)) return null
  return {
    key: chordKey(e),
    mod: mac ? e.metaKey : e.ctrlKey,
    ctrl: mac && e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  }
}

/**
 * The digit a layout's digit row names when its label is not a digit (AZERTY Ctrl+& is Ctrl+1). The router tries it only
 * when no row matches the label, so a label of its own keeps its row (AZERTY Ctrl+- zooms out).
 */
export function digitChordOf(chord: KeyChord, e: KeyboardEventLike): KeyChord | null {
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1]
  return digit !== undefined && !/^[0-9]$/.test(chord.key) ? { ...chord, key: digit } : null
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
  return [{ ...base, key: shortcutKey(name) }]
}

/** Whether a press's chord is a row's chord. A mod+digit row ignores Shift, which AZERTY needs to type a digit. */
export function chordMatches(row: KeyChord, press: KeyChord): boolean {
  return row.key === press.key
    && row.mod === press.mod
    && row.ctrl === press.ctrl
    && row.alt === press.alt
    && (row.shift === press.shift || SHIFT_FREE_KEYS.has(row.key) || (row.mod && /^[0-9]$/.test(row.key)))
}

function chordKey(e: Pick<KeyboardEventLike, 'key' | 'code'>): string {
  const label = shortcutKey(e.key)
  // A character of another script than Latin (Cyrillic я, macOS Option's ®): the physical key names it. A Latin label,
  // accented or not, keeps its own name (Turkish ğ is a letter there, not a bracket).
  if ([...e.key].length !== 1 || e.key.charCodeAt(0) < 0x80 || /\p{Script=Latin}/u.test(e.key)) return label
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  return CODE_KEYS[e.code] ?? label
}

function shortcutKey(key: string): string {
  return [...key].length === 1 ? key.toLowerCase() : key
}
