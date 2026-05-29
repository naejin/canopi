import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { speciesCatalogWorkbench, searchText, sortField } from '../app/plant-browser'
import { locale } from '../app/settings/state'
import { SortSelect } from '../components/plant-db/SortSelect'

describe('SortSelect', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    speciesCatalogWorkbench.setSearchText('')
    speciesCatalogWorkbench.setSort('Name')
    searchText.value = ''
    sortField.value = 'Name'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
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
      speciesCatalogWorkbench.setSearchText('lin')
      render(<SortSelect />, container)
    })

    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('Relevance')
    expect([...select.options].map((option) => option.textContent)).toContain('Sort: Best match')
  })

  it('lets explicit sorts override active text Best match', async () => {
    await act(async () => {
      speciesCatalogWorkbench.setSearchText('lin')
      render(<SortSelect />, container)
    })

    const select = container.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'Family'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(speciesCatalogWorkbench.intent.value.sort).toBe('Family')
    expect(select.value).toBe('Family')
  })
})
