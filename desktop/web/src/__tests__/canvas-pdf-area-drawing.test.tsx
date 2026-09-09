import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
import { PdfPagePreview } from '../components/canvas-pdf/PdfPagePreview'
import type { PdfPage } from '../app/canvas-pdf/types'

it('maps a drag through fitted-page whitespace into ground coordinates and cancels interrupted drags', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const page: PdfPage = { id: 'overview', kind: 'overview', number: 1, width: 200, height: 100,
    frame: { x: 20, y: 10, width: 160, height: 80 }, ground: { x: 100, y: 200, width: 16, height: 8 },
    pointsPerMeter: 10, operations: [], legend: [], ambiguousSpecies: [], overflow: false }
  const onPrintArea = vi.fn()
  try {
    await act(async () => { render(<PdfPagePreview page={page} plan={{ pages: [page], outlines: {}, blocked: null }} drawing onPrintArea={onPrintArea} />, container) })
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000))
    const captured = new Set<number>()
    svg.setPointerCapture = vi.fn((id) => { captured.add(id) })
    svg.hasPointerCapture = vi.fn((id) => captured.has(id))
    svg.releasePointerCapture = vi.fn((id) => { captured.delete(id) })
    const pointer = async (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true })
      Object.defineProperty(event, 'pointerId', { value: 7 })
      await act(async () => { svg.dispatchEvent(event) })
    }
    // 200x100 paper centered inside a 1000x1000 SVG: top whitespace is 250 px.
    await pointer('pointerdown', 200, 400)
    await pointer('pointermove', 500, 550)
    expect(svg.querySelector('[data-print-area-draft]')).not.toBeNull()
    await pointer('pointerup', 500, 550)
    expect(onPrintArea).toHaveBeenCalledExactlyOnceWith({ x: 102, y: 202, width: 6, height: 3 })
    expect(captured.size).toBe(0)
    await pointer('pointerdown', 200, 400)
    await pointer('pointermove', 500, 550)
    await pointer('pointercancel', 500, 550)
    expect(svg.querySelector('[data-print-area-draft]')).toBeNull()
    expect(onPrintArea).toHaveBeenCalledOnce()
    expect(captured.size).toBe(0)
  } finally { render(null, container); container.remove() }
})
