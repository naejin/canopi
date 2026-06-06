import { describe, expect, it } from 'vitest'
import {
  beginPlantStampFromSpecies,
  clearPlantStampSource,
  readPlantStampDragData,
  readPlantStampSource,
  selectPlantStampSource,
  writePlantStampDragData,
} from '../canvas/plant-stamp-source'

function species(overrides = {}) {
  return {
    canonical_name: 'Malus domestica',
    common_name: 'Apple',
    stratum: 'high',
    width_max_m: 4,
    ...overrides,
  }
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

describe('Plant Stamp source', () => {
  it('owns selected source lifecycle', () => {
    clearPlantStampSource()
    expect(readPlantStampSource()).toBeNull()

    selectPlantStampSource(species())

    expect(readPlantStampSource()).toEqual({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })

    clearPlantStampSource()
    expect(readPlantStampSource()).toBeNull()
  })

  it('begins Plant Stamp through a command surface', () => {
    const calls: string[] = []

    beginPlantStampFromSpecies(species({ canonical_name: 'Pyrus communis' }), {
      setTool(tool) {
        calls.push(tool)
      },
    })

    expect(readPlantStampSource()?.canonical_name).toBe('Pyrus communis')
    expect(calls).toEqual(['plant-stamp'])
  })

  it('centralizes drag data serialization and parsing', () => {
    const dataTransfer = dragDataStore()

    writePlantStampDragData(dataTransfer, species())

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(readPlantStampDragData(dataTransfer)).toEqual({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: 'high',
      width_max_m: 4,
    })
  })

  it('rejects invalid drag data at the seam', () => {
    const dataTransfer = dragDataStore()
    dataTransfer.setData('text/plain', JSON.stringify({ common_name: 'No identity' }))

    expect(readPlantStampDragData(dataTransfer)).toBeNull()
  })
})
