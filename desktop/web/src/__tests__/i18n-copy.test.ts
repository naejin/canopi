import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import fr from '../i18n/fr.json'
import itLocale from '../i18n/it.json'
import ja from '../i18n/ja.json'
import ko from '../i18n/ko.json'
import nl from '../i18n/nl.json'
import pt from '../i18n/pt.json'
import ru from '../i18n/ru.json'
import zh from '../i18n/zh.json'

interface TranslationTree {
  [key: string]: string | TranslationTree
}

const locales: Record<string, TranslationTree> = { en, de, es, fr, it: itLocale, ja, ko, nl, pt, ru, zh }

function flatten(tree: TranslationTree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries.set(path, value)
    else for (const [child, text] of flatten(value, path)) entries.set(child, text)
  }
  return entries
}

const flat = Object.fromEntries(Object.entries(locales).map(([code, tree]) => [code, flatten(tree)]))
const english = flatten(en)

/**
 * Width in Latin-character units: CJK, kana, Hangul and full-width forms are about twice as wide
 * as a Latin letter in the interface font.
 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(char) ? 2 : 1
  }
  return width
}

/*
 * Placeholders have to be readable in their field without clipping. A dock search field at
 * the 380 px dock width leaves about 270 px for text at 14 px (Source Sans 3): 34 units keeps
 * Cyrillic (the widest Latin-width script, ~7.5 px a letter) and CJK (14 px a character) inside it.
 * The title-bar place field leaves about 200 px, so 26 units.
 */
const DOCK_FIELD = 34
const PLACEHOLDER_BUDGETS: Record<string, number> = {
  'plantFinder.placeholder': DOCK_FIELD,
  'plantDb.searchPlaceholder': DOCK_FIELD,
  'favorites.searchAll': DOCK_FIELD,
  'canvas.calendar.addSpeciesPlaceholder': DOCK_FIELD,
  'designNotebook.newSectionPlaceholder': DOCK_FIELD,
  'filters.searchFields': DOCK_FIELD,
  'start.searchDesigns': DOCK_FIELD,
  'canvas.placeSearch.placeholder': 26,
  'canvas.placeSearch.placeholderShort': 18,
}

describe('placeholder lengths', () => {
  it.each(Object.entries(PLACEHOLDER_BUDGETS))('%s fits its field in every locale', (key, budget) => {
    const widths = Object.entries(flat).map(([code, entries]) => {
      const text = entries.get(key)
      expect(text, `${code} is missing ${key}`).toBeDefined()
      return { code, text: text!, width: displayWidth(text!) }
    })
    const longest = widths.reduce((max, entry) => (entry.width > max.width ? entry : max))
    expect(longest.width, `${longest.code} "${longest.text}" is ${longest.width} units; the budget is ${budget}`).toBeLessThanOrEqual(budget)
  })

  it('covers every placeholder key', () => {
    const placeholderKeys = [...english.keys()].filter(key => /placeholder/i.test(key))
    const unbudgeted = placeholderKeys.filter(key => !(key in PLACEHOLDER_BUDGETS))
    // Multi-line text areas wrap; their placeholders need no budget.
    expect(unbudgeted.sort()).toEqual([
      'canvas.calendar.descriptionPlaceholder',
      'canvas.textNote.placeholder',
      'commands.searchPlaceholder',
      'problemReport.descriptionPlaceholder',
      'stories.textPlaceholder',
    ])
  })
})

/*
 * English interface copy is sentence case: titles, buttons, menu items and labels capitalise only
 * the first word and proper nouns. Canopi's own surface names are proper nouns when a label names
 * them (Design, Layers, Select), as are brands and file formats.
 */
const PROPER_NOUNS = new Set([
  'Canopi', 'Google', 'OpenStreetMap', 'IGN', 'Esri', 'Maps', 'API', 'GeoLibre', 'Grime', 'Raunkiaer', 'Ellenberg', 'Köppen',
  'Design', 'Designs', 'Layers', 'Select', 'Pan', 'Satellite', 'Start', 'Web', 'Desktop', 'Edition', 'English', 'Latin',
  'Ctrl', 'Shift', 'Alt', 'Esc', 'Tab', 'Enter', 'Space', 'Delete', 'Backspace', 'Home', 'End', 'Plus', 'Minus',
])
/** Panel and frame names that a sentence refers to by name. */
const PROPER_NAMES = ['Data library', 'Saved stamps', 'Plant catalog', 'Plants in this Design', 'Design notebook']

