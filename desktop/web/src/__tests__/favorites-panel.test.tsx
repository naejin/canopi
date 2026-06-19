import { render } from 'preact'
import { signal, type Signal } from '@preact/signals'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import { readSavedObjectStampDragData } from '../canvas/saved-object-stamp-source'
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

function dragDataStore() {
  const values = new Map<string, string>()
  return {
    values,
    effectAllowed: 'none',
    setData(type: string, value: string) {
      values.set(type, value)
    },
    getData(type: string) {
      return values.get(type) ?? ''
    },
  }
}

function dragStartEvent(dataTransfer: ReturnType<typeof dragDataStore>): DragEvent {
  const event = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: dataTransfer,
  })
  return event
}

describe('FavoritesPanel', () => {
  let container: HTMLDivElement
  let FavoritesPanel: typeof import('../components/panels/FavoritesPanel').FavoritesPanel
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench
  let getFavoritesMock: ReturnType<typeof vi.fn>
  let loadStampLibraryMock: ReturnType<typeof vi.fn>
  let saveSelectionMock: ReturnType<typeof vi.fn>
  let renameStampMock: ReturnType<typeof vi.fn>
  let deleteStampMock: ReturnType<typeof vi.fn>
  let reorderStampMock: ReturnType<typeof vi.fn>
  let placeStampMock: ReturnType<typeof vi.fn>
  let stampLibrary: Signal<{
    items: SavedStampFixture[]
    loading: boolean
    revision: number
  }>

  interface SavedStampFixture {
    id: string
    name: string
    payload_json: string
    sort_order: number
    created_at: string
    updated_at: string
  }

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
    renameStampMock = vi.fn(async () => null)
    deleteStampMock = vi.fn(async () => true)
    reorderStampMock = vi.fn(async () => {})
    placeStampMock = vi.fn(() => true)
    stampLibrary = signal({
      items: [{
        id: 'stamp-1',
        name: 'Pommier, Lavande',
        payload_json: JSON.stringify({
          version: 1,
          anchor: { x: 10, y: 10 },
          plants: [
            {
              id: 'plant-1',
              canonicalName: 'Malus domestica',
              commonName: 'Apple',
              color: null,
              symbol: null,
              position: { x: 10, y: 10 },
              rotationDeg: null,
              scale: 2,
            },
            {
              id: 'plant-2',
              canonicalName: 'Lavandula angustifolia',
              commonName: 'Lavender',
              color: null,
              symbol: null,
              position: { x: 12, y: 10 },
              rotationDeg: null,
              scale: 1,
            },
          ],
          zones: [{
            id: 'zone-1',
            name: 'Bed',
            zoneType: 'rect',
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
            rotationDeg: 0,
            fillColor: null,
          }],
          annotations: [{
            id: 'annotation-1',
            annotationType: 'text',
            position: { x: 10, y: 8 },
            text: 'Guild',
            fontSize: 12,
            rotationDeg: null,
          }],
          groups: [],
        }),
        sort_order: 0,
        created_at: '2026-06-19T09:00:00Z',
        updated_at: '2026-06-19T09:00:00Z',
      }],
      loading: false,
      revision: 0,
    })
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    vi.doMock('../app/saved-object-stamps', () => ({
      savedObjectStampWorkbench: {
        library: stampLibrary,
        selection: signal({
          canSave: true,
          reason: null,
          selectedCount: 3,
        }),
        loadLibrary: loadStampLibraryMock,
        saveCurrentSelection: saveSelectionMock,
        renameStamp: renameStampMock,
        deleteStamp: deleteStampMock,
        reorderStamps: reorderStampMock,
        placeStamp: placeStampMock,
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
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Rename saved stamp"]')?.value)
      .toBe('Pommier, Lavande')
    expect(container.textContent).toContain('2 plants · 1 zone · 1 annotation')

    const saveButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Save selection'))
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(saveSelectionMock).toHaveBeenCalledTimes(1)

    const placeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Place')
    expect(placeButton).toBeTruthy()

    await act(async () => {
      placeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(placeStampMock).toHaveBeenCalledWith(stampLibrary.value.items[0])
  })

  it('manages Saved Stamps with inline rename two-step delete and a reorder grip', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Rename saved stamp"]')
    expect(renameInput).toBeTruthy()

    await act(async () => {
      renameInput!.value = 'Kitchen guild'
      renameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })
    await act(async () => {
      renameInput!.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await flushEffects()
    })
    expect(renameStampMock).toHaveBeenCalledWith('stamp-1', 'Kitchen guild')

    const grip = container.querySelector<HTMLElement>('[aria-label="Reorder saved stamp"]')
    expect(grip).toBeTruthy()
    expect(grip?.getAttribute('draggable')).toBe('true')
    const row = container.querySelector<HTMLElement>('[data-saved-stamp-row="stamp-1"]')
    expect(row?.getAttribute('draggable')).toBe('true')

    const placementDragData = dragDataStore()
    row!.dispatchEvent(dragStartEvent(placementDragData))
    expect(readSavedObjectStampDragData(placementDragData)?.plants).toHaveLength(2)

    const reorderDragData = dragDataStore()
    grip!.dispatchEvent(dragStartEvent(reorderDragData))
    expect(readSavedObjectStampDragData(reorderDragData)).toBeNull()

    const deleteButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Delete')
    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    expect(container.textContent).toContain('Confirm delete')
    expect(container.textContent).toContain('Cancel')

    const cancelButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Cancel')
    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    expect(deleteStampMock).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    const confirmButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Confirm delete')
    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(deleteStampMock).toHaveBeenCalledWith('stamp-1')
  })
})
