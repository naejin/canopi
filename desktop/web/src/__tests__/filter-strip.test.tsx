import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterStrip } from '../components/plant-db/FilterStrip'
import {
  activeFilters,
  extraFilters,
  filterOptions,
  plantFilterModel,
} from '../app/plant-browser'
import { locale } from '../app/settings/state'

describe('FilterStrip', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activeFilters.value = plantFilterModel.createEmpty()
    extraFilters.value = []
    filterOptions.value = {
      families: [],
      growth_rates: [],
      climate_zones: ['Temperate'],
      habits: ['Tree'],
      life_cycles: ['Annual'],
      sun_tolerances: ['full_sun'],
      soil_tolerances: [],
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    filterOptions.value = null
  })

  it('renders life cycle as a catalog strip behavior and patches the fixed request field', async () => {
    await act(async () => {
      render(<FilterStrip onMoreFilters={vi.fn()} />, container)
    })

    expect(container.textContent).toContain('Life cycle')
    expect(container.textContent).toContain('Annual')

    const annualChip = Array.from(container.querySelectorAll('[role="button"]')).find((button) => (
      button.textContent === 'Annual'
    ))
    expect(annualChip).toBeDefined()

    await act(async () => {
      annualChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activeFilters.value.life_cycle).toEqual(['Annual'])
  })
})
