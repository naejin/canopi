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
  const types: string[] = []
  return {
    values,
    types,
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type: string, value: string) {
      values.set(type, value)
      if (!types.includes(type)) types.push(type)
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

function elementRect({
  left = 0,
  top = 0,
  width = 0,
  height = 0,
}: {
  left?: number
  top?: number
  width?: number
  height?: number
}): DOMRect {
  return {
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function installSavedStampRowRects(container: HTMLElement): void {
  const rows = [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
  rows.forEach((row) => {
    row.getBoundingClientRect = () => {
      const currentRows = [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      const index = currentRows.indexOf(row)
      return elementRect({ top: 100 + index * 40, height: 40 })
    }
  })
}

function preparePointerGrip(grip: HTMLElement): void {
  grip.setPointerCapture = vi.fn()
  grip.releasePointerCapture = vi.fn()
}

describe('FavoritesPanel', () => {
  let container: HTMLDivElement
  let FavoritesPanel: typeof import('../components/panels/FavoritesPanel').FavoritesPanel
  let locale: typeof import('../app/settings/state').locale
  let savedStampsFrameHeight: typeof import('../app/settings/state').savedStampsFrameHeight
  let workbench: SpeciesCatalogWorkbench
  let getFavoritesMock: ReturnType<typeof vi.fn>
  let loadStampLibraryMock: ReturnType<typeof vi.fn>
  let saveSelectionMock: ReturnType<typeof vi.fn>
  let saveCanvasSelectionMock: ReturnType<typeof vi.fn>
  let renameStampMock: ReturnType<typeof vi.fn>
  let deleteStampMock: ReturnType<typeof vi.fn>
  let reorderStampMock: ReturnType<typeof vi.fn>
  let placeStampMock: ReturnType<typeof vi.fn>
  let exportStampMock: ReturnType<typeof vi.fn>
  let importStampFileMock: ReturnType<typeof vi.fn>
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
    savedStampsFrameHeight = settings.savedStampsFrameHeight
    locale.value = 'en'
    savedStampsFrameHeight.value = 220
    getFavoritesMock = vi.fn(async () => [
      makeSpeciesListItem('Malus domestica', true),
    ])
    workbench = await createTestSpeciesCatalogWorkbench({
      locale,
      getFavorites: getFavoritesMock as unknown as (locale: string) => Promise<SpeciesListItem[]>,
    })
    loadStampLibraryMock = vi.fn(async () => {})
    saveSelectionMock = vi.fn(async () => null)
    saveCanvasSelectionMock = vi.fn()
    renameStampMock = vi.fn(async () => null)
    deleteStampMock = vi.fn(async () => true)
    reorderStampMock = vi.fn(async () => {})
    placeStampMock = vi.fn(() => true)
    exportStampMock = vi.fn(async () => '/tmp/Pommier, Lavande.canopi')
    importStampFileMock = vi.fn(async () => null)
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
        exportStamp: exportStampMock,
        importStampFile: importStampFileMock,
      },
    }))
    vi.doMock('../app/favorites/controller', async () => {
      const actual = await vi.importActual<typeof import('../app/favorites/controller')>(
        '../app/favorites/controller',
      )
      return {
        ...actual,
        saveCanvasSelectionAsObjectStamp: saveCanvasSelectionMock,
      }
    })
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
    vi.doUnmock('../app/favorites/controller')
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
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')).toBeNull()
    expect(container.textContent).toContain('Pommier, Lavande')
    expect(container.textContent).toContain('2 plants · 1 zone · 1 annotation')

    const saveButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Save selection'))
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(saveCanvasSelectionMock).toHaveBeenCalledTimes(1)
    expect(saveSelectionMock).not.toHaveBeenCalled()

    const importButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Import')
    expect(importButton).toBeTruthy()

    await act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(importStampFileMock).toHaveBeenCalledTimes(1)

    const placeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Place"]')
    expect(placeButton).toBeTruthy()

    await act(async () => {
      placeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(placeStampMock).toHaveBeenCalledWith(stampLibrary.value.items[0])

    const exportButton = container.querySelector<HTMLButtonElement>('button[aria-label="Export"]')
    expect(exportButton).toBeTruthy()

    await act(async () => {
      exportButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(exportStampMock).toHaveBeenCalledWith(stampLibrary.value.items[0])
  })

  it('renders plant favorites and Saved Stamps as sibling frames', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const plantsFrame = container.querySelector<HTMLElement>('[data-favorites-plants-frame]')
    const stampsFrame = container.querySelector<HTMLElement>('[data-saved-stamps-frame]')

    expect(plantsFrame).toBeTruthy()
    expect(stampsFrame).toBeTruthy()
    expect(plantsFrame?.textContent).toContain('Plants')
    expect(stampsFrame?.textContent).toContain('Saved Stamps')
  })

  it('manages Saved Stamps with ledger actions rename delete and separate drag handles', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const row = container.querySelector<HTMLElement>('[data-saved-stamp-row="stamp-1"]')
    const body = container.querySelector<HTMLElement>('[data-saved-stamp-body="stamp-1"]')
    const grip = container.querySelector<HTMLElement>('[aria-label="Reorder saved stamp"]')
    expect(row).toBeTruthy()
    expect(body).toBeTruthy()
    expect(grip).toBeTruthy()
    expect(row?.getAttribute('draggable')).not.toBe('true')
    expect(body?.getAttribute('draggable')).toBe('true')
    expect(grip?.getAttribute('draggable')).not.toBe('true')

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    expect(placeStampMock).not.toHaveBeenCalled()

    const placementDragData = dragDataStore()
    body!.dispatchEvent(dragStartEvent(placementDragData))
    expect(readSavedObjectStampDragData(placementDragData)?.plants).toHaveLength(2)

    const reorderDragData = dragDataStore()
    grip!.dispatchEvent(dragStartEvent(reorderDragData))
    expect(readSavedObjectStampDragData(reorderDragData)).toBeNull()

    expect(container.querySelector('button[aria-label="Place"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Export"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Rename"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Delete"]')).toBeTruthy()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')
    expect(renameInput).toBeTruthy()
    expect(container.querySelector('button[aria-label="Place"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Export"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Confirm rename"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Cancel rename"]')).toBeTruthy()

    await act(async () => {
      renameInput!.value = 'Kitchen guild'
      renameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })
    await act(async () => {
      renameInput!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flushEffects()
    })
    expect(renameStampMock).toHaveBeenCalledWith('stamp-1', 'Kitchen guild')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    const emptyRenameInput = container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')
    await act(async () => {
      emptyRenameInput!.value = '   '
      emptyRenameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      emptyRenameInput!.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
      await flushEffects()
    })
    expect(renameStampMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')).toBeNull()
    expect(container.textContent).toContain('Pommier, Lavande')

    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')
    expect(deleteButton).toBeTruthy()

    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    expect(container.textContent).toContain('Delete this saved stamp?')
    expect(container.querySelector('button[aria-label="Place"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Export"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Rename"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Confirm delete"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Cancel delete"]')).toBeTruthy()

    const cancelButton = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel delete"]')
    await act(async () => {
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    expect(deleteStampMock).not.toHaveBeenCalled()

    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })
    const confirmButton = container.querySelector<HTMLButtonElement>('button[aria-label="Confirm delete"]')
    await act(async () => {
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(deleteStampMock).toHaveBeenCalledWith('stamp-1')
  })

  it('cancels Saved Stamp rename drafts on Escape without saving', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')
    expect(renameInput).toBeTruthy()

    await act(async () => {
      renameInput!.focus()
      renameInput!.value = 'Discarded guild'
      renameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      renameInput!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      await flushEffects()
    })

    expect(renameStampMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')).toBeNull()
    expect(container.textContent).toContain('Pommier, Lavande')
  })

  it('cancels Saved Stamp rename drafts from the Cancel action without saving', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')
    const cancelButton = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel rename"]')
    expect(renameInput).toBeTruthy()
    expect(cancelButton).toBeTruthy()

    await act(async () => {
      renameInput!.focus()
      renameInput!.value = 'Discarded guild'
      renameInput!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })
    await act(async () => {
      renameInput!.dispatchEvent(new FocusEvent('blur', {
        bubbles: true,
        relatedTarget: cancelButton,
      }))
      cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(renameStampMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')).toBeNull()
    expect(container.textContent).toContain('Pommier, Lavande')
  })

  it('starts Saved Stamp rename as a focused edit mode with the whole name selected', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')
    expect(renameInput).toBeTruthy()
    expect(document.activeElement).toBe(renameInput)
    expect(renameInput?.selectionStart).toBe(0)
    expect(renameInput?.selectionEnd).toBe('Pommier, Lavande'.length)
    expect(container.querySelector('button[aria-label="Place"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Export"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Confirm rename"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="Cancel rename"]')).toBeTruthy()
  })

  it('previews Saved Stamp reorder during pointer drag and persists once on release', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')

    expect(visibleNames()[0]).toContain('Alpha guild')
    expect(visibleNames()[1]).toContain('Berry guild')
    expect(visibleNames()[2]).toContain('Canopy guild')

    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-3"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    installSavedStampRowRects(container)
    preparePointerGrip(sourceGrip!)

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 4,
        clientY: 190,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 4,
        clientY: 110,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Canopy guild')
    expect(visibleNames()[1]).toContain('Alpha guild')
    expect(visibleNames()[2]).toContain('Berry guild')

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 4,
        clientY: 110,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-3', 'stamp-1', 'stamp-2'])
    expect(visibleNames()[0]).toContain('Canopy guild')
    expect(visibleNames()[1]).toContain('Alpha guild')
    expect(visibleNames()[2]).toContain('Berry guild')
  })

  it('reorders Saved Stamps after the hovered row when dragging through the lower half', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')
    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-1"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    installSavedStampRowRects(container)
    preparePointerGrip(sourceGrip!)

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 5,
        clientY: 110,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 5,
        clientY: 212,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Canopy guild')
    expect(visibleNames()[2]).toContain('Alpha guild')

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 5,
        clientY: 212,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-2', 'stamp-3', 'stamp-1'])
  })

  it('previews a downward Saved Stamp reorder just before the target row midpoint', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')
    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-1"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    installSavedStampRowRects(container)
    preparePointerGrip(sourceGrip!)

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 8,
        clientY: 110,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 8,
        clientY: 156,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Alpha guild')
    expect(visibleNames()[2]).toContain('Canopy guild')

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 8,
        clientY: 156,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-2', 'stamp-1', 'stamp-3'])
  })

  it('reorders Saved Stamps after the bottom row from the list space below it', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')
    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-1"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    installSavedStampRowRects(container)
    preparePointerGrip(sourceGrip!)

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 6,
        clientY: 110,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 6,
        clientY: 260,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Canopy guild')
    expect(visibleNames()[2]).toContain('Alpha guild')

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 6,
        clientY: 260,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-2', 'stamp-3', 'stamp-1'])
  })

  it('commits the same Saved Stamp order that the pointer reorder session previews', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    installSavedStampRowRects(container)
    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')
    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-1"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    sourceGrip!.setPointerCapture = vi.fn()
    sourceGrip!.releasePointerCapture = vi.fn()

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 4,
        clientY: 110,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 4,
        clientY: 212,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Canopy guild')
    expect(visibleNames()[2]).toContain('Alpha guild')

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 4,
        clientY: 212,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-2', 'stamp-3', 'stamp-1'])
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Canopy guild')
    expect(visibleNames()[2]).toContain('Alpha guild')
  })

  it('keeps downward Saved Stamp reorder active if pointer capture is lost during row reflow', async () => {
    const baseStamp = stampLibrary.value.items[0]!
    stampLibrary.value = {
      ...stampLibrary.value,
      items: [
        { ...baseStamp, id: 'stamp-1', name: 'Alpha guild', sort_order: 0 },
        { ...baseStamp, id: 'stamp-2', name: 'Berry guild', sort_order: 1 },
        { ...baseStamp, id: 'stamp-3', name: 'Canopy guild', sort_order: 2 },
      ],
    }

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    installSavedStampRowRects(container)
    const visibleNames = () => [...container.querySelectorAll<HTMLElement>('[data-saved-stamp-row]')]
      .map((row) => row.textContent ?? '')
    const sourceGrip = container.querySelector<HTMLElement>(
      '[data-saved-stamp-row="stamp-1"] [aria-label="Reorder saved stamp"]',
    )
    expect(sourceGrip).toBeTruthy()
    preparePointerGrip(sourceGrip!)

    await act(async () => {
      sourceGrip!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 7,
        clientY: 110,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        clientY: 152,
      }))
      sourceGrip!.dispatchEvent(new PointerEvent('lostpointercapture', {
        bubbles: true,
        pointerId: 7,
      }))
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        clientY: 252,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).not.toHaveBeenCalled()
    expect(visibleNames()[0]).toContain('Berry guild')
    expect(visibleNames()[1]).toContain('Canopy guild')
    expect(visibleNames()[2]).toContain('Alpha guild')

    await act(async () => {
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 7,
        clientY: 252,
      }))
      await flushEffects()
    })

    expect(reorderStampMock).toHaveBeenCalledTimes(1)
    expect(reorderStampMock).toHaveBeenCalledWith(['stamp-2', 'stamp-3', 'stamp-1'])
  })

  it('shows a clamped visual-only thumbnail from row-body hover and Place focus', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const main = container.querySelector<HTMLElement>('[data-favorites-main]')
    const body = container.querySelector<HTMLElement>('[data-saved-stamp-body="stamp-1"]')
    const placeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Place"]')
    const exportButton = container.querySelector<HTMLButtonElement>('button[aria-label="Export"]')
    expect(main).toBeTruthy()
    expect(body).toBeTruthy()
    expect(placeButton).toBeTruthy()
    expect(exportButton).toBeTruthy()
    if (!main || !body || !placeButton || !exportButton) return

    main.getBoundingClientRect = () => elementRect({ left: 260, top: 36, width: 280, height: 520 })
    body.getBoundingClientRect = () => elementRect({ left: 280, top: 520, width: 220, height: 36 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    vi.useFakeTimers()

    try {
      await act(async () => {
        body.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
        vi.advanceTimersByTime(119)
      })
      expect(container.querySelector('[data-saved-stamp-thumbnail-overlay]')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(1)
        await Promise.resolve()
      })

      const hoverOverlay = container.querySelector<HTMLElement>('[data-saved-stamp-thumbnail-overlay]')
      expect(hoverOverlay).toBeTruthy()
      expect(hoverOverlay?.style.width).toBe('180px')
      expect(hoverOverlay?.style.height).toBe('150px')
      expect(hoverOverlay?.style.left).toBe('72px')
      expect(hoverOverlay?.style.top).toBe('442px')
      expect(hoverOverlay?.textContent).not.toContain('Pommier')
      expect(hoverOverlay?.textContent).not.toContain('2 plants')

      await act(async () => {
        body.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
        await Promise.resolve()
      })
      expect(container.querySelector('[data-saved-stamp-thumbnail-overlay]')).toBeNull()

      await act(async () => {
        placeButton.dispatchEvent(new FocusEvent('focus', { bubbles: false }))
        await Promise.resolve()
      })
      expect(container.querySelector('[data-saved-stamp-thumbnail-overlay]')).toBeTruthy()

      await act(async () => {
        placeButton.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
        exportButton.dispatchEvent(new FocusEvent('focus', { bubbles: false }))
        await Promise.resolve()
      })
      expect(container.querySelector('[data-saved-stamp-thumbnail-overlay]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('previews Saved Stamps frame resize and commits the preference when dragging ends', async () => {
    savedStampsFrameHeight.value = 240

    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    const main = container.querySelector<HTMLElement>('[data-favorites-main]')
    const frame = container.querySelector<HTMLElement>('[data-saved-stamps-frame]')
    const handle = container.querySelector<HTMLElement>(
      '[role="separator"][aria-orientation="horizontal"]',
    )

    expect(main).toBeTruthy()
    expect(frame).toBeTruthy()
    expect(handle).toBeTruthy()
    if (!main || !frame || !handle) return

    main.getBoundingClientRect = () => ({
      width: 320,
      height: 520,
      top: 0,
      right: 320,
      bottom: 520,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    expect(frame.style.height).toBe('240px')

    await act(async () => {
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientY: 300,
      }))
      handle.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientY: 250,
      }))
    })

    expect(frame.style.height).toBe('290px')
    expect(savedStampsFrameHeight.value).toBe(240)

    await act(async () => {
      handle.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        clientY: 250,
      }))
    })

    expect(savedStampsFrameHeight.value).toBe(290)
  })

  it('clamps the Saved Stamps frame to leave room for plant favorites', async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = []
      constructor(readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
      }
      observe = vi.fn()
      disconnect = vi.fn()
      unobserve = vi.fn()
    }
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = FakeResizeObserver as typeof ResizeObserver
    savedStampsFrameHeight.value = 280

    try {
      await act(async () => {
        render(<FavoritesPanel />, container)
        await flushEffects()
      })

      const main = container.querySelector<HTMLElement>('[data-favorites-main]')
      const frame = container.querySelector<HTMLElement>('[data-saved-stamps-frame]')
      const handle = container.querySelector<HTMLElement>(
        '[role="separator"][aria-orientation="horizontal"]',
      )
      expect(main).toBeTruthy()
      expect(frame).toBeTruthy()
      expect(handle).toBeTruthy()
      expect(FakeResizeObserver.instances).toHaveLength(1)
      if (!main || !frame || !handle) throw new Error('Favorites panel frames were not rendered')

      main.getBoundingClientRect = () => ({
        width: 320,
        height: 360,
        top: 0,
        right: 320,
        bottom: 360,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      const header = main.firstElementChild as HTMLElement
      header.getBoundingClientRect = () => elementRect({ height: 40 })
      handle.getBoundingClientRect = () => elementRect({ height: 8 })

      await act(async () => {
        FakeResizeObserver.instances[0]!.callback([], {} as ResizeObserver)
        await flushEffects()
      })

      expect(frame.style.height).toBe('192px')
      expect(savedStampsFrameHeight.value).toBe(280)
    } finally {
      ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalResizeObserver
    }
  })
})
