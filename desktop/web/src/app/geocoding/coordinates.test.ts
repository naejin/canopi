import { afterEach, describe, expect, it } from 'vitest'
import { locale } from '../settings/state'
import { formatCoordinates } from './coordinates'

describe('formatCoordinates (canopi-f47t.42, Q21)', () => {
  afterEach(() => {
    locale.value = 'en'
  })

  it('writes the hemispheres and the given decimals', () => {
    expect(formatCoordinates(48.85123, 2.35211, 6, 'en')).toBe('48.851230° N, 2.352110° E')
    expect(formatCoordinates(-33.8688, -151.2093, 4, 'en')).toBe('33.8688° S, 151.2093° W')
  })

  it('uses the locale\'s decimal separator and hemisphere letters', () => {
    locale.value = 'fr'
    expect(formatCoordinates(48.22014, 0.03512, 4, 'fr')).toBe('48,2201° N, 0,0351° E')
    locale.value = 'de'
    expect(formatCoordinates(48.22014, 2.5, 4, 'de')).toBe('48,2201° N, 2,5000° O')
  })

  it('never groups the degrees', () => {
    expect(formatCoordinates(1.5, 179.123456, 6, 'en')).toBe('1.500000° N, 179.123456° E')
  })
})
