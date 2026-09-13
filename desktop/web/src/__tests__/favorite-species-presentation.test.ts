import { describe, expect, it } from 'vitest'
import { filterFavoriteSpecies } from '../components/plant-db/favorite-species-presentation'
import { makeSpeciesListItem } from './support/species-catalog-workbench'

describe('shared favorite Species presentation', () => {
  it('matches Common and Canonical Names with the shared accent-insensitive normalizer', () => {
    const peach = {
      ...makeSpeciesListItem('Prunus persica', true),
      common_name: 'Pêcher',
    }
    const apple = {
      ...makeSpeciesListItem('Malus domestica', true),
      common_name: 'Pommier',
    }

    expect(filterFavoriteSpecies([peach, apple], 'pecher')).toEqual([peach])
    expect(filterFavoriteSpecies([peach, apple], 'MALUS')).toEqual([apple])
  })
})
