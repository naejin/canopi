import { render } from 'preact'
import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../app/plant-browser', () => ({
  speciesCatalogWorkbench: {
    selectSpecies: vi.fn(),
    toggleFavorite: vi.fn(),
  },
}))

vi.mock('../canvas/session', () => ({
  currentCanvasToolCommandSurface: signal(null),
}))

import { locale } from '../app/settings/state'
import { PlantRow } from '../components/plant-db/PlantRow'
import { makeSpeciesListItem } from './support/species-catalog-workbench'

describe('PlantRow', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('shows climate zone and life cycle instead of hardiness and edibility in Favorites', () => {
    const plant = {
      ...makeSpeciesListItem('Malus domestica', true),
      common_name: 'Apple',
      climate_zones: ['Temperate', 'Continental'],
      life_cycles: ['Perennial'],
      hardiness_zone_min: 4,
      hardiness_zone_max: 8,
      edibility_rating: 5,
    }

    render(<PlantRow plant={plant} variant="favorites" />, container)

    expect(container.textContent).toContain('Apple')
    expect(container.textContent).toContain('Malus domestica')
    expect(container.textContent).toContain('Temperate')
    expect(container.textContent).toContain('Continental')
    expect(container.textContent).toContain('Perennial')
    expect(container.textContent).not.toContain('Z4')
    expect(container.textContent).not.toContain('Edible')
  })
})
