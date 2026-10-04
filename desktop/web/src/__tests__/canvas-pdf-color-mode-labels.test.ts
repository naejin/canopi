import { readFileSync } from 'node:fs'
import { create, type Font } from 'fontkit'
import { describe, expect, it } from 'vitest'

// The plant-colour segmented control sits in the 280 px export sheet (12 px padding each side):
// three content-sized segments at 13 px, 8 px padding each side and a 1 px border between.
const SHEET_CONTENT_PX = 280 - 2 * 12
const SEGMENT_CHROME_PX = 3 * (2 * 8) + 4
const FONT_SIZE_PX = 13
const LOCALES = ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'ru'] as const

function sourceSans(subset: 'latin' | 'latin-ext' | 'cyrillic'): Font {
  return create(readFileSync(`node_modules/@fontsource/source-sans-3/files/source-sans-3-${subset}-600-normal.woff`)) as Font
}

describe('PDF plant colour modes', () => {
  const fonts = [sourceSans('latin'), sourceSans('latin-ext'), sourceSans('cyrillic')]
  const width = (text: string) => Array.from(text).reduce((sum, char) => {
    const font = fonts.find((candidate) => candidate.hasGlyphForCodePoint(char.codePointAt(0)!)) ?? fonts[0]!
    return sum + font.layout(char).advanceWidth * FONT_SIZE_PX / font.unitsPerEm
  }, 0)

  it.each(LOCALES)('fit on one line each, selected (600), in the export sheet (%s)', (locale) => {
    const modes = (JSON.parse(readFileSync(`src/i18n/${locale}.json`, 'utf8')) as { pdf: { plantColorModes: Record<string, string> } })
      .pdf.plantColorModes
    const labels = [modes.design!, modes.grayscale!, modes.black!]
    const total = labels.reduce((sum, label) => sum + width(label), 0)
    expect(total + SEGMENT_CHROME_PX, labels.join(' | ')).toBeLessThanOrEqual(SHEET_CONTENT_PX)
  })
})
