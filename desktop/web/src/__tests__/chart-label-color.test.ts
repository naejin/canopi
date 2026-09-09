import { describe, expect, it } from 'vitest'
import { chartLabelColor } from '../canvas/chart-label-color'

describe('chart label contrast', () => {
  it('keeps dark green species bars readable in both themes', () => {
    expect(chartLabelColor('#18501D', '#25211B', 0.85)).toBe('#FFFFFF')
    expect(chartLabelColor('#18501D', '#EDE8DD', 0.85)).toBe('#FFFFFF')
  })

  it('uses dark ink for pale authored colors regardless of theme', () => {
    expect(chartLabelColor('#FFF3A0', '#25211B', 0.85)).toBe('#000000')
    expect(chartLabelColor('#FFF3A0', '#EDE8DD', 0.85)).toBe('#000000')
  })

  it('accounts for opacity, including computed RGB backgrounds', () => {
    expect(chartLabelColor('#000', 'rgb(255, 255, 255)', 0.1)).toBe('#000000')
    expect(chartLabelColor('#000', 'rgb(255, 255, 255)', 1)).toBe('#FFFFFF')
    expect(chartLabelColor('rgb(255, 243, 160)', '#fff', 0.8)).toBe('#000000')
  })
})
