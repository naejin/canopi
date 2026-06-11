import { describe, expect, it } from 'vitest'

import { createEllipticalZoneMeasurements } from './zone-measurements'

describe('zone measurements', () => {
  it('places Elliptical Zone dimension labels along oriented geometry', () => {
    const labels = createEllipticalZoneMeasurements(
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      90,
    )

    expect(labels.find((label) => label.id === 'ellipse-width')?.worldPosition)
      .toEqual({ x: 1, y: 0 })
    expect(labels.find((label) => label.id === 'ellipse-height')?.worldPosition)
      .toEqual({ x: 0, y: 4 })
    expect(labels.find((label) => label.id === 'area')?.text).toBe('13 m²')
  })
})
