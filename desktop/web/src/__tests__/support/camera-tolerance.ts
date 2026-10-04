// __tests__/support/camera-tolerance.ts  (test support; imported for its effect)
//
// The headless camera holds a geographic ViewCamera (0E): a placement, a pointer or a pan goes through lon/lat and Web Mercator, so a
// world point read back from the screen lands within nanometres of today's exact plane arithmetic, not on it (named difference D7).
// A test file that compares such points with toEqual, toMatchObject or toHaveBeenCalledWith imports this module: in that file, two
// finite numbers are equal when they differ by at most 1e-6, far below a pixel or a millimetre in plane metres and CSS px. Geographic
// values are not: 1e-6 degrees is about 11 cm of ground, hundreds of pixels at the closest zoom. An object with a lon, lat, zoom or
// ground-extent key (a point, a camera, a last view, a lon/lat box) compares exactly, all the way down. Other values compare as usual.

import { expect } from 'vitest'

const CAMERA_TOLERANCE = 1e-6
const GEOGRAPHIC_KEYS = ['lon', 'lat', 'lng', 'zoom', 'west', 'south', 'east', 'north']

function isGeographic(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && GEOGRAPHIC_KEYS.some((key) => key in value)
}

expect.addEqualityTesters([
  function cameraTolerance(a: unknown, b: unknown, customTesters) {
    if (isGeographic(a) || isGeographic(b)) {
      return this.equals(a, b, customTesters.filter((tester) => tester !== cameraTolerance))
    }
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return undefined
    return Math.abs(a - b) <= CAMERA_TOLERANCE
  },
])

/** A CSS pixel length or a screen coordinate written from a projected point (`'25px'`, `'25'`), within 1e-6 px. */
export function expectScreenPx(value: string | undefined, px: number): void {
  expect(value).toMatch(/^-?[\d.e+-]+(px)?$/)
  expect(Number.parseFloat(value!)).toBeCloseTo(px, 6)
}
