import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeciesKeyPanel } from '../components/panels/SpeciesKeyPanel'
import { speciesCatalogWorkbench } from '../app/plant-browser'
import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, type TestCanvasQuerySurface } from './support/canvas-query-surface'
import { makeSpeciesListItem } from './support/species-catalog-workbench'
import type {
  CanvasCommandSurface,
  CanvasQuerySurface,
} from '../canvas/runtime/runtime'
import type { SpeciesFocus } from '../canvas/runtime/species-key'
import { SceneStore } from '../canvas/runtime/scene/store'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import { locale } from '../app/settings/state'
import { navigateTo, sidePanel } from '../app/shell/state'
import { matchedPanelTargets } from '../app/panel-targets/state'
import { readPlanningViewState } from '../app/planning-view/state'
import { plantFinderMapMatches } from '../app/plant-finder/map-matches'
import { focusOpenPlantFinder } from '../app/plant-finder/focus'
import { speciesTarget } from '../target'
import type { PlacedPlant } from '../types/design'

const plants = [
  { id: 'apple-1', canonicalName: 'Malus domestica', commonName: 'Pommier cultivé', x: 0 },
  { id: 'apple-2', canonicalName: 'Malus domestica', commonName: 'Pommier cultivé', x: 10 },
  { id: 'crab-1', canonicalName: 'Malus sylvestris', commonName: 'Pommier sauvage', x: 20 },
  { id: 'mint-1', canonicalName: 'Mentha spicata', commonName: 'Menthe verte', x: 30 },
]

