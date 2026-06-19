import { render } from 'preact'
import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import type { SpeciesListItem } from '../types/species'
import {
  createTestSpeciesCatalogWorkbench,
  makeSpeciesListItem,
} from './support/species-catalog-workbench'

vi.mock('../components/plant-db/PlantRow', () => ({
  PlantRow: ({ plant }: { plant: { canonical_name: string } }) => (
    <div data-testid="favorite-row">{plant.canonical_name}</div>
  ),
}))

vi.mock('../components/plant-detail/PlantDetailCard', () => ({
  PlantDetailCard: ({ canonicalName }: { canonicalName: string }) => (
    <div data-testid="favorite-detail">{canonicalName}</div>
  ),
}))

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('FavoritesPanel', () => {
  let container: HTMLDivElement
  let FavoritesPanel: typeof import('../components/panels/FavoritesPanel').FavoritesPanel
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench
  let getFavoritesMock: ReturnType<typeof vi.fn>
  let loadStampLibraryMock: ReturnType<typeof vi.fn>
  let saveSelectionMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    const settings = await import('../app/settings/state')
    locale = settings.locale
    locale.value = 'en'
    getFavoritesMock = vi.fn(async () => [
      makeSpeciesListItem('Malus domestica', true),
    ])
    workbench = await createTestSpeciesCatalogWorkbench({
      locale,
      getFavorites: getFavoritesMock as unknown as (locale: string) => Promise<SpeciesListItem[]>,
    })
    loadStampLibraryMock = vi.fn(async () => {})
    saveSelectionMock = vi.fn(async () => null)
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    vi.doMock('../app/saved-object-stamps', () => ({
      savedObjectStampWorkbench: {
        library: signal({
          items: [{
            id: 'stamp-1',
            name: 'Pommier, Lavande',
            payload_json: JSON.stringify({
              plants: [{ id: 'plant-1' }, { id: 'plant-2' }],
              zones: [{ id: 'zone-1' }],
              annotations: [{ id: 'annotation-1' }],
              groups: [],
            }),
            sort_order: 0,
            created_at: '2026-06-19T09:00:00Z',
            updated_at: '2026-06-19T09:00:00Z',
          }],
          loading: false,
          revision: 0,
        }),
        selection: signal({
          canSave: true,
          reason: null,
          selectedCount: 3,
        }),
        loadLibrary: loadStampLibraryMock,
        saveCurrentSelection: saveSelectionMock,
      },
    }))
    ;({ FavoritesPanel } = await import('../components/panels/FavoritesPanel'))

    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    workbench.dispose()
    vi.doUnmock('../app/plant-browser')
    vi.doUnmock('../app/saved-object-stamps')
  })

  it('requests favorites on mount and renders the current favorite list', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    expect(getFavoritesMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await workbench.loadFavorites()
      await flushEffects()
    })

    expect(container.textContent).toContain('Favorites')
    expect(container.textContent).toContain('Malus domestica')
  })

  it('renders Saved Stamps below species favorites and saves the current selection', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    expect(loadStampLibraryMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Saved Stamps')
    expect(container.textContent).toContain('For reusable groups of plants, zones, and annotations.')
    expect(container.textContent).toContain('Pommier, Lavande')
    expect(container.textContent).toContain('2 plants · 1 zone · 1 annotation')

    const saveButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Save selection'))
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(saveSelectionMock).toHaveBeenCalledTimes(1)
  })
})
