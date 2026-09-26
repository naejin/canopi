import { describe, expect, it } from 'vitest'
import { isThemeManagedZoneFill } from '../canvas/theme-refresh'

describe('isThemeManagedZoneFill', () => {
  it('recognizes both light and dark default zone fills as theme-managed', () => {
    expect(isThemeManagedZoneFill(null)).toBe(true)
    expect(isThemeManagedZoneFill('rgba(255, 243, 214, 0.1)')).toBe(true)
    expect(isThemeManagedZoneFill('rgba(255,243,214,0.08)')).toBe(true)
    expect(isThemeManagedZoneFill('rgba(45, 95, 63, 0.1)')).toBe(false)
    expect(isThemeManagedZoneFill('#ff00aa')).toBe(false)
  })
})
