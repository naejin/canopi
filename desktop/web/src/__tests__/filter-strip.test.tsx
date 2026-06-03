import { render } from 'preact'
import { act } from 'preact/test-utils'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import { createTestSpeciesCatalogWorkbench } from './support/species-catalog-workbench'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('FilterStrip', () => {
  let container: HTMLDivElement
  let FilterStrip: typeof import('../components/plant-db/FilterStrip').FilterStrip
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench

  beforeEach(async () => {
    vi.resetModules()
    const settings = await import('../app/settings/state')
    locale = settings.locale
    locale.value = 'en'
    workbench = await createTestSpeciesCatalogWorkbench({
      locale,
      getFilterOptions: async () => ({
        families: [],
        growth_rates: [],
        climate_zones: ['Temperate'],
        habits: ['Tree'],
        life_cycles: ['Annual'],
        sun_tolerances: ['full_sun'],
        soil_tolerances: [],
      }),
    })
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    ;({ FilterStrip } = await import('../components/plant-db/FilterStrip'))

    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    workbench.clearFilters()
    await workbench.loadFilterOptions()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    workbench.dispose()
    vi.doUnmock('../app/plant-browser')
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

    expect(workbench.intent.value.filters.life_cycle).toEqual(['Annual'])
  })
})

describe('Species Catalog filter region layout', () => {
  it('caps the combined filter region instead of individual filter rows', () => {
    const panelSource = readSource('../components/panels/PlantDbPanel.tsx')
    const stripSource = readSource('../components/plant-db/FilterStrip.tsx')
    const css = readSource('../components/plant-db/PlantDb.module.css')
    const moreFiltersCss = readSource('../components/plant-db/MoreFiltersPanel.module.css')

    expect(panelSource).toContain('className={styles.filterRegion}')
    expect(panelSource.indexOf('<FilterStrip')).toBeLessThan(panelSource.indexOf('<ActiveChips'))

    expect(stripSource).toContain('styles.filterChoiceControl')
    expect(stripSource).not.toContain('styles.filterChoiceChip')
    expect(moreFiltersCss).toMatch(/\.chipGrid\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*calc\(var\(--space-1\) - 1px\);/s)
    expect(css).toMatch(/\.filterStrip\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s)
    expect(css).not.toMatch(/\.filterStrip\s*{[^}]*grid-template-columns:/s)
    expect(css).toMatch(/\.filterRow\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*[^;]+minmax\(0,\s*1fr\);/s)
    expect(css).not.toMatch(/\.filterRow\s*{[^}]*display:\s*contents;/s)
    expect(css).toMatch(/\.filterChoiceControl\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*calc\(var\(--space-1\) - 1px\);/s)
    expect(css).not.toMatch(/\.filterChoiceControl\s*{[^}]*grid-template-columns:/s)
    expect(css).not.toContain('.filterChoiceChip')
    expect(css).toMatch(/\.filterRegion\s*{[^}]*max-height:\s*min\(45vh,\s*360px\);[^}]*overflow-y:\s*auto;/s)
    expect(css).not.toMatch(/\.filterStrip\s*{[^}]*max-height:/s)
    expect(css).not.toMatch(/\.filterControl\s*{[^}]*overflow:\s*hidden;/s)
    expect(css).not.toMatch(/\.filterActions\s*{[^}]*grid-column:/s)
  })
})
