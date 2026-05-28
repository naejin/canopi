import { describe, it, expect } from 'vitest'
import { formatCurrency, escapeCsvField } from '../components/canvas/budget-helpers'

describe('formatCurrency', () => {
  it('formats a number as currency', () => {
    const result = formatCurrency(5.5, 'USD')
    expect(result).toContain('5.50')
  })

  it('handles invalid currency gracefully', () => {
    const result = formatCurrency(10, 'INVALID')
    expect(result).toContain('10.00')
  })
})

describe('escapeCsvField', () => {
  it('wraps fields containing commas in quotes', () => {
    expect(escapeCsvField('hello, world')).toBe('"hello, world"')
  })

  it('returns plain fields unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('doubles embedded double-quotes and wraps', () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps fields containing newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('sanitizes formula injection prefixes', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(escapeCsvField('+CMD')).toBe("'+CMD")
    expect(escapeCsvField('-HYPERLINK')).toBe("'-HYPERLINK")
    expect(escapeCsvField('@import')).toBe("'@import")
  })
})
