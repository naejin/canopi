import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it } from 'vitest'
import { PdfPageRail } from '../components/canvas-pdf/PdfPageRail'
import { PdfPagePreview } from '../components/canvas-pdf/PdfPagePreview'
import type { PdfPage } from '../app/canvas-pdf/types'

it('emits native SVG clipping and stroke attributes so the physical drawing matches PDF', async () => {
  const container = document.createElement('div')
  const frame = { x: 20, y: 20, width: 160, height: 100 }
  const page: PdfPage = { id: 'detail', kind: 'detail', number: 2, width: 200, height: 150, frame,
    ground: { x: 0, y: 0, width: 16, height: 10 }, pointsPerMeter: 10, legend: [],
    operations: [{ kind: 'clip', bounds: frame }, { kind: 'path', d: 'M0 0 H100 V100', matrix: [10, 0, 0, 10, 20, 20],
      fill: null, stroke: '#24211c', width: .025, opacity: 1 }, { kind: 'unclip' }] }
  try {
    await act(async () => { render(<PdfPagePreview page={page} plan={{ pages: [page], outlines: {}, blocked: null }} />, container) })
    const path = container.querySelector('path')!
    expect(path.getAttribute('stroke-width')).toBe('0.025')
    expect(path.getAttribute('stroke-linecap')).toBe('round')
    expect(path.getAttribute('stroke-linejoin')).toBe('round')
    const clipId = container.querySelector('clipPath')!.id
    expect(path.closest('[clip-path]')!.getAttribute('clip-path')).toBe(`url(#${clipId})`)
  } finally { render(null, container) }
})

it('lists overview appendices after detail/key pairs in final PDF order', async () => {
  const container = document.createElement('div')
  const frame = { x: 0, y: 0, width: 100, height: 100 }
  const make = (id: string, number: number, kind: PdfPage['kind'], sourceId?: string): PdfPage => ({ id, number, kind, sourceId,
    width: 100, height: 100, frame, ground: frame, pointsPerMeter: 1, legend: [], operations: [] })
  const pages = [make('overview', 1, 'overview'), make('area:a', 2, 'detail'), make('area:a:legend:0', 3, 'legend', 'area:a'), make('overview:legend:0', 4, 'legend', 'overview')]
  try {
    await act(async () => { render(<PdfPageRail plan={{ pages, outlines: {}, blocked: null }} setup={{ paper: 'A4', layers: [], areas: [{ id: 'a', name: 'Bed', bounds: frame }] }}
      selected="overview" disabled={false} onSelect={() => {}} onRemove={() => {}} onHover={() => {}} />, container) })
    const titles = [...container.querySelectorAll('button[aria-label^="View page"]')].map(button => button.getAttribute('aria-label'))
    expect(titles).toEqual(['View page: Overview', 'View page: Bed', 'View page: 2 · Key and notes · Page 3', 'View page: 1 · Key and notes · Page 4'])
  } finally { render(null, container) }
})
