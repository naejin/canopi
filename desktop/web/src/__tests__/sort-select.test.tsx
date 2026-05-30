import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import { createTestSpeciesCatalogWorkbench } from './support/species-catalog-workbench'

describe('SortSelect', () => {
  let container: HTMLDivElement
  let SortSelect: typeof import('../components/plant-db/SortSelect').SortSelect
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench

  beforeEach(async () => {
    vi.resetModules()
    const settings = await import('../app/settings/state')
    locale = settings.locale
    locale.value = 'en'
    workbench = await createTestSpeciesCatalogWorkbench({ locale })
    workbench.setSearchText('')
    workbench.setSort('Name')
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    ;({ SortSelect } = await import('../components/plant-db/SortSelect'))

    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    workbench.dispose()
    vi.doUnmock('../app/plant-browser')
  })

  it('shows Name as the browse default and hides Best match without active text', async () => {
    await act(async () => {
      render(<SortSelect />, container)
    })

    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('Name')
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Sort: Name',
      'Sort: Family',
      'Sort: Height',
      'Sort: Hardiness',
      'Sort: Growth rate',
    ])
  })

  it('shows Best match as the default effective sort for active text', async () => {
    await act(async () => {
      workbench.setSearchText('lin')
      render(<SortSelect />, container)
    })

    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('Relevance')
    expect([...select.options].map((option) => option.textContent)).toContain('Sort: Best match')
  })

  it('lets explicit sorts override active text Best match', async () => {
    await act(async () => {
      workbench.setSearchText('lin')
      render(<SortSelect />, container)
    })

    const select = container.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'Family'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(workbench.intent.value.sort).toBe('Family')
    expect(select.value).toBe('Family')
  })
})
