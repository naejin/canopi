import { describe, expect, it } from 'vitest'

import {
  plantFilterCatalog,
  plantFilterModel,
} from '../app/plant-browser/plant-filter-model'
import type { DynamicFilter } from '../types/species'

describe('plant filter model', () => {
  it('uses schema descriptors as the strip filter catalog', () => {
    const stripFields = plantFilterCatalog.fields({ placement: 'strip' })

    expect(stripFields.map((field) => field.key)).toEqual([
      'climate_zones',
      'woody',
      'habit',
    ])

    for (const field of stripFields) {
      expect(field.i18nKey.length).toBeGreaterThan(0)
      expect(field.colorToken.length).toBeGreaterThan(0)
      expect(plantFilterCatalog.hasSpeciesFilterStrategy(field.key)).toBe(true)

      if (field.kind === 'categorical') {
        expect(plantFilterCatalog.stripOptionSource(field.key)).toBeDefined()
      }
    }

    expect(plantFilterCatalog.stripChoiceFields().map((field) => field.filterKey)).toEqual([
      'climate_zones',
      'habit',
      'sun_tolerances',
      'life_cycle',
    ])
    expect(plantFilterCatalog.stripControls().map((field) => `${field.kind}:${field.filterKey}`)).toEqual([
      'choice:climate_zones',
      'choice:habit',
      'choice:sun_tolerances',
      'choice:life_cycle',
      'threshold:edibility_min',
      'boolean:woody',
      'boolean:nitrogen_fixer',
    ])
    expect(plantFilterCatalog.stripOptionSource('life_cycle')).toEqual({
      filterOptionsKey: 'life_cycles',
      valueI18nPrefix: 'filters.lifeCycle_',
    })
    expect(plantFilterCatalog.activeArrayChipFields().map((field) => field.filterKey)).toEqual([
      'climate_zones',
      'habit',
      'sun_tolerances',
      'life_cycle',
      'growth_rate',
    ])
    expect(plantFilterCatalog.activeChipFields().map((field) => `${field.kind}:${field.filterKey}`)).toEqual([
      'array:climate_zones',
      'array:habit',
      'array:sun_tolerances',
      'array:life_cycle',
      'array:growth_rate',
      'boolean:woody',
      'numeric-threshold:edibility_min',
      'boolean:nitrogen_fixer',
    ])
  })

  it('derives active filter state and count from one model', () => {
    const empty = plantFilterModel.createEmpty()

    expect(plantFilterModel.hasActive(empty)).toBe(false)
    expect(plantFilterModel.activeCount(empty)).toBe(0)

    const active = {
      ...empty,
      climate_zones: ['Temperate'],
      habit: ['Tree'],
      woody: true,
      sun_tolerances: ['full_sun'],
      edibility_min: 3,
      nitrogen_fixer: true,
      family: 'Rosaceae',
      edible: true,
    }
    const extraFilters: DynamicFilter[] = [
      { field: 'height_max_m', op: 'Gte', values: ['2'] },
    ]

    expect(plantFilterModel.hasActive(active, extraFilters)).toBe(true)
    expect(plantFilterModel.activeCount(active, extraFilters)).toBe(7)
  })

  it('creates request filters by merging dynamic filters without mutating UI state', () => {
    const filters = plantFilterModel.createEmpty()
    filters.habit = ['Shrub']
    filters.extra = [{ field: 'growth_form_type', op: 'In', values: ['Shrub'] }]
    const extraFilters: DynamicFilter[] = [
      { field: 'height_max_m', op: 'Between', values: ['1', '3'] },
    ]

    const requestFilters = plantFilterModel.toRequestFilters(filters, extraFilters)

    expect(requestFilters).not.toBe(filters)
    expect(requestFilters.extra).toEqual([
      { field: 'growth_form_type', op: 'In', values: ['Shrub'] },
      { field: 'height_max_m', op: 'Between', values: ['1', '3'] },
    ])
    expect(filters.extra).toEqual([
      { field: 'growth_form_type', op: 'In', values: ['Shrub'] },
    ])

    const cleared = plantFilterModel.createEmpty()
    expect(plantFilterModel.hasActive(cleared)).toBe(false)
  })
})
