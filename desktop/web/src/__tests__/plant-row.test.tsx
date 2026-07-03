import { render } from 'preact'
import { signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const plantBrowserMock = vi.hoisted(() => ({
  intent: { value: { text: '' } },
  selectSpecies: vi.fn(),
  toggleFavorite: vi.fn(),
  isActiveSearchText: vi.fn((text: string) => text.trim().length > 1),
}))

vi.mock('../app/plant-browser', () => ({
  speciesCatalogWorkbench: plantBrowserMock,
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
    plantBrowserMock.intent.value = { text: '' }
    plantBrowserMock.isActiveSearchText.mockClear()
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

  it('shows a distinct matched Common Name during active catalog search', () => {
    plantBrowserMock.intent.value = { text: 'melis' }
    const plant = {
      ...makeSpeciesListItem('Moluccella laevis'),
      common_name: "Clochette d'Irlande",
      common_name_2: 'Moluque verte',
      matched_common_name: 'Mélisse des Moluques',
    }

    render(<PlantRow plant={plant} />, container)

    expect(container.textContent).toContain("Clochette d'Irlande")
    expect(container.textContent).toContain('Mélisse des Moluques')
    expect(container.textContent).not.toContain('Moluque verte')
  })

  it('keeps favorite rows on their normal secondary Common Name', () => {
    plantBrowserMock.intent.value = { text: 'melis' }
    const plant = {
      ...makeSpeciesListItem('Moluccella laevis', true),
      common_name: "Clochette d'Irlande",
      common_name_2: 'Moluque verte',
      matched_common_name: 'Mélisse des Moluques',
    }

    render(<PlantRow plant={plant} variant="favorites" />, container)

    expect(container.textContent).toContain('Moluque verte')
    expect(container.textContent).not.toContain('Mélisse des Moluques')
  })
})
