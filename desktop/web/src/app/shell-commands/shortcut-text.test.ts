import { describe, expect, it } from 'vitest'
import { ariaKeyShortcuts, formatShortcut } from './shortcut-text'

describe('formatShortcut', () => {
  it("formatShortcut('Shift+ArrowLeft') reads 'Shift ←'", () => {
    expect(formatShortcut('Shift+ArrowLeft')).toBe('Shift ←')
    expect(formatShortcut('Shift+ArrowRight')).toBe('Shift →')
    expect(formatShortcut('Shift+ArrowUp')).toBe('Shift ↑')
    expect(formatShortcut('Ctrl+ArrowDown')).toBe('Ctrl ↓')
    // The glyphs need no translation; the modifier names follow the interface language.
    const french = (key: string) => ({ 'shortcutKeys.shift': 'Maj' })[key] ?? key
    expect(formatShortcut('Shift+ArrowLeft', french)).toBe('Maj ←')
    // aria-keyshortcuts keeps the key's own name.
    expect(ariaKeyShortcuts('Shift+ArrowLeft')).toBe('Shift+ArrowLeft')
  })
})
