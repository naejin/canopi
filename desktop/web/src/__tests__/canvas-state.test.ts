import { describe, expect, it } from 'vitest'
import { createDefaultLayerVisibility } from '../app/canvas-settings/signals'

describe('canvas state contracts', () => {
  it('uses the shared default layer visibility contract', () => {
    expect(createDefaultLayerVisibility()).toEqual({
      climate: false,
      zones: true,
      water: false,
      plants: true,
      annotations: true,
    })
  })
})