function titleCaseWords(text: string): string[] {
  const words = PROPER_NAMES.reduce((copy, name) => copy.split(name).join(name.toLowerCase()), text)
    .replace(/\{\{[^}]*\}\}/g, 'x')
    // A capital after sentence or list punctuation starts a new phrase.
    .replace(/([.!?:·›(“"‘—–]\s*)([A-Z])/gu, (_, before: string, letter: string) => before + letter.toLowerCase())
    .match(/[A-Za-z][\w’'₂-]*/g) ?? []
  return words.slice(1).filter(word => (
    /^[A-Z]/.test(word)
    && !PROPER_NOUNS.has(word)
    && !/^[A-Z]$/.test(word)
    && !/^[A-Z][A-Z\d]+$/.test(word)
    && !/^I[’']/.test(word)
    && !/[a-z][A-Z]/.test(word)
  ))
}

describe('English copy', () => {
  it('uses sentence case in titles, buttons and labels', () => {
    const labels = [...english.entries()].filter(([, text]) => text.split(/\s+/).length <= 8 && !/[.!?]$/.test(text.trim()))
    const titleCase = labels
      .map(([key, text]) => ({ key, text, words: titleCaseWords(text) }))
      .filter(entry => entry.words.length > 0)
      .map(entry => `${entry.key}: "${entry.text}" (${entry.words.join(', ')})`)
    expect(titleCase).toEqual([])
  })

  it('writes an ellipsis as one character', () => {
    for (const [code, entries] of Object.entries(flat)) {
      const dotted = [...entries].filter(([, text]) => text.includes('...')).map(([key]) => key)
      expect(dotted, code).toEqual([])
    }
  })
})

describe('keyboard shortcut sheet', () => {
  // Tool keys run anywhere except text fields and dialogs (canvas v2 plan, phase F): no locale may say they need the map's focus.
  const MAP_FOCUS_WORDING: Record<string, readonly [string, string]> = {
    en: ['{{menu}} (while the map has focus)', 'Tool keys work while the map has focus.'],
    de: ['{{menu}} (wenn die Karte den Fokus hat)', 'Werkzeugtasten wirken, wenn die Karte den Fokus hat.'],
    es: ['{{menu}} (con el mapa enfocado)', 'Las teclas de herramientas funcionan con el mapa enfocado.'],
    fr: ['{{menu}} (quand la carte a le focus)', 'Les touches d’outils fonctionnent quand la carte a le focus.'],
    it: ['{{menu}} (con la mappa attiva)', 'I tasti degli strumenti funzionano con la mappa attiva.'],
    ja: ['{{menu}}（地図にフォーカスがあるとき）', 'ツールのキーは地図にフォーカスがあるときに使えます。'],
    ko: ['{{menu}} (지도에 포커스가 있을 때)', '도구 키는 지도에 포커스가 있을 때 작동합니다.'],
    nl: ['{{menu}} (als de kaart focus heeft)', 'Gereedschapstoetsen werken als de kaart focus heeft.'],
    pt: ['{{menu}} (com o mapa em foco)', 'As teclas de ferramentas funcionam com o mapa em foco.'],
    ru: ['{{menu}} (когда карта в фокусе)', 'Клавиши инструментов работают, когда карта в фокусе.'],
    zh: ['{{menu}}（地图获得焦点时）', '工具按键在地图获得焦点时生效。'],
  }

  it('says tool keys work anywhere except text fields, in every locale', () => {
    expect(english.get('shortcuts.toolsHeading')).toBe('{{menu}} (anywhere except text fields)')
    expect(english.get('shortcuts.footnote')).toBe('Tool keys work anywhere except text fields.')
    for (const [code, entries] of Object.entries(flat)) {
      const [heading, footnote] = MAP_FOCUS_WORDING[code]!
      expect(entries.get('shortcuts.toolsHeading'), code).not.toBe(heading)
      expect(entries.get('shortcuts.toolsHeading'), code).toContain('{{menu}}')
      expect(entries.get('shortcuts.footnote'), code).not.toBe(footnote)
    }
  })
})
