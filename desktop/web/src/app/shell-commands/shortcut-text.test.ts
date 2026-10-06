import { afterEach, describe, expect, it } from 'vitest'
import { ariaKeyShortcuts, formatShortcut, modKeyName, setShortcutPlatform } from './shortcut-text'
import { t } from '../../i18n'

afterEach(() => setShortcutPlatform({ os: 'linux' }))

describe('formatShortcut', () => {
  it("formatShortcut('Shift+ArrowLeft', t) reads 'Shift ←'", () => {
    expect(formatShortcut('Shift+ArrowLeft', t)).toBe('Shift ←')
    expect(formatShortcut('Shift+ArrowRight', t)).toBe('Shift →')
    expect(formatShortcut('Shift+ArrowUp', t)).toBe('Shift ↑')
    expect(formatShortcut('Ctrl+ArrowDown', t)).toBe('Ctrl ↓')
    // The glyphs need no translation; the modifier names follow the interface language.
    const french = (key: string) => ({ 'shortcutKeys.shift': 'Maj' })[key] ?? key
    expect(formatShortcut('Shift+ArrowLeft', french)).toBe('Maj ←')
    // aria-keyshortcuts keeps the key's own name.
    expect(ariaKeyShortcuts('Shift+ArrowLeft')).toBe('Shift+ArrowLeft')
  })

  it('on macOS mod reads Cmd', () => {
    const german = (key: string) => ({ 'shortcutKeys.ctrl': 'Strg', 'shortcutKeys.cmd': 'Cmd', 'shortcutKeys.shift': 'Umschalt' })[key] ?? key
    expect(formatShortcut('Ctrl+Shift+Z', german)).toBe('Strg Umschalt Z')
    expect(modKeyName(german)).toBe('Strg')

    setShortcutPlatform({ os: 'mac' })
    expect(formatShortcut('Ctrl+Shift+Z', t)).toBe('Cmd Shift Z')
    expect(formatShortcut('Ctrl+F', german)).toBe('Cmd F')
    expect(formatShortcut('Ctrl+ArrowRight', german)).toBe('Cmd →')
    expect(modKeyName(german)).toBe('Cmd')
    expect(modKeyName(t)).toBe('Cmd')
    // Keys without mod are unchanged, and aria-keyshortcuts already names both Control and Meta.
    expect(formatShortcut('Shift+N', t)).toBe('Shift N')
    expect(ariaKeyShortcuts('Ctrl+F')).toBe('Control+F Meta+F')
    // iPadOS keyboards use Cmd too.
    setShortcutPlatform({ os: 'ios' })
    expect(formatShortcut('Ctrl+K', t)).toBe('Cmd K')
    setShortcutPlatform({ os: 'windows' })
    expect(formatShortcut('Ctrl+K', t)).toBe('Ctrl K')
  })
})
