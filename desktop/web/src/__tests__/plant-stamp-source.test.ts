import { describe, expect, it } from 'vitest'
import {
  beginPlantStampFromSpecies,
  clearPlantStampSource,
  hasPlantStampDragData,
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

  it('detects drag data from MIME types while browser-protected payload data is hidden', () => {
    const values = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      effectAllowed: 'none',
      get types() {
        return Array.from(values.keys())
      },
      setData(type: string, value: string) {
        values.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return values.get(type) ?? ''
      },
    }

    writePlantStampDragData(dataTransfer, species())

    expect(hasPlantStampDragData(dataTransfer)).toBe(true)
    expect(readPlantStampDragData(dataTransfer)).toBeNull()

    protectedDragData = false
    expect(readPlantStampDragData(dataTransfer)?.canonical_name).toBe('Malus domestica')
  })

  it('does not trust protected text drag types without readable plant payload data', () => {
    const values = new Map<string, string>()
    let protectedDragData = true
    const dataTransfer = {
      get types() {
        return Array.from(values.keys())
      },
      setData(type: string, value: string) {
        values.set(type, value)
      },
      getData(type: string) {
        if (protectedDragData) return ''
        return values.get(type) ?? ''
      },
    }
    dataTransfer.setData('text/plain', JSON.stringify(species()))

    expect(hasPlantStampDragData(dataTransfer)).toBe(false)

    protectedDragData = false
    expect(readPlantStampDragData(dataTransfer)?.canonical_name).toBe('Malus domestica')
    expect(hasPlantStampDragData(dataTransfer)).toBe(true)
  })

  it('rejects invalid drag data at the seam', () => {
    const dataTransfer = dragDataStore()
    dataTransfer.setData('text/plain', JSON.stringify({ common_name: 'No identity' }))

    expect(readPlantStampDragData(dataTransfer)).toBeNull()
  })
})
