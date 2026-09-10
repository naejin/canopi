import { render } from 'preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlantSymbolGlyph } from '../components/canvas/PlantSymbolGlyph'

describe('PlantSymbolGlyph', () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders opaque botanical silhouettes with effective native SVG attributes', () => {
    render(<PlantSymbolGlyph symbol="canopy" size={32} />, container)
    const path = container.querySelector('path')!
    expect(path.getAttribute('fill')).toBe('currentColor')
    expect(path.getAttribute('fill-opacity')).toBe('1')
    expect(path.getAttribute('fill-rule')).toBe('nonzero')
    expect(path.hasAttribute('fillOpacity')).toBe(false)
    expect(path.hasAttribute('strokeWidth')).toBe(false)
    expect(path.getAttribute('d')?.match(/M /g)).toHaveLength(2)
  })

  it('drops fine cutouts at working canvas sizes while keeping the crown silhouette', () => {
    render(<PlantSymbolGlyph symbol="canopy" size={12} />, container)
    expect(container.querySelector('path')?.getAttribute('d')?.match(/M /g)).toHaveLength(1)
  })
})
