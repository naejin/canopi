import { describe, expect, it } from 'vitest'

import {
  FALLBACK_PLANT_SPACING_INTERVAL_M,
  formatPlantSpacingGuideLength,
  formatPlantSpacingIntervalInput,
  parsePlantSpacingIntervalInput,
} from '../canvas/plant-spacing-interval'

describe('Plant Spacing interval parsing', () => {
  it('accepts positive finite metric distances and normalizes them to meters', () => {
    expect(FALLBACK_PLANT_SPACING_INTERVAL_M).toBe(0.5)
    expect(parsePlantSpacingIntervalInput('0.5')).toEqual({ valid: true, meters: 0.5 })
    expect(parsePlantSpacingIntervalInput('0.5m')).toEqual({ valid: true, meters: 0.5 })
    expect(parsePlantSpacingIntervalInput('50cm')).toEqual({ valid: true, meters: 0.5 })
    expect(parsePlantSpacingIntervalInput('25 cm')).toEqual({ valid: true, meters: 0.25 })
    expect(parsePlantSpacingIntervalInput('0,5m')).toEqual({ valid: true, meters: 0.5 })
  })

  it('rejects blank, zero, negative, NaN, infinite, and unknown-unit inputs', () => {
    expect(parsePlantSpacingIntervalInput('')).toEqual({ valid: false })
    expect(parsePlantSpacingIntervalInput('0')).toEqual({ valid: false })
    expect(parsePlantSpacingIntervalInput('-1m')).toEqual({ valid: false })
    expect(parsePlantSpacingIntervalInput('NaN')).toEqual({ valid: false })
    expect(parsePlantSpacingIntervalInput('Infinity')).toEqual({ valid: false })
    expect(parsePlantSpacingIntervalInput('10mm')).toEqual({ valid: false })
  })

  it('formats the fallback and stored meter values for the compact HUD input', () => {
    expect(formatPlantSpacingIntervalInput(FALLBACK_PLANT_SPACING_INTERVAL_M)).toBe('50 cm')
    expect(formatPlantSpacingIntervalInput(1.5)).toBe('1.5 m')
    expect(formatPlantSpacingIntervalInput(0.25)).toBe('25 cm')
    expect(formatPlantSpacingIntervalInput(0)).toBe('50 cm')
  })

  it('formats guide lengths without applying the interval fallback', () => {
    expect(formatPlantSpacingGuideLength(0)).toBe('0 cm')
    expect(formatPlantSpacingGuideLength(0.25)).toBe('25 cm')
    expect(formatPlantSpacingGuideLength(1.5)).toBe('1.5 m')
  })
})
