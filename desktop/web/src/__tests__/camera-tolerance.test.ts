import { describe, expect, it, vi } from 'vitest'
import './support/camera-tolerance'

describe('camera tolerance', () => {
  it('plane metres and CSS px within 1e-6 compare equal, and further apart do not', () => {
    expect({ x: 120.5, y: -40.25, scale: 3.5 }).toEqual({ x: 120.5 + 9e-7, y: -40.25 - 9e-7, scale: 3.5 })
    expect([{ x: 10 }]).toMatchObject([{ x: 10 + 5e-7 }])
    expect({ x: 120.5 }).not.toEqual({ x: 120.5 + 2e-6 })
  })

  it('lon/lat, zoom and a ground extent compare exactly: 1e-6 degrees is about 11 cm of ground', () => {
    expect({ lon: 2.3522, lat: 48.8566, zoom: 18.25 }).not.toEqual({ lon: 2.3522009, lat: 48.8565991, zoom: 18.25 })
    expect({ lon: 2.3522, lat: 48.8566, zoom: 18.25 }).not.toEqual({ lon: 2.3522, lat: 48.8566, zoom: 18.2500009 })
    expect({ center: { lon: 2.35, lat: 48.85 }, zoom: 18, bearingDeg: 0, pitchDeg: 0 })
      .not.toEqual({ center: { lon: 2.35 + 5e-7, lat: 48.85 }, zoom: 18, bearingDeg: 0, pitchDeg: 0 })
    expect({ west: 2.35, south: 48.85, east: 2.36, north: 48.86 })
      .not.toEqual({ west: 2.35, south: 48.85, east: 2.36 + 5e-7, north: 48.86 })
    const persist = vi.fn()
    persist({ lon: 2.3522, lat: 48.8566, zoom: 18.25 })
    expect(persist).not.toHaveBeenCalledWith({ lon: 2.3522001, lat: 48.8566, zoom: 18.25 })
  })

  it('a geographic object still matches a subset and exact values', () => {
    const camera = { center: { lon: 2.35, lat: 48.85 }, zoom: 18, bearingDeg: 0, pitchDeg: 0 }
    expect(camera).toMatchObject({ zoom: 18 })
    expect(camera).toEqual({ center: { lon: 2.35, lat: 48.85 }, zoom: 18, bearingDeg: 0, pitchDeg: 0 })
    expect(camera).toEqual(expect.objectContaining({ center: { lon: 2.35, lat: 48.85 } }))
  })
})
