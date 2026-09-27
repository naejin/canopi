import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeCanopiDesign } from '../app/contracts/design-ingestion'
import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import { composeDocumentForSave } from '../app/contracts/document'
import { readPlantDisplayOptions, setPlantDisplayOptions } from '../app/design-edit/plant-display'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { cyclePlantLabels } from '../app/plant-display/actions'
import { currentPlantDisplay, designStrata } from '../app/plant-display/state'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import {
  buildPlantPresentationEntries,
  resolvePlantDisplayColor,
} from '../canvas/runtime/plant-presentation'
import {
  DEFAULT_PLANT_DISPLAY,
  NO_STRATUM_DISPLAY_COLOR,
  STRATUM_DISPLAY_COLORS,
  nextPlantLabelMode,
  normalizePlantDisplay,
  resolveDisplayedPlantColor,
  setCanvasPlantDisplay,
  type PlantDisplay,
} from '../canvas/runtime/plant-display'
import { buildCanvasPrintSnapshot } from '../canvas/runtime/print-snapshot'
import { contrastRatio } from '../canvas/plant-colors'
import type { ScenePlantEntity } from '../canvas/runtime/scene'
import type { CanopiFile } from '../types/design'
import { designSessionFixture, replaceCurrentDesignState } from './support/design-session-state'

function design(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 8,
    name: 'Display',
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    views: [],
    stories: [],
    created_at: '2026-09-27T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    extra: {},
    ...overrides,
  }
}

function plant(id: string, canonicalName: string, x: number, color: string | null = '#3E8E4E'): ScenePlantEntity {
  return {
    kind: 'plant',
    id,
    locked: false,
    canonicalName,
    commonName: null,
    color,
    stratum: null,
    canopySpreadM: null,
    position: { x, y: 0 },
    rotationDeg: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
  }
}

const consortium = (canonicalName: string, stratum: string) => ({
  target: { kind: 'species' as const, canonical_name: canonicalName },
  stratum,
  start_phase: 0,
  end_phase: 2,
})

afterEach(() => {
  setCanvasPlantDisplay(DEFAULT_PLANT_DISPLAY)
  designSessionFixture.file = null
})

describe('plant display rules', () => {
  it('draws the stored colour, the Consortium stratum colour or the one colour', () => {
    const display = normalizePlantDisplay({
      strata: new Map([['Malus domestica', 'high'], ['Mentha spicata', 'low']]),
    })
    expect(resolveDisplayedPlantColor('#3E8E4E', 'Malus domestica', display)).toBe('#3E8E4E')
    const stratum = { ...display, colorBy: 'stratum' as const }
    expect(resolveDisplayedPlantColor('#3E8E4E', 'Malus domestica', stratum)).toBe(STRATUM_DISPLAY_COLORS.high)
    expect(resolveDisplayedPlantColor('#3E8E4E', 'Mentha spicata', stratum)).toBe(STRATUM_DISPLAY_COLORS.low)
    expect(resolveDisplayedPlantColor('#3E8E4E', 'Rubus idaeus', stratum)).toBe(NO_STRATUM_DISPLAY_COLOR)
    const one = { ...display, colorBy: 'one-color' as const, oneColor: '#AA3355' }
    expect(resolveDisplayedPlantColor('#3E8E4E', 'Malus domestica', one)).toBe('#AA3355')
  })

  it('keeps the stratum colours apart from each other and from the no-stratum grey', () => {
    const colors = [...Object.values(STRATUM_DISPLAY_COLORS), NO_STRATUM_DISPLAY_COLOR]
    expect(new Set(colors).size).toBe(5)
    // Each colour stays visible on the light paper the softened background shows.
    for (const color of colors) expect(contrastRatio(color, '#F3EFE4')).toBeGreaterThan(1.8)
  })

  it('cycles labels None, Codes, Names and repairs invalid display values', () => {
    expect(nextPlantLabelMode('none')).toBe('codes')
    expect(nextPlantLabelMode('codes')).toBe('names')
    expect(nextPlantLabelMode('names')).toBe('none')
    expect(normalizePlantDisplay({ colorBy: 'rainbow' as never, oneColor: 'red', symbolScale: 9, labels: 'all' as never }))
      .toMatchObject({ colorBy: 'species', oneColor: DEFAULT_PLANT_DISPLAY.oneColor, symbolScale: 2, labels: 'names' })
  })

  it('draws and prints with the display colour, never changing stored colours', () => {
    const plants = [plant('a', 'Malus domestica', 0), plant('b', 'Mentha spicata', 40)]
    const context = { plants, viewport: { x: 0, y: 0, scale: 20 }, speciesCache: new Map() }

    const display: PlantDisplay = normalizePlantDisplay({
      colorBy: 'stratum',
      strata: new Map([['Malus domestica', 'emergent']]),
    })
    expect(setCanvasPlantDisplay(display)).toBe(true)
    expect(setCanvasPlantDisplay(normalizePlantDisplay({ ...display, strata: new Map(display.strata) }))).toBe(false)
    const after = buildPlantPresentationEntries(plants, context, new Set())
    expect(after.map((entry) => entry.color)).toEqual([STRATUM_DISPLAY_COLORS.emergent, NO_STRATUM_DISPLAY_COLOR])
    expect(after.map((entry) => entry.baseColor)).toEqual(['#3E8E4E', '#3E8E4E'])
    expect(plants.every((entry) => entry.color === '#3E8E4E')).toBe(true)
    expect(resolvePlantDisplayColor(plants[1]!, new Map())).toBe(NO_STRATUM_DISPLAY_COLOR)

    const print = buildCanvasPrintSnapshot({
      plantSpeciesColors: {}, plantSpeciesSymbols: {}, plantSpeciesCodes: {}, layers: [], plants,
      zones: [], annotations: [], measurementGuides: [], groups: [], guides: [],
    }, context)
    expect(print.plants.map((entry) => entry.color)).toEqual([STRATUM_DISPLAY_COLORS.emergent, NO_STRATUM_DISPLAY_COLOR])
  })

})

