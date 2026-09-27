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
import { generatedZoneName, isGeneratedZoneName } from '../canvas/runtime/zone-names'
import {
  createTestCanvasCommandSurface,
  createTestCanvasDocumentSurface,
} from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface, type TestCanvasQuerySurface } from './support/canvas-query-surface'

const RECT_ID = 'zone-ee08f9f9-634f-4723-bbde-1200610562dc'
const ELLIPSE_ID = 'zone-0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b'
const LINE_ID = 'zone-9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const GUIDE_ID = 'measurement-guide-6f1e2d3c-4b5a-4968-8776-655443322110'

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
      }, {
        // Drawn with the Rectangle tool and never named: its name is its generated id.
        kind: 'zone', name: RECT_ID, locked: false, zoneType: 'rect', rotationDeg: 30, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 }],
      }, {
        kind: 'zone', name: `${ELLIPSE_ID} copy`, locked: false, zoneType: 'ellipse', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 50, y: 50 }, { x: 10, y: 5 }],
      }, {
        kind: 'zone', name: LINE_ID, locked: false, zoneType: 'line', rotationDeg: 0, fillColor: null, notes: null,
        points: [{ x: 0, y: 0 }, { x: 30, y: 40 }],
      }]
      draft.annotations = [{
        kind: 'annotation', id: 'note-1', locked: false, annotationType: 'text', position: { x: 1, y: 1 },
        text: 'Mulch in November', fontSize: 14, rotationDeg: null,
      }]
      draft.measurementGuides = [{
        kind: 'measurement-guide', id: GUIDE_ID, locked: false, start: { x: 0, y: 0 }, end: { x: 3, y: 4 },
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
    expect(status()).toBe('2 plants · Apricot · 5 m apart')
    expect(buttons()).toEqual(['Select all of this species', 'Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }, { kind: 'plant', id: 'apricot-3' }])
    expect(status()).toBe('3 plants · Apricot · 5 m apart')
    expect(buttons()).toEqual(['Clear selection'])
  })

  it('counts species across plants, expanding groups, and falls back to the scientific name', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'group', id: 'guild' }])
    expect(status()).toBe('3 plants · 3 species · 8.3 m apart')
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'plant', id: 'mint-1' }])
    expect(status()).toBe('Mentha spicata')
  })

  it('gives the spacing of the selected plants', async () => {
    await act(() => render(<SelectionChip />, container))
    // Plants sit 5 m apart in a row; the mean nearest-neighbour distance is 5 m.
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'apricot-2' }, { kind: 'plant', id: 'apricot-3' }])
    expect(status()).toBe('3 plants · Apricot · 5 m apart')
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }, { kind: 'plant', id: 'mint-1' }])
    // 1 → 4 and 4 ↔ 5: (15 + 5 + 5) / 3 m.
    expect(status()).toBe('3 plants · 3 species · 8.3 m apart')
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('3 plantes · 3 espèces · espacées de 8,3 m')
  })

  it('names a zone by its name, with its area and perimeter', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: 'Z04' }])
    // A right triangle with 10 m legs: 50 m², 10 + 10 + 14.1 m around.
    expect(status()).toBe('Zone · Z04 · 50 m² · 34.1 m')
  })

  it('never shows an id: an unnamed zone is named by its type', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: RECT_ID }])
    expect(status()).toBe('Rectangle zone · 120 m² · 44 m')
    await select([{ kind: 'zone', id: `${ELLIPSE_ID} copy` }])
    // π · 10 · 5 m², and Ramanujan's perimeter of a 20 × 10 m ellipse.
    expect(status()).toBe('Ellipse zone · 157 m² · 48.4 m')
    await select([{ kind: 'zone', id: LINE_ID }])
    expect(status()).toBe('Line zone · 50 m')
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('Zone linéaire · 50 m')
  })

  it('names a text note by its text and a measurement by its length', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'annotation', id: 'note-1' }])
    expect(status()).toBe('Text note · Mulch in November')
    await select([{ kind: 'measurement-guide', id: GUIDE_ID }])
    expect(status()).toBe('Measurement · 5 m')
  })

  it('names a zone and summarises a mixed selection', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'zone', id: 'Z04' }])
    expect(status()).toContain('Zone · Z04')
    expect(buttons()).toEqual(['Clear selection'])

    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }, { kind: 'zone', id: 'Z04' }, { kind: 'annotation', id: 'note-1' }])
    expect(status()).toBe('4 selected · 2 plants · 1 zone · 1 text note')
  })

  it('follows the language', async () => {
    await act(() => render(<SelectionChip />, container))
    await select([{ kind: 'plant', id: 'apricot-1' }, { kind: 'plant', id: 'fig-1' }])
    await act(() => { locale.value = 'fr' })
    expect(status()).toBe('2 plantes · 2 espèces · espacées de 15 m')
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

  it('never shows an object id, whatever is selected', async () => {
    await act(() => render(<SelectionChip />, container))
    const scene = queries.getSceneSnapshot()
    const ids = [
      ...scene.plants.map((plant) => plant.id),
      ...scene.zones.map((zone) => zone.name).filter((name) => name !== 'Z04'),
      ...scene.annotations.map((note) => note.id),
      ...scene.measurementGuides.map((guide) => guide.id),
      ...scene.groups.map((group) => group.id),
    ]
    const targets: SceneDesignObjectSelection = [
      ...scene.plants.map((plant) => ({ kind: 'plant' as const, id: plant.id })),
      ...scene.zones.map((zone) => ({ kind: 'zone' as const, id: zone.name })),
      ...scene.annotations.map((note) => ({ kind: 'annotation' as const, id: note.id })),
      ...scene.measurementGuides.map((guide) => ({ kind: 'measurement-guide' as const, id: guide.id })),
      { kind: 'group' as const, id: 'guild' },
    ]
    const selections: SceneDesignObjectSelection[] = [
      ...targets.map((target) => [target]),
      targets,
      targets.filter((target) => target.kind === 'zone'),
      [{ kind: 'group', id: 'guild' }, { kind: 'annotation', id: 'note-1' }],
    ]
    for (const selection of selections) {
      await select(selection)
      const text = chip()!.textContent ?? ''
      for (const id of ids) expect(text).not.toContain(id)
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
  })
})

describe('generated zone names', () => {
  it('tells a drawn zone\'s generated id, and pasted copies of it, from a name the user gave', () => {
    expect(isGeneratedZoneName(generatedZoneName())).toBe(true)
    expect(isGeneratedZoneName(`${RECT_ID} copy`)).toBe(true)
    expect(isGeneratedZoneName(`${RECT_ID} copy 3`)).toBe(true)
    expect(isGeneratedZoneName('0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b')).toBe(true)
    for (const name of ['Z04', 'Zone 1', 'zone-garden', 'Verger syntropique', `${RECT_ID} (north)`]) {
      expect(isGeneratedZoneName(name)).toBe(false)
    }
  })
})
