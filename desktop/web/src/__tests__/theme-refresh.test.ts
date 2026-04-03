import { describe, expect, it } from 'vitest'
import { isThemeManagedZoneFill } from '../canvas/theme-refresh'

describe('isThemeManagedZoneFill', () => {
  it('recognizes both light and dark default zone fills as theme-managed', () => {
    expect(isThemeManagedZoneFill(null)).toBe(true)
    expect(isThemeManagedZoneFill('rgba(45, 95, 63, 0.1)')).toBe(true)
    expect(isThemeManagedZoneFill('rgba(200,180,150,0.06)')).toBe(true)
    expect(isThemeManagedZoneFill('#ff00aa')).toBe(false)
  })
})
