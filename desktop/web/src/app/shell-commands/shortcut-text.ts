/**
 * Shortcut strings shared by every command catalog. A shortcut is written
 * `Ctrl+Shift+Z`: modifiers (`Ctrl` means Ctrl or Cmd, `Shift`, `Alt`) then one
 * key. `Plus` and `Minus` name the zoom keys so the separator stays unambiguous.
 * Labels read Cmd for `Ctrl` on macOS (U13): each edition tells this module its
 * platform once, at the point where it detects it (setShortcutPlatform).
 */

import { signal } from '@preact/signals'
import { modKeyIsCmd, type InputPlatform } from '../../canvas/runtime/input/platform'

interface ParsedShortcut {
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly key: string
}

/** Keys whose shown name is a word the interface language may change ("Maj", "Suppr", "Strg"). */
const KEY_NAME_KEYS: Readonly<Record<string, string>> = {
  Ctrl: 'shortcutKeys.ctrl',
  Cmd: 'shortcutKeys.cmd',
  Shift: 'shortcutKeys.shift',
  Alt: 'shortcutKeys.alt',
  Delete: 'shortcutKeys.delete',
  Escape: 'shortcutKeys.escape',
}

const ENGLISH_KEY_NAMES: Readonly<Record<string, string>> = {
  Ctrl: 'Ctrl',
  Cmd: 'Cmd',
  Shift: 'Shift',
  Alt: 'Alt',
  Delete: 'Del',
  Escape: 'Esc',
  Plus: '+',
  Minus: '\u2212',
  ArrowLeft: '\u2190',
  ArrowUp: '\u2191',
  ArrowRight: '\u2192',
  ArrowDown: '\u2193',
}

const ARIA_KEYS: Readonly<Record<string, string>> = {
  Plus: '=',
  Minus: '-',
}

/** Whether the mod key is Cmd (macOS, and iPadOS keyboards, as the key router's chord rule reads them). A signal, so
 *  menus and tooltips computed from it follow a late call. */
const modIsCmd = signal(false)

/** The platform whose mod key the labels name; Ctrl until an edition calls it. */
export function setShortcutPlatform(platform: Pick<InputPlatform, 'os'>): void {
  modIsCmd.value = modKeyIsCmd(platform)
}

/** The mod key's name: Cmd on macOS, else Ctrl, in the interface language with a translator. It fills `{{mod}}`. */
export function modKeyName(translate?: (key: string) => string): string {
  return keyName(modIsCmd.value ? 'Cmd' : 'Ctrl', translate)
}

function keyName(key: string, translate?: (key: string) => string): string {
  const translationKey = KEY_NAME_KEYS[key]
  return translate && translationKey ? translate(translationKey) : ENGLISH_KEY_NAMES[key] ?? key
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+')
  const key = parts.at(-1) ?? ''
  return {
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key,
  }
}

/**
 * `Ctrl+Shift+Z` → `Ctrl Shift Z`, as menus and tooltips show it, or `Cmd Shift Z`
 * on macOS. With a translator, key names follow the interface language
 * (`Ctrl Maj Z`). Arrow keys read as glyphs (`Shift+ArrowLeft` → `Shift ←`).
 */
export function formatShortcut(shortcut: string, translate?: (key: string) => string): string {
  const parsed = parseShortcut(shortcut)
  const name = (key: string) => keyName(key, translate)
  return [
    parsed.ctrl ? modKeyName(translate) : null,
    parsed.alt ? name('Alt') : null,
    parsed.shift ? name('Shift') : null,
    name(parsed.key),
  ].filter(Boolean).join(' ')
}

/** `Ctrl+Shift+Z` → `Control+Shift+Z Meta+Shift+Z` for `aria-keyshortcuts`. */
export function ariaKeyShortcuts(shortcut: string): string {
  const parsed = parseShortcut(shortcut)
  const key = ARIA_KEYS[parsed.key] ?? parsed.key
  const rest = [parsed.alt ? 'Alt' : null, parsed.shift ? 'Shift' : null, key]
    .filter(Boolean)
    .join('+')
  return parsed.ctrl ? `Control+${rest} Meta+${rest}` : rest
}

/**
 * A character key alone or with Shift (V, N, ], Shift G). Settings › Keyboard
 * can turn these off, so they never fire while someone types or dictates;
 * named keys (Delete, Esc, arrows, F keys) and Ctrl or Alt shortcuts stay.
 */
export function isCharacterKeyShortcut(shortcut: string): boolean {
  const parsed = parseShortcut(shortcut)
  return !parsed.ctrl && !parsed.alt && [...parsed.key].length === 1
}
