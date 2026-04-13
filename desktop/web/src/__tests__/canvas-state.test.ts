import { beforeEach, describe, expect, it } from 'vitest'
import { plantColorByAttr, plantSizeMode } from '../canvas/plant-display-state'
import { createDefaultLayerVisibility } from '../state/canvas'

describe('canvas plant presentation state', () => {
  beforeEach(() => {
    plantSizeMode.value = 'default'
    plantColorByAttr.value = null
  })

  it('supports canopy sizing and attribute coloring at the same time', () => {
    plantSizeMode.value = 'canopy'
    plantColorByAttr.value = 'flower'

    expect(plantSizeMode.value).toBe('canopy')
    expect(plantColorByAttr.value).toBe('flower')
  })

  it('keeps size mode stable when color-by is cleared', () => {
    plantSizeMode.value = 'canopy'
    plantColorByAttr.value = 'stratum'
    plantColorByAttr.value = null

    expect(plantSizeMode.value).toBe('canopy')
    expect(plantColorByAttr.value).toBe(null)
  })

  it('uses the shared default layer visibility contract', () => {
    expect(createDefaultLayerVisibility()).toEqual({
      base: true,
      contours: false,
      climate: false,
      zones: true,
      water: false,
      plants: true,
      annotations: true,
    })
  })
})
