import { describe, expect, it } from 'vitest'
import { formatCount } from '../utils/format-count'

// Intl uses narrow no-break spaces as French group separators.
const spaces = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

describe('formatCount', () => {
  it('formats a count shown on its own for the locale', () => {
    expect(formatCount(2201, 'en')).toBe('2,201')
    expect(spaces(formatCount(2201, 'fr'))).toBe('2 201')
    expect(formatCount(12, 'de')).toBe('12')
  })
})
