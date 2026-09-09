import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it } from 'vitest'
import { PdfPagePreview } from '../components/canvas-pdf/PdfPagePreview'
import type { PdfPage } from '../app/canvas-pdf/types'

it('emits native SVG clipping and stroke attributes so the physical drawing matches PDF', async () => {
  const container = document.createElement('div')
  const frame = { x: 20, y: 20, width: 160, height: 100 }
  const page: PdfPage = { id: 'detail', kind: 'detail', number: 2, width: 200, height: 150, frame,
    ground: { x: 0, y: 0, width: 16, height: 10 }, pointsPerMeter: 10, legend: [], ambiguousSpecies: [], overflow: false,
    operations: [{ kind: 'clip', bounds: frame }, { kind: 'path', d: 'M0 0 H100 V100', matrix: [10, 0, 0, 10, 20, 20],
      fill: null, stroke: '#24211c', width: .025, opacity: 1 }, { kind: 'unclip' }] }
  try {
    await act(async () => { render(<PdfPagePreview page={page} plan={{ pages: [page], outlines: {}, blocked: null }} />, container) })
    const path = container.querySelector('path')!
    expect(path.getAttribute('stroke-width')).toBe('0.025')
    expect(path.getAttribute('stroke-linecap')).toBe('round')
    expect(path.getAttribute('stroke-linejoin')).toBe('round')
    const clipId = container.querySelector('clipPath')!.id
    expect(path.parentElement!.getAttribute('clip-path')).toBe(`url(#${clipId})`)
  } finally { render(null, container) }
})
