import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
import { PdfPageEditor } from '../components/canvas-pdf/PdfPageEditor'
import type { PdfPage } from '../app/canvas-pdf/types'

it('maps a drag through fitted-page whitespace into ground coordinates and cancels interrupted drags', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const page: PdfPage = { id: 'overview', kind: 'overview', number: 1, width: 200, height: 100,
    frame: { x: 20, y: 10, width: 160, height: 80 }, ground: { x: 100, y: 200, width: 16, height: 8 },
    pointsPerMeter: 10, operations: [], legend: [], ambiguousSpecies: [], overflow: false }
  const onPrintArea = vi.fn()
  try {
    await act(async () => { render(<PdfPageEditor page={page} plan={{ pages: [page], outlines: {}, blocked: null }} adding onPrintArea={onPrintArea} />, container) })
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

it('commits framing once, cancels lost capture and Escape, and ignores clicks while drawing', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const page: PdfPage = { id: 'overview', kind: 'overview', number: 1, width: 200, height: 100,
    frame: { x: 20, y: 10, width: 160, height: 80 }, ground: { x: 100, y: 200, width: 16, height: 8 },
    pointsPerMeter: 10, operations: [], legend: [], ambiguousSpecies: [], overflow: false }
  const onMove = vi.fn(), onPrintArea = vi.fn()
  const plan = { pages: [page], outlines: {}, blocked: null }
  try {
    await act(async () => { render(<PdfPageEditor page={page} plan={plan} onMove={onMove} />, container) })
    const svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000))
    const captured = new Set<number>()
    svg.setPointerCapture = (id) => { captured.add(id) }
    svg.hasPointerCapture = (id) => captured.has(id)
    svg.releasePointerCapture = (id) => {
      captured.delete(id)
      svg.dispatchEvent(new Event('lostpointercapture'))
    }
    const pointer = async (type: string, x: number, y: number, target: Element = svg, id = 7) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
      Object.defineProperty(event, 'pointerId', { value: id })
      await act(async () => { target.dispatchEvent(event) })
    }
    await pointer('pointerdown', 200, 400)
    await pointer('pointermove', 500, 550)
    expect(onMove).not.toHaveBeenCalled()
    expect(svg.style.getPropertyValue('--pdf-drag-x')).toBe('60px')
    await pointer('pointerup', 500, 550, svg, 8)
    expect(onMove).not.toHaveBeenCalled()
    await pointer('pointerup', 500, 550)
    expect(onMove).toHaveBeenCalledExactlyOnceWith({ x: -6, y: -3 })
    expect(captured.size).toBe(0)
    await pointer('pointerdown', 200, 400)
    await pointer('pointermove', 500, 550)
    await act(async () => { svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await pointer('pointerup', 500, 550)
    expect(onMove).toHaveBeenCalledOnce()
    expect(svg.style.getPropertyValue('--pdf-drag-x')).toBe('')
    await act(async () => { svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(onMove).toHaveBeenLastCalledWith({ x: -.5, y: 0 })
    await act(async () => { render(<PdfPageEditor page={page} plan={plan} adding onPrintArea={onPrintArea} />, container) })
    await pointer('pointerdown', 200, 400)
    await pointer('pointerup', 201, 401)
    expect(onPrintArea).not.toHaveBeenCalled()
    await pointer('pointerdown', 200, 400)
    await pointer('pointerup', 500, 550)
    expect(onPrintArea).toHaveBeenCalledExactlyOnceWith({ x: 102, y: 202, width: 6, height: 3 })
    await pointer('pointerdown', 200, 400)
    await act(async () => { render(null, container) })
    expect(captured.size).toBe(0)
  } finally { render(null, container); container.remove() }
})
