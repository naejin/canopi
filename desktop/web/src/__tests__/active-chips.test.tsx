import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActiveChips } from '../components/plant-db/ActiveChips'
import { dynamicOptionsCache, extraFilters, activeFilters } from '../state/plant-db'
import { locale } from '../state/app'

describe('ActiveChips', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    activeFilters.value = {
      hardiness_min: null,
      hardiness_max: null,
      height_min: null,
      height_max: null,
      sun_tolerances: null,
      soil_tolerances: null,
      growth_rate: null,
      life_cycle: null,
      edible: null,
      edibility_min: null,
      nitrogen_fixer: null,
      stratum: null,
      family: null,
      extra: null,
    }
    extraFilters.value = [{ field: 'habit', op: 'In', values: ['Shrub'] }]
    dynamicOptionsCache.value = {
      en: {
        habit: {
          field: 'habit',
          field_type: 'categorical',
          values: [{ value: 'Shrub', label: 'Shrub' }],
          range: null,
        },
      },
      fr: {
        habit: {
          field: 'habit',
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

    expect(container.textContent).toContain('Habit: Shrub')

    await act(async () => {
      locale.value = 'fr'
    })

    expect(container.textContent).toContain('Port')
    expect(container.textContent).toContain('Arbuste')
  })
})