describe('plant display as Design data', () => {
  it('stores changed options in extra.plant_display, dirties the Design and round-trips through the file', () => {
    replaceCurrentDesignState(design(), null, 'Display')
    expect(designSessionStore.designDirty.value).toBe(false)

    setPlantDisplayOptions({ colorBy: 'one-color', oneColor: '#aa3355', labels: 'codes', symbolScale: 1.3, outline: false })
    expect(designSessionStore.designDirty.value).toBe(true)
    expect(currentDesign.value?.extra?.plant_display).toEqual({
      color_by: 'one_color', one_color: '#AA3355', symbol_scale: 1.3, outline: false, labels: 'codes',
    })

    const saved = composeDocumentForSave({
      metadata: { name: 'Display', description: null },
      document: currentDesign.value!,
      canvas: design(),
    } as never)
    const wire = encodeCanopiDesign(saved)
    expect(wire.plant_display).toMatchObject({ color_by: 'one_color' })
    expect(readPlantDisplayOptions(decodeCanopiDesign(wire))).toEqual({
      colorBy: 'one-color', oneColor: '#AA3355', symbolScale: 1.3, outline: false, labels: 'codes',
    })
  })

  it('leaves the Design untouched when nothing changes and drops the key at the defaults', () => {
    replaceCurrentDesignState(design(), null, 'Display')
    const before = currentDesign.value
    setPlantDisplayOptions({ labels: 'names', colorBy: 'species' })
    expect(currentDesign.value).toBe(before)

    setPlantDisplayOptions({ labels: 'none' })
    setPlantDisplayOptions({ labels: 'names' })
    expect(currentDesign.value?.extra).not.toHaveProperty('plant_display')
  })

  it('reads invalid stored options as defaults', () => {
    expect(readPlantDisplayOptions(design({ extra: { plant_display: 'loud' } }))).toMatchObject({ colorBy: 'species', labels: 'names' })
    expect(readPlantDisplayOptions(design({
      extra: { plant_display: { color_by: 'stratum', one_color: 'nope', symbol_scale: 40, outline: 'yes', labels: 'codes' } },
    }))).toEqual({ colorBy: 'stratum', oneColor: DEFAULT_PLANT_DISPLAY.oneColor, symbolScale: 2, outline: true, labels: 'codes' })
  })

  it('cycles labels from the Design value', () => {
    replaceCurrentDesignState(design(), null, 'Display')
    cyclePlantLabels()
    expect(currentPlantDisplay.value.labels).toBe('none')
    cyclePlantLabels()
    expect(currentPlantDisplay.value.labels).toBe('codes')
  })

  it('colours by the Design Consortium strata, not catalog data', () => {
    const file = design({
      consortiums: [
        consortium('Malus domestica', 'high'),
        consortium('Mentha spicata', 'unassigned'),
        consortium('Juglans regia', 'emergent'),
      ],
    })
    expect([...designStrata(file)]).toEqual([['Malus domestica', 'high'], ['Juglans regia', 'emergent']])
    replaceCurrentDesignState(file, null, 'Display')
    expect(currentPlantDisplay.value.strata.get('Mentha spicata')).toBeUndefined()
  })

  it('hands the runtime every display change through the app adapter', () => {
    replaceCurrentDesignState(design(), null, 'Display')
    const adapter = createAppCanvasRuntimeAppAdapter({ presentationData: {} })
    const onDisplay = vi.fn()
    const dispose = adapter.plantDisplay!.subscribe(onDisplay)
    expect(onDisplay).toHaveBeenLastCalledWith(expect.objectContaining({ labels: 'names' }))
    setPlantDisplayOptions({ colorBy: 'stratum' })
    expect(onDisplay).toHaveBeenLastCalledWith(expect.objectContaining({ colorBy: 'stratum' }))
    dispose()
  })
})
