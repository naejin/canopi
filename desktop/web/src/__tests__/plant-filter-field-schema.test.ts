import { describe, expect, it } from 'vitest'

import {
  FILTER_CATEGORIES,
  PLANT_FILTER_FIELDS,
  PLANT_FILTER_SQL_FIELD_KEYS,
  dynamicFilterFieldsForCategory,
  isStripField,
  type PlantFilterFieldDef,
} from '../generated/plant-filter-fields'
import { orderFilterValues } from '../components/plant-db/value-ordering'
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
  en,
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

function hasTranslation(root: TranslationTree, key: string): boolean {
  const parts = key.split('.')
  let node: string | TranslationTree | undefined = root

  for (let index = 0; index < parts.length; index += 1) {
    if (typeof node !== 'object' || node === null) return false

    const remaining = parts.slice(index).join('.')
    if (typeof node[remaining] === 'string') return true

    const part = parts[index]
    if (part === undefined) return false
    node = node[part]
  }

  return typeof node === 'string'
}

describe('plant filter field schema', () => {
  it('keeps SQL columns out of shipped TypeScript field metadata', () => {
    for (const field of PLANT_FILTER_FIELDS) {
      expect(Object.keys(field)).not.toContain('sqlColumn')
      expect(Object.keys(field)).not.toContain('column')
    }
  })

  it('keeps strip Species Catalog Filter UI behavior in generated field metadata', () => {
    const fields: readonly PlantFilterFieldDef[] = PLANT_FILTER_FIELDS
    const byKey = new Map(fields.map((field) => [field.key, field]))

    expect(byKey.get('climate_zones')).toMatchObject({
      stripChoice: {
        optionsKey: 'climate_zones',
        valueI18nPrefix: 'filters.climateZone_',
      },
      activeArrayChip: {
        keyPrefix: 'cz',
        valueI18nPrefix: 'filters.climateZone_',
      },
    })
    expect(byKey.get('habit')).toMatchObject({
      stripChoice: {
        optionsKey: 'habits',
        valueI18nPrefix: 'filters.habit_',
      },
      activeArrayChip: {
        keyPrefix: 'hab',
        valueI18nPrefix: 'filters.habit_',
      },
    })
    expect(byKey.get('woody')?.stripChoice).toBeUndefined()
  })

  it('groups only dynamic fields for More Filters and keeps strip fields out', () => {
    expect(isStripField('habit')).toBe(true)
    expect(isStripField('woody')).toBe(true)
    expect(isStripField('climate_zones')).toBe(true)

    for (const category of FILTER_CATEGORIES) {
      const fields = dynamicFilterFieldsForCategory(category.key)
      expect(fields.every((field) => field.category === category.key)).toBe(true)
      expect(fields.every((field) => field.uiPlacement === 'dynamic')).toBe(true)
      expect(fields.some((field) => isStripField(field.key))).toBe(false)
    }

    expect(dynamicFilterFieldsForCategory('growth').some((field) => field.key === 'woody')).toBe(false)
    expect(dynamicFilterFieldsForCategory('climate').some((field) => field.key === 'climate_zones')).toBe(false)
  })

  it('keeps dynamic UI fields backed by the generated Rust SQL allowlist keys', () => {
    const sqlKeys = new Set<string>(PLANT_FILTER_SQL_FIELD_KEYS)
    const fieldsByKey = new Map(PLANT_FILTER_FIELDS.map((field) => [field.key, field]))

    for (const field of PLANT_FILTER_FIELDS.filter((field) => field.uiPlacement === 'dynamic')) {
      expect(sqlKeys.has(field.key), `${field.key} should have a Rust allowlist key`).toBe(true)
    }

    for (const key of PLANT_FILTER_SQL_FIELD_KEYS) {
      expect(fieldsByKey.get(key)?.kind, `${key} should have a generated kind`).toMatch(/^(boolean|categorical|numeric)$/)
    }

    expect(sqlKeys.has('climate_zones')).toBe(false)
  })

  it('declares translations for generated categories and fields in every locale', () => {
    const keys = [
      ...FILTER_CATEGORIES.map((category) => category.i18nKey),
      ...PLANT_FILTER_FIELDS.map((field) => field.i18nKey),
    ]

    for (const [locale, translations] of Object.entries(locales)) {
      const missing = keys.filter((key) => !hasTranslation(translations, key))
      expect(missing, `${locale} missing generated schema translations`).toEqual([])
    }
  })

  it('orders categorical values from generated ordering metadata', () => {
    const values = [
      { value: 'High' },
      { value: 'Low' },
      { value: 'None' },
      { value: 'Unexpected' },
    ]

    expect(orderFilterValues('drought_tolerance', values).map((value) => value.value)).toEqual([
      'None',
      'Low',
      'High',
      'Unexpected',
    ])
  })
})
