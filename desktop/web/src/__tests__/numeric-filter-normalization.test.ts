import { describe, expect, it } from 'vitest'
import type { DynamicFilter } from '../types/species'
import { normalizeNumericExtraFilter } from '../app/plant-browser/numeric-filter-normalization'

function between(values: string[]): DynamicFilter {
  return { field: 'medicinal_rating', op: 'Between', values }
}

describe('normalizeNumericExtraFilter', () => {
  it('drops full-range numeric filters as no-op', () => {
    const normalized = normalizeNumericExtraFilter(between(['0', '5']), [0, 5])
    expect(normalized).toBeNull()
  })

  it('keeps zero lower bound when upper bound is narrowed', () => {
    const normalized = normalizeNumericExtraFilter(between(['0', '2']), [0, 5])
    expect(normalized).toEqual({ field: 'medicinal_rating', op: 'Between', values: ['0', '2'] })
  })

  it('reorders reversed bounds', () => {
    const normalized = normalizeNumericExtraFilter(between(['4', '1']), [0, 5])
    expect(normalized).toEqual({ field: 'medicinal_rating', op: 'Between', values: ['1', '4'] })
  })

  it('drops malformed bounds', () => {
    expect(normalizeNumericExtraFilter(between(['', '2']), [0, 5])).toBeNull()
    expect(normalizeNumericExtraFilter(between(['NaN', '2']), [0, 5])).toBeNull()
    expect(normalizeNumericExtraFilter(between(['Infinity', '2']), [0, 5])).toBeNull()
    expect(normalizeNumericExtraFilter(between(['1']), [0, 5])).toBeNull()
  })

  it('keeps valid bounds without full-range inference when range is missing', () => {
    const normalized = normalizeNumericExtraFilter(between(['0', '5']), null)
    expect(normalized).toEqual({ field: 'medicinal_rating', op: 'Between', values: ['0', '5'] })
  })

  it('drops degenerate ranges where both bounds are equal', () => {
    expect(normalizeNumericExtraFilter(between(['2', '2']), [0, 5])).toBeNull()
  })
})
