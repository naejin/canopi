import { render } from 'preact'
import { afterEach, describe, expect, it } from 'vitest'
import { PlantSymbolGlyph } from '../components/canvas/PlantSymbolGlyph'

describe('PlantSymbolGlyph', () => {
  let container: HTMLDivElement

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders curved Plant Symbol recipes as native SVG paths', () => {
    container = document.createElement('div')
    document.body.appendChild(container)

    render(<PlantSymbolGlyph symbol="groundcover" />, container)

    const pathData = [...container.querySelectorAll('path')]
      .map((path) => path.getAttribute('d') ?? '')

    expect(pathData).toHaveLength(3)
    expect(pathData.every((d) => d.startsWith('M 0 0.72 C '))).toBe(true)
  })
})
