import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { formatCount } from '../utils/format-count'

vi.mock('../app/plant-browser', async () => {
  const { signal } = await import('@preact/signals')
  return {
    speciesCatalogWorkbench: {
      intent: signal({ text: '' }),
      results: signal({ status: 'ready', totalEstimate: 175473 }),
      isSearchLoading: () => false,
      setSearchText: vi.fn(),
      clearSearchText: vi.fn(),
    },
  }
})

import { speciesCatalogWorkbench } from '../app/plant-browser'
import { SearchBar } from '../components/plant-db/SearchBar'

let container: HTMLDivElement

beforeEach(() => {
  locale.value = 'en'
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  locale.value = 'en'
})

// Intl uses narrow no-break spaces as French group separators.
const spaces = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

describe('Plant catalog result count', () => {
  it('groups digits for the interface language and agrees in number', async () => {
    await act(async () => { render(<SearchBar />, container) })
    expect(container.textContent).toContain('175,473 results')

    await act(async () => { locale.value = 'fr' })
    expect(spaces(container.textContent)).toContain('175 473 résultats')

    const results = speciesCatalogWorkbench.results as unknown as { value: { status: string; totalEstimate: number } }
    await act(async () => {
      locale.value = 'en'
      results.value = { status: 'ready', totalEstimate: 1 }
    })
    expect(container.textContent).toContain('1 result')
    expect(container.textContent).not.toContain('1 results')
  })
})

describe('formatCount', () => {
  it('formats a count shown on its own for the locale', () => {
    expect(formatCount(2201, 'en')).toBe('2,201')
    expect(spaces(formatCount(2201, 'fr'))).toBe('2 201')
    expect(formatCount(12, 'de')).toBe('12')
  })
})
