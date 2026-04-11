import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SpeciesDetail } from '../types/species'
import { RiskDistributionSection } from '../components/plant-detail/RiskDistributionSection'

describe('RiskDistributionSection', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders climate zones alongside distribution data', () => {
    const detail = {
      toxicity: null,
      invasive_potential: null,
      biogeographic_status: null,
      noxious_status: null,
      invasive_usda: null,
      weed_potential: null,
      fire_resistant: null,
      fire_tolerance: null,
      hedge_tolerance: null,
      native_distribution: null,
      introduced_distribution: null,
      climate_zones: 'Temperate, Continental',
    } as SpeciesDetail

    render(
      <RiskDistributionSection
        d={detail}
        expanded={new Set(['risk'])}
        onToggle={() => {}}
      />,
      container,
    )

    expect(container.textContent).toContain('Climate zone')
    expect(container.textContent).toContain('Temperate, Continental')
  })
})
