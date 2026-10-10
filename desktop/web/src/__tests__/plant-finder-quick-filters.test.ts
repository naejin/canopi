import { describe, expect, it } from 'vitest'
import {
  catalogForm,
  NO_SPECIES_QUICK_FILTERS,
  speciesQuickFilters,
} from '../app/plant-finder/quick-filters'

const SPECIES = ['Malus domestica', 'Prunus avium', 'Mentha spicata', 'Vitis vinifera', 'Aa achalensis']
const STRATA = new Map([
  ['Malus domestica', 'high'],
  ['Prunus avium', 'high'],
  ['Mentha spicata', 'low'],
] as const)
const FORMS = new Map([
  ['Malus domestica', catalogForm('Tree')],
  ['Prunus avium', catalogForm('Tree')],
  ['Mentha spicata', catalogForm('Herbaceous')],
  ['Vitis vinifera', catalogForm('Climber')],
  // Loaded, with no habit in the catalog.
  ['Aa achalensis', catalogForm(null)],
])

describe('Plant finder Stratum and Form quick filters', () => {
  it('reads the catalog habit as a form, and anything else as not recorded', () => {
    expect(['Tree', 'Shrub', 'Herbaceous', 'Climber', ' tree '].map(catalogForm))
      .toEqual(['tree', 'shrub', 'herbaceous', 'climber', 'tree'])
    expect([null, undefined, '', 'Epiphyte'].map(catalogForm)).toEqual(['none', 'none', 'none', 'none'])
  })

  it('counts every species of the list by its Design stratum and catalog form', () => {
    const filters = speciesQuickFilters(SPECIES, NO_SPECIES_QUICK_FILTERS, STRATA, FORMS)
    expect(filters.allowed).toBeNull()
    expect([...filters.stratumCounts]).toEqual([['high', 2], ['low', 1], ['none', 2]])
    expect([...filters.formCounts]).toEqual([['tree', 2], ['herbaceous', 1], ['climber', 1], ['none', 1]])
  })

  it('keeps the species passing both chosen filters', () => {
    expect([...speciesQuickFilters(SPECIES, { stratum: 'high', form: null }, STRATA, FORMS).allowed!])
      .toEqual(['Malus domestica', 'Prunus avium'])
    expect([...speciesQuickFilters(SPECIES, { stratum: 'none', form: null }, STRATA, FORMS).allowed!])
      .toEqual(['Vitis vinifera', 'Aa achalensis'])
    expect([...speciesQuickFilters(SPECIES, { stratum: 'none', form: 'climber' }, STRATA, FORMS).allowed!])
      .toEqual(['Vitis vinifera'])
    expect([...speciesQuickFilters(SPECIES, { stratum: 'low', form: 'tree' }, STRATA, FORMS).allowed!]).toEqual([])
  })

  it('leaves a species whose form has not loaded out of the form counts and the form filter', () => {
    const filters = speciesQuickFilters(SPECIES, { stratum: null, form: 'none' }, STRATA, new Map())
    expect([...filters.formCounts]).toEqual([])
    expect([...filters.allowed!]).toEqual([])
  })
})
