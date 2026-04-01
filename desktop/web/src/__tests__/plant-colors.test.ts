import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLANT_COLOR,
  hexToHsl,
  hslToHex,
  pointerPositionToHue,
  pointerPositionToSaturationLightness,
} from '../canvas/plant-colors'

describe('plant color utilities', () => {
  it('round-trips hex colors through HSL', () => {
    const hsl = hexToHsl(DEFAULT_PLANT_COLOR)
    expect(hsl).not.toBeNull()
    expect(hslToHex(hsl!)).toBe(DEFAULT_PLANT_COLOR)
  })

  it('maps pointer positions to hue and saturation/lightness ranges', () => {
    const rect = {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    } as DOMRect

    expect(pointerPositionToHue(20, rect)).toBe(0)
    expect(pointerPositionToHue(120, rect)).toBe(360)
    expect(pointerPositionToSaturationLightness(10, 20, rect)).toEqual({ s: 0, l: 100 })
    expect(pointerPositionToSaturationLightness(210, 120, rect)).toEqual({ s: 100, l: 0 })
  })
})
