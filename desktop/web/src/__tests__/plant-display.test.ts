import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeCanopiDesign } from '../app/contracts/design-ingestion'
import { encodeCanopiDesign } from '../app/contracts/canopi-design-wire'
import { composeDocumentForSave } from '../app/contracts/document'
import { readPlantDisplayOptions, setPlantDisplayOptions } from '../app/design-edit/plant-display'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { cyclePlantLabels } from '../app/plant-display/actions'
import { currentPlantDisplay } from '../app/plant-display/state'
import { createAppCanvasRuntimeAppAdapter } from '../app/canvas-runtime/app-adapter'
import {
  DEFAULT_PLANT_DISPLAY,
  nextPlantLabelMode,
  normalizePlantDisplay,
  setCanvasPlantDisplay,
} from '../canvas/runtime/plant-display'
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

afterEach(() => {
  setCanvasPlantDisplay(DEFAULT_PLANT_DISPLAY)
  designSessionFixture.file = null
})

describe('plant display labels', () => {
  it('cycles labels None, Codes, Names and repairs invalid display values', () => {
    expect(nextPlantLabelMode('none')).toBe('codes')
    expect(nextPlantLabelMode('codes')).toBe('names')
    expect(nextPlantLabelMode('names')).toBe('none')
    expect(normalizePlantDisplay({ colorBy: 'rainbow' as never, oneColor: 'red', symbolScale: 9, labels: 'all' as never }))
      .toMatchObject({ colorBy: 'species', oneColor: DEFAULT_PLANT_DISPLAY.oneColor, symbolScale: 2, labels: 'names' })
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