describe('Plants in this Design', () => {
  let container: HTMLDivElement
  let commands: CanvasCommandSurface
  let queries: CanvasQuerySurface
  let baseQueries: TestCanvasQuerySurface
  let focusTemporaryBounds: ReturnType<typeof vi.fn<CanvasCommandSurface['viewport']['focusTemporaryBounds']>>
  let selectSpecies: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['selectSpecies']>>
  let selectSameSpecies: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['selectSameSpecies']>>
  let setPlantColorForSpecies: ReturnType<typeof vi.fn<CanvasCommandSurface['plantPresentation']['setPlantColorForSpecies']>>

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plantSpeciesCodes = { 'Malus domestica': 'MDO', 'Malus sylvestris': 'MSY', 'Mentha spicata': 'MSP' }
      draft.plants = plants.map((plant) => ({
        id: plant.id,
        canonicalName: plant.canonicalName,
        commonName: plant.commonName,
        kind: 'plant',
        locked: false,
        color: '#3e8e4e',
        symbol: 'herb',
        position: { x: plant.x, y: 0 },
        stratum: null,
        canopySpreadM: null,
        rotationDeg: 0,
        scale: 1,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }))
    })
    baseQueries = createTestCanvasQuerySurface({
      scene: store.persisted,
      plants: plants.map(placedPlant),
    })
    let focus: SpeciesFocus = { canonicalName: null, showCodes: false }
    queries = { ...baseQueries, getSpeciesFocus: () => focus }
    focusTemporaryBounds = vi.fn<CanvasCommandSurface['viewport']['focusTemporaryBounds']>(() => true)
    selectSpecies = vi.fn<CanvasCommandSurface['sceneEdits']['selectSpecies']>()
    selectSameSpecies = vi.fn<CanvasCommandSurface['sceneEdits']['selectSameSpecies']>()
    setPlantColorForSpecies = vi.fn<CanvasCommandSurface['plantPresentation']['setPlantColorForSpecies']>(() => 2)
    commands = createTestCanvasCommandSurface({
      speciesFocus: {
        focus: (canonicalName) => {
          focus = { ...focus, canonicalName }
          baseQueries.bumpSceneRevision()
        },
        showCodes: (showCodes) => {
          focus = { ...focus, showCodes }
          baseQueries.bumpSceneRevision()
        },
      },
      viewport: { focusTemporaryBounds },
      sceneEdits: { selectSpecies, selectSameSpecies },
      plantPresentation: { setPlantColorForSpecies },
    })
    setCanvasRuntimeSurfaces({
      commands,
      queries,
      documents: createTestCanvasDocumentSurface(),
    })
  })

  afterEach(() => {
    render(null, container)
    setCanvasRuntimeSurfaces(null)
    container.remove()
    sidePanel.value = null
    readPlanningViewState().plantsSearch.value = ''
    readPlanningViewState().plantsSelectedOnMap.value = false
    vi.restoreAllMocks()
  })

  it('titles the panel with plant and species counts and lists one row per species', async () => {
    await act(() => render(<SpeciesKeyPanel />, container))
    expect(container.querySelector('h2')?.textContent).toBe('Plants in this Design')
    expect(container.textContent).toContain('4 plants · 3 species')
    const rows = [...container.querySelectorAll('li')]
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain('Pommier cultivé')
    expect(rows[0]!.textContent).toContain('MDO')
    expect(rows[0]!.textContent).toContain('2')
  })

  it('finds species despite typos, marks the match and rings the matches on the map', async () => {
    await act(() => render(<><SpeciesKeyPanel /><SpeciesFocusChip /></>, container))
    await search('pomier')

    expect(rowNames()).toEqual(['Pommier cultivé', 'Pommier sauvage'])
    expect(status()).toBe('Showing results for pommier · 2 species · 3 plants')
    expect([...container.querySelectorAll('li mark')].map((mark) => mark.textContent)).toEqual(['Pommier', 'Pommier'])
    expect(matchedPanelTargets.value).toEqual([speciesTarget('Malus domestica'), speciesTarget('Malus sylvestris')])
    expect(container.textContent).toContain('3 plants match “pomier”')

    await act(() => buttonNamed('Zoom to them').click())
    expect(focusTemporaryBounds).toHaveBeenCalledWith(
      { minX: -2, minY: -2, maxX: 22, maxY: 2 },
      expect.objectContaining({ paddingCssPx: expect.any(Number) }),
    )
    await act(() => buttonNamed('Select all 3').click())
    expect(selectSpecies).toHaveBeenCalledWith(['Malus domestica', 'Malus sylvestris'])
    expect(queries.getSceneSnapshot().plants).toHaveLength(4)

    await act(() => buttonNamed('Clear').click())
    expect(searchField().value).toBe('')
    expect(matchedPanelTargets.value).toEqual([])
    expect(plantFinderMapMatches.value).toBeNull()
    expect(rowNames()).toHaveLength(3)
  })

  it('matches codes and names in other catalog languages', async () => {
    vi.spyOn(speciesCatalogWorkbench, 'resolveCommonNames').mockImplementation(async (names, requested): Promise<Record<string, string>> => (
      requested === 'de' && names.includes('Mentha spicata') ? { 'Mentha spicata': 'Grüne Minze' } : {}
    ))
    await act(async () => { render(<SpeciesKeyPanel />, container) })
    await act(async () => { await Promise.resolve() })
    await search('msy')
    expect(rowNames()).toEqual(['Pommier sauvage'])
    await search('grune minze')
    expect(rowNames()).toEqual(['Menthe verte'])
  })

  it('selects one species from its row and offers close catalog matches', async () => {
    vi.spyOn(speciesCatalogWorkbench, 'searchCloseMatches').mockResolvedValue([
      { ...makeSpeciesListItem('Malus floribunda'), common_name: 'Pommier du Japon' },
      { ...makeSpeciesListItem('Malus domestica'), common_name: 'Pommier cultivé' },
    ])
    vi.useFakeTimers()
    try {
      await act(() => render(<SpeciesKeyPanel />, container))
      await search('pommier')
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    } finally {
      vi.useRealTimers()
    }
    await act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Select the 2 Pommier cultivé plants on the map"]')!.click())
    expect(selectSameSpecies).toHaveBeenCalledWith('Malus domestica')

    expect(container.textContent).toContain('In the catalog, not in this Design')
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="Open Pommier du Japon in the plant catalog"]')!
    expect(container.querySelectorAll('button[aria-label^="Open "]')).toHaveLength(1)
    const select = vi.spyOn(speciesCatalogWorkbench, 'selectSpecies').mockImplementation(() => {})
    await act(() => open.click())
    expect(sidePanel.value).toBe('plant-db')
    expect(select).toHaveBeenCalledWith('Malus floribunda')
  })

  it('filters to the species selected on the map as the selection changes', async () => {
    await act(() => render(<SpeciesKeyPanel />, container))
    const chip = buttonNamed('Selected on map')
    await act(() => chip.click())
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Select plants on the map to list their species here.')

    await act(() => {
      baseQueries.setSelection([{ kind: 'plant', id: 'crab-1' }, { kind: 'plant', id: 'mint-1' }])
      baseQueries.bumpSceneRevision()
    })
    expect(rowNames()).toEqual(['Pommier sauvage', 'Menthe verte'])
    expect(buttonNamed('Selected on map · 2').getAttribute('aria-pressed')).toBe('true')
    expect(status()).toBe('2 species · 2 plants selected on the map')
  })

  it('focuses the finder on Ctrl F and highlights one species without editing or selecting', async () => {
    const before = queries.getSceneSnapshot()
    await act(() => render(<><SpeciesKeyPanel /><SpeciesFocusChip /></>, container))
    expect(focusOpenPlantFinder()).toBe(true)
    expect(document.activeElement).toBe(searchField())

    const row = container.querySelector<HTMLButtonElement>('li button[aria-pressed]')!
    await act(() => row.click())
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(row.closest('li')?.getAttribute('data-selected')).toBe('true')
    expect(queries.getSelection()).toEqual([])
    expect(queries.getSceneSnapshot()).toEqual(before)
    expect(container.textContent).toContain('Pommier cultivé · 2 plants highlighted')
    await act(() => buttonNamed('Select these plants').click())
    expect(selectSameSpecies).toHaveBeenCalledWith('Malus domestica')
    await act(() => buttonNamed('Clear').click())
    expect(queries.getSpeciesFocus().canonicalName).toBeNull()
  })

  it('switches map labels between names and codes and recolours a species from its swatch', async () => {
    await act(() => render(<SpeciesKeyPanel />, container))
    const display = buttonNamed('Display on the map')
    expect(display.getAttribute('aria-expanded')).toBe('false')
    await act(() => display.click())
    const codes = container.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]')!
    expect(codes.textContent).toBe('Codes')
    await act(() => codes.click())
    expect(queries.getSpeciesFocus().showCodes).toBe(true)

    const swatch = container.querySelector<HTMLInputElement>('input[aria-label="Color of Menthe verte"]')!
    await act(() => {
      swatch.value = '#aa3355'
      swatch.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setPlantColorForSpecies).toHaveBeenCalledWith('Mentha spicata', '#aa3355')
  })

  it('opens edition-specific detail and returns to its detail trigger', async () => {
    await act(() => render(<SpeciesKeyPanel renderDetail={name => <button onClick={() => speciesCatalogWorkbench.closeSpeciesDetail()}>Back from {name}</button>} />, container))
    const detail = container.querySelector<HTMLButtonElement>('[aria-label="Details for Menthe verte"]')!
    detail.focus()
    await act(async () => detail.click())
    expect(container.textContent).toContain('Back from Mentha spicata')
    expect(queries.getSpeciesFocus().canonicalName).toBeNull()
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Details for Menthe verte')
  })

  it('keeps a clearable focus when the panel is replaced by Layers', async () => {
    await act(() => {
      navigateTo('species-key')
      commands.speciesFocus.focus('Mentha spicata')
      render(<SpeciesKeyPanel />, container)
    })
    await act(() => {
      navigateTo('layers')
      render(<SpeciesFocusChip />, container)
    })
    expect(sidePanel.value).toBe('layers')
    expect(container.textContent).toContain('Menthe verte · 1 plant highlighted')
    await act(() => buttonNamed('Clear').click())
    expect(queries.getSpeciesFocus().canonicalName).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('shows the empty state with a way to the catalog', async () => {
    setCanvasRuntimeSurfaces({
      commands,
      queries: createTestCanvasQuerySurface(),
      documents: createTestCanvasDocumentSurface(),
    })
    await act(() => render(<SpeciesKeyPanel />, container))
    expect(container.textContent).toContain('No plants yet.')
    await act(() => buttonNamed('Open plant catalog').click())
    expect(sidePanel.value).toBe('plant-db')
  })

  function searchField(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('input[type="search"]')!
  }

  async function search(value: string): Promise<void> {
    await act(() => {
      const field = searchField()
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function rowNames(): string[] {
    return [...container.querySelectorAll('li button[aria-pressed] strong')].map((node) => node.textContent ?? '')
  }

  function status(): string {
    return container.querySelector('p[role="status"]')?.textContent ?? ''
  }

  function buttonNamed(name: string): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === name)!
  }
})

function placedPlant(plant: typeof plants[number]): PlacedPlant {
  return {
    id: plant.id,
    canonical_name: plant.canonicalName,
    common_name: plant.commonName,
    color: null,
    position: { lon: 0, lat: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}
