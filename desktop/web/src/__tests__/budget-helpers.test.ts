import { describe, it, expect } from 'vitest'
import { countPlants, buildPriceMap, formatCurrency, escapeCsvField } from '../components/canvas/budget-helpers'
import { MANUAL_TARGET, speciesBudgetTarget } from '../panel-targets'

describe('countPlants', () => {
  it('groups plants by canonical name and counts them', () => {
    const plants = [
      { canonical_name: 'Malus domestica', common_name: 'Apple' },
      { canonical_name: 'Malus domestica', common_name: 'Apple' },
      { canonical_name: 'Prunus avium', common_name: 'Cherry' },
    ] as any[]
    const result = countPlants(plants, undefined, 'en')
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.canonical === 'Malus domestica')).toMatchObject({ count: 2 })
    expect(result.find((r) => r.canonical === 'Prunus avium')).toMatchObject({ count: 1 })
  })

  it('prefers localized names when provided', () => {
    const plants = [
      { canonical_name: 'Malus domestica', common_name: 'Apple' },
    ] as any[]
    const localized = new Map([['Malus domestica', 'Pommier']])
    const result = countPlants(plants, localized, 'fr')
    expect(result[0]!.commonName).toBe('Pommier')
  })

  it('falls back to common_name when localized name is null', () => {
    const plants = [
      { canonical_name: 'Malus domestica', common_name: 'Apple' },
    ] as any[]
    const localized = new Map<string, string | null>([['Malus domestica', null]])
    const result = countPlants(plants, localized, 'en')
    expect(result[0]!.commonName).toBe('Apple')
  })
})

describe('buildPriceMap', () => {
  it('builds map from plant-category budget items', () => {
    const budget = [
      { target: speciesBudgetTarget('Malus domestica'), category: 'plants', description: 'Malus domestica', unit_cost: 5, currency: 'EUR', quantity: 0 },
      { target: MANUAL_TARGET, category: 'materials', description: 'Mulch', unit_cost: 10, currency: 'EUR', quantity: 0 },
      { target: speciesBudgetTarget('Malus domestica'), category: 'materials', description: 'Apple stakes', unit_cost: 20, currency: 'EUR', quantity: 0 },
    ]
    const map = buildPriceMap(budget)
    expect(map.size).toBe(1)
    expect(map.get('Malus domestica')?.unit_cost).toBe(5)
  })
})

describe('formatCurrency', () => {
  it('formats a number as currency', () => {
    const result = formatCurrency(5.5, 'USD')
    expect(result).toContain('5.50')
  })

  it('handles invalid currency gracefully', () => {
    const result = formatCurrency(10, 'INVALID')
    expect(result).toContain('10.00')
  })
})

describe('escapeCsvField', () => {
  it('wraps fields containing commas in quotes', () => {
    expect(escapeCsvField('hello, world')).toBe('"hello, world"')
  })

  it('returns plain fields unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('doubles embedded double-quotes and wraps', () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('sanitizes formula injection prefixes', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(escapeCsvField('+CMD')).toBe("'+CMD")
    expect(escapeCsvField('-HYPERLINK')).toBe("'-HYPERLINK")
    expect(escapeCsvField('@import')).toBe("'@import")
  })
})
