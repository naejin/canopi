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

const locales: Record<string, TranslationTree> = {
  de,
  es,
  fr,
  it: itLocale,
  ja,
  ko,
  nl,
  pt,
  ru,
  zh,
}

function collectMissingKeys(
  source: TranslationTree,
  candidate: TranslationTree,
  prefix = '',
): string[] {
  const missing: string[] = []

  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    const candidateValue = candidate[key]

    if (candidateValue === undefined) {
      missing.push(path)
      continue
    }

    const sourceIsObject = typeof value === 'object' && value !== null
    const candidateIsObject = typeof candidateValue === 'object' && candidateValue !== null

    if (sourceIsObject && candidateIsObject) {
      missing.push(...collectMissingKeys(value as TranslationTree, candidateValue as TranslationTree, path))
      continue
    }

    if (sourceIsObject !== candidateIsObject) {
      missing.push(path)
    }
  }

  return missing
}

describe('i18n completeness', () => {
  for (const [locale, translations] of Object.entries(locales)) {
    it(`${locale} contains every english translation key`, () => {
      expect(collectMissingKeys(en as TranslationTree, translations)).toEqual([])
    })
  }
})
