import { describe, expect, it } from 'vitest'
import { buildLocationCommit, computeSavedPinState } from '../components/canvas/location-tab-logic'

describe('location tab logic', () => {
  it('preserves altitude metadata when committing a moved location', () => {
    const next = buildLocationCommit(
      { lat: 40.7128, lon: -74.006 },
      { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
    )

    expect(next).toEqual({ lat: 40.7128, lon: -74.006, altitude_m: 35 })
  })

  it('keeps altitude null when there is no saved altitude', () => {
    const next = buildLocationCommit({ lat: 40.7128, lon: -74.006 }, null)

    expect(next).toEqual({ lat: 40.7128, lon: -74.006, altitude_m: null })
  })

  it('renders an unclamped pin when the saved location is in view', () => {
    const pin = computeSavedPinState(
      { lat: 10, lon: 12 },
      { width: 500, height: 300 },
      { x: 120, y: 160 },
    )

    expect(pin).toEqual({ visible: true, x: 120, y: 160, clamped: false, angle: 0 })
  })

  it('clamps the pin to the map edge when the saved location is off-screen', () => {
    const pin = computeSavedPinState(
      { lat: 10, lon: 12 },
      { width: 500, height: 300 },
      { x: 900, y: -50 },
    )

    expect(pin.visible).toBe(true)
    expect(pin.clamped).toBe(true)
    expect(pin.x).toBe(476)
    expect(pin.y).toBe(24)
    expect(pin.angle).toBeCloseTo(Math.atan2(-200, 650))
  })

  it('hides the pin when there is no saved location', () => {
    const pin = computeSavedPinState(null, { width: 500, height: 300 }, { x: 0, y: 0 })

    expect(pin).toEqual({ visible: false, x: 0, y: 0, clamped: false, angle: 0 })
  })
})
