import { describe, expect, it } from 'vitest'
import {
  formatMetricArea,
  formatMetricDistance,
} from '../canvas/runtime/zone-measurements'

describe('zone measurements', () => {
  it('formats compact metric distances and areas', () => {
    expect(formatMetricDistance(0.42)).toBe('42 cm')
    expect(formatMetricDistance(12.4)).toBe('12 m')
    expect(formatMetricArea(0.42)).toBe('4200 cm²')
    expect(formatMetricArea(12500)).toBe('1.3 ha')
  })
})
