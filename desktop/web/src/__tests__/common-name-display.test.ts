import { describe, expect, it } from 'vitest'
import { secondaryCommonNameForDisplay } from '../components/plant-db/common-name-display'
import { makeSpeciesListItem } from './support/species-catalog-workbench'

describe('Species Common Name display', () => {
  it.each([
    ['STRASSE', 'Straße'],
    ['Σίσυφος', 'Σίσυφοσ'],
  ])('suppresses a contract-equivalent matched name: %s / %s', (primary, matched) => {
    const plant = {
      ...makeSpeciesListItem('Example species'),
      common_name: primary,
      common_name_2: null,
      matched_common_name: matched,
    }

    expect(secondaryCommonNameForDisplay(plant, true)).toBeNull()
  })
})
