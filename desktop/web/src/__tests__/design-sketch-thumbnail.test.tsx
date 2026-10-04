import { render } from 'preact'
import { describe, expect, it } from 'vitest'
import { DesignSketchThumbnail, plantDotSize, plantsPath, zonesPath } from '../components/shared/DesignSketchThumbnail'

describe('Design sketch thumbnail', () => {
  it('draws zones as closed or open outlines and plants as dots', () => {
    const sketch = {
      width: 1000,
      height: 500,
      plants: [0, 500, 1000, 0],
      zones: [
        { closed: true, points: [0, 0, 10, 0, 10, 10] },
        { closed: false, points: [0, 20, 30, 20] },
      ],
    }
    expect(zonesPath(sketch)).toBe('M0 0L10 0L10 10ZM0 20L30 20')
    expect(plantsPath(sketch.plants)).toBe('M0 500h0M1000 0h0')

    const host = document.createElement('div')
    render(<DesignSketchThumbnail sketch={sketch} />, host)
    const svg = host.querySelector('svg')!
    // A margin of 8 % of the longer side on every edge, north up.
    expect(svg.getAttribute('viewBox')).toBe('-80 -80 1160 660')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    render(null, host)
  })

  it('draws finer dots for denser Designs', () => {
    expect(plantDotSize(12)).toBe(2.4)
    expect(plantDotSize(400)).toBe(1.8)
    expect(plantDotSize(2000)).toBe(1.2)
  })
})
