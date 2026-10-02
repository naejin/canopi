/**
 * Shortcut strings shared by every command catalog. A shortcut is written
 * `Ctrl+Shift+Z`: modifiers (`Ctrl` means Ctrl or Cmd, `Shift`, `Alt`) then one
 * key. `Plus` and `Minus` name the zoom keys so the separator stays unambiguous.
 */

interface ParsedShortcut {
  readonly ctrl: boolean
  readonly shift: boolean
  readonly alt: boolean
  readonly key: string
}

/** Keys whose shown name is a word the interface language may change ("Maj", "Suppr", "Strg"). */
const KEY_NAME_KEYS: Readonly<Record<string, string>> = {
  Ctrl: 'shortcutKeys.ctrl',
  Shift: 'shortcutKeys.shift',
  Alt: 'shortcutKeys.alt',
  Delete: 'shortcutKeys.delete',
  Escape: 'shortcutKeys.escape',
}

const ENGLISH_KEY_NAMES: Readonly<Record<string, string>> = {
  Ctrl: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Delete: 'Del',
  Escape: 'Esc',
  Plus: '+',
  Minus: '\u2212',
}

const ARIA_KEYS: Readonly<Record<string, string>> = {
  Plus: '=',
  Minus: '-',
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
 * `Ctrl+Shift+Z` → `Ctrl Shift Z`, as menus and tooltips show it. With a
 * translator, key names follow the interface language (`Ctrl Maj Z`).
 */
export function formatShortcut(shortcut: string, translate?: (key: string) => string): string {
  const parsed = parseShortcut(shortcut)
  const name = (key: string) => {
    const translationKey = KEY_NAME_KEYS[key]
    return translate && translationKey ? translate(translationKey) : ENGLISH_KEY_NAMES[key] ?? key
  }
  return [
    parsed.ctrl ? name('Ctrl') : null,
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
