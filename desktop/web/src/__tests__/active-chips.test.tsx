import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActiveChips } from '../components/plant-db/ActiveChips'
import { dynamicOptionsCache, dynamicOptionsErrors, dynamicOptionsPending, extraFilters, activeFilters } from '../app/plant-browser'
import { locale } from '../app/settings/state'

describe('ActiveChips', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activeFilters.value = {
      sun_tolerances: null,
      soil_tolerances: null,
      growth_rate: null,
      life_cycle: null,
      edible: null,
      edibility_min: null,
      nitrogen_fixer: null,
      climate_zones: null,
      habit: null,
      woody: null,
      family: null,
      extra: null,
    }
    extraFilters.value = [{ field: 'growth_form_type', op: 'In', values: ['Shrub'] }]
    dynamicOptionsPending.value = {}
    dynamicOptionsErrors.value = {}
    dynamicOptionsCache.value = {
      en: {
        growth_form_type: {
          field: 'growth_form_type',
          field_type: 'categorical',
          values: [{ value: 'Shrub', label: 'Shrub' }],
          range: null,
        },
      },
      fr: {
        growth_form_type: {
          field: 'growth_form_type',
          field_type: 'categorical',
          values: [{ value: 'Shrub', label: 'Arbuste' }],
          range: null,
        },
      },
    }
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders extra categorical chip values using the active locale cache', async () => {
    await act(async () => {
      render(<ActiveChips />, container)
    })

    expect(container.textContent).toContain('Growth form type: Shrub')

    await act(async () => {
      locale.value = 'fr'
    })

    expect(container.textContent).toContain('Type de forme')
    expect(container.textContent).toContain('Arbuste')
  })

  it('formats numeric dynamic filters as readable ranges', async () => {
    extraFilters.value = [{ field: 'hardiness_zone_min', op: 'Between', values: ['5', '8'] }]

    await act(async () => {
      render(<ActiveChips />, container)
    })

    expect(container.textContent).toContain('Hardiness zone min: 5–8')
  })

  it('renders and dismisses life cycle chips through the catalog behavior registry', async () => {
    extraFilters.value = []
    activeFilters.value = {
      ...activeFilters.value,
      life_cycle: ['Annual'],
    }

    await act(async () => {
      render(<ActiveChips />, container)
    })

    expect(container.textContent).toContain('Annual')

    const dismiss = Array.from(container.querySelectorAll('button')).find((button) => (
      button.getAttribute('aria-label')?.includes('Annual')
    ))
    expect(dismiss).toBeDefined()

    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activeFilters.value.life_cycle).toBeNull()
  })

  it('renders fixed strip chips through catalog descriptors', async () => {
    extraFilters.value = []
    activeFilters.value = {
      ...activeFilters.value,
      woody: true,
      edibility_min: 3,
      nitrogen_fixer: true,
    }

    await act(async () => {
      render(<ActiveChips />, container)
    })

    expect(container.textContent).toContain('Woody')
    expect(container.textContent).toContain('Edibility: 3+')
    expect(container.textContent).toContain('N')
    expect(container.textContent).toContain('Fixer')
  })
})
