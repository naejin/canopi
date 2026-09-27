import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { SelectionChip } from '../components/canvas/SelectionChip'
import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import { plantFinderMapMatches } from '../app/plant-finder/map-matches'
import { SceneStore } from '../canvas/runtime/scene/store'
import type { SceneDesignObjectSelection } from '../canvas/runtime/scene'
import type { CanvasCommandSurface } from '../canvas/runtime/runtime'
import { setCanvasRuntimeSurfaces } from '../canvas/session'
import { selectedObjectIds } from '../canvas/session-state'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, type TestCanvasQuerySurface } from './support/canvas-query-surface'

const PLANTS = [
  { id: 'apricot-1', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'apricot-2', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'apricot-3', canonicalName: 'Prunus armeniaca', commonName: 'Apricot' },
  { id: 'fig-1', canonicalName: 'Ficus carica', commonName: 'Fig' },
  { id: 'mint-1', canonicalName: 'Mentha spicata', commonName: null },
]

describe('Selection chip', () => {
  let container: HTMLDivElement
  let queries: TestCanvasQuerySurface
  let selectSameSpecies: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['selectSameSpecies']>>
  let clearSelection: ReturnType<typeof vi.fn<CanvasCommandSurface['sceneEdits']['clearSelection']>>

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    document.body.append(container)
    const store = new SceneStore()
    store.updatePersisted((draft) => {
      draft.plants = PLANTS.map((plant, index) => ({
        id: plant.id,
        canonicalName: plant.canonicalName,
        commonName: plant.commonName,
        kind: 'plant',
        locked: false,
        color: null,
        symbol: 'herb',
        position: { x: index * 5, y: 0 },
        stratum: null,
        canopySpreadM: null,
        rotationDeg: 0,
        notes: null,
        plantedDate: null,
        quantity: 1,
      }))
      draft.zones = [{
        kind: 'zone', name: 'Z04', locked: false, zoneType: 'polygon', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      }]
      draft.annotations = [{
        kind: 'annotation', id: 'note-1', locked: false, annotationType: 'text', position: { x: 1, y: 1 },
        text: 'Mulch in November', fontSize: 14, rotationDeg: null,
      }]
      draft.groups = [{
        kind: 'group', id: 'guild', locked: false, name: 'Guild',
        members: [{ kind: 'plant', id: 'fig-1' }, { kind: 'plant', id: 'mint-1' }],
      }]
    })
    queries = createTestCanvasQuerySurface({
      scene: store.persisted,
      localizedNames: new Map([['Prunus armeniaca', 'Apricot'], ['Mentha spicata', null]]),
    })
    selectSameSpecies = vi.fn<CanvasCommandSurface['sceneEdits']['selectSameSpecies']>()
    clearSelection = vi.fn<CanvasCommandSurface['sceneEdits']['clearSelection']>()
    setCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ sceneEdits: { selectSameSpecies, clearSelection } }),
      queries,
      documents: createTestCanvasDocumentSurface(),
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    selectedObjectIds.value = new Set()
    plantFinderMapMatches.value = null
    setCanvasRuntimeSurfaces(null)
  })

  async function select(targets: SceneDesignObjectSelection): Promise<void> {
    await act(() => {
      queries.setSelection(targets)
      selectedObjectIds.value = new Set(targets.map((target) => target.id))
    })
  }

  const chip = () => container.querySelector<HTMLElement>('[data-selection-chip]')
  const status = () => chip()?.querySelector('[role="status"]')?.textContent?.replace(/\s+/g, ' ').trim()
  const buttons = () => [...(chip()?.querySelectorAll('button') ?? [])].map((button) => button.textContent)

  it('shows nothing without a selection', async () => {
    await act(() => render(<SelectionChip />, container))
    expect(chip()).toBeNull()
  })

  it('names one plant and offers Select all of this species and Clear selection', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }])

    expect(chip()!.getAttribute('role')).toBe('group')
    expect(chip()!.getAttribute('aria-label')).toBe('Selection')
    const live = chip()!.querySelector('[role="status"]')!
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(status()).toBe('Apricot')
    expect(buttons()).toEqual(['Select all of this species', 'Clear selection'])
    for (const button of chip()!.querySelectorAll('button')) {
      expect(button.getAttribute('type')).toBe('button')
      expect(button.tabIndex).toBe(0)
    }

    await act(() => chip()!.querySelector<HTMLButtonElement>('button')!.click())
    expect(selectSameSpecies).toHaveBeenCalledWith('Prunus armeniaca')
    await act(() => [...chip()!.querySelectorAll<HTMLButtonElement>('button')].at(-1)!.click())
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('counts plants of one species, and drops Select all once the whole species is selected', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }])
    expect(status()).toBe('2 plants · Apricot')
    expect(buttons()).toEqual(['Select all of this species', 'Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }, { kind: 'plant', id: 'apricot-3' }])
    expect(status()).toBe('3 plants · Apricot')
    expect(buttons()).toEqual(['Clear selection'])
  })

  it('counts species across plants, expanding groups, and falls back to the scientific name', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'group', id: 'guild' }])
    expect(status()).toBe('3 plants · 3 species')
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'plant', id: 'mint-1' }])
    expect(status()).toBe('Mentha spicata')
  })

  it('names a zone and summarises a mixed selection', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: 'Z04' }])
    expect(status()).toBe('Zone · Z04')
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }, { kind: 'zone', id: 'Z04' }, { kind: 'annotation', id: 'note-1' }])
    expect(status()).toBe('4 selected · 2 plants · 1 zone · 1 text note')
  })

  it('follows the language', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }])
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('2 plantes · 2 espèces')
    expect(buttons()).toEqual(['Effacer la sélection'])
  })

  it('sits apart from the finder chip: a separate bottom chip in the visible map area', async () => {
    plantFinderMapMatches.value = { query: 'apri', canonicalNames: ['Prunus armeniaca'] }
    await act(() => render(<><SpeciesFocusChip /><SelectionChip /></>, container))
    await select([{ kind: 'plant', id: 'apricot-1' }])
    const finder = container.querySelector('[aria-label="Plants highlighted on the map"]')
    expect(finder).not.toBeNull()
    expect(finder!.contains(chip())).toBe(false)
    expect(chip()!.dataset.selectionChip).toBe('bottom')
  })
})
