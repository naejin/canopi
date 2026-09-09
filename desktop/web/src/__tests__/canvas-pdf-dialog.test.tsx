import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
vi.mock('../app/canvas-pdf/live', () => ({ canvasPdf: null }))
import { CanvasPdfDialog } from '../components/canvas-pdf/CanvasPdfDialog'
import { createPdfWorkflow } from '../app/canvas-pdf/workflow'
import { readFileSync } from 'node:fs'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'

it('keeps keyboard commands inside the preview and returns focus when it closes', async () => {
  const launch = document.createElement('button'), container = document.createElement('div')
  document.body.append(launch, container); launch.focus()
  const workflow = createPdfWorkflow({ capture: () => null, prepare: vi.fn(), resolveNames: vi.fn(),
    delivery: { save: vi.fn(), dispose: vi.fn() }, labels: vi.fn(), namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  const globalKey = vi.fn()
  window.addEventListener('keydown', globalKey)
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    const first = container.querySelector<HTMLButtonElement>('button')!
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(globalKey).not.toHaveBeenCalled()
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(launch)
  } finally {
    window.removeEventListener('keydown', globalKey)
    render(null, container); workflow.dispose(); container.remove(); launch.remove()
  }
})

it('offers only printable layers and sends checkbox changes to the export setup', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const prepare = vi.fn(async () => ({ bytes: null, plan: { pages: [], outlines: {}, blocked: 'empty' as const } }))
  const canvas = { layers: [{ name: 'plants', visible: true, opacity: 1 }, { name: 'annotations', visible: false, opacity: 1 }, { name: 'base', visible: true, opacity: 1 }], plants: [], zones: [], annotations: [], measurements: [] }
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true,
    input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }), prepare, resolveNames: async () => ({}),
    delivery: { save: vi.fn(), dispose: vi.fn() }, labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }), namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
    await act(async () => { boxes[0]!.click(); boxes[1]!.click() })
    expect(workflow.setup.value.layers).toEqual(['annotations'])
    expect(canvas.layers.map((layer) => layer.visible)).toEqual([true, false, true])
  } finally { render(null, container); workflow.dispose(); container.remove() }
})

it('offers explicit continuation consent and retains the choice through preview closure', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const canvas = { layers: [], plants: [], zones: [], annotations: [], measurements: [] }
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true,
    input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }),
    prepare: async ({ setup }) => ({ bytes: setup.continuations ? new Uint8Array([1]) : null,
      plan: { pages: [], outlines: {}, hasLegendOverflow: true, blocked: setup.continuations ? null : 'legend-overflow' } }),
    resolveNames: async () => ({}), delivery: { save: vi.fn(), dispose: vi.fn() },
    labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }),
    namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    const save = () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save PDF')!
    expect(checkbox()).not.toBeNull()
    expect(checkbox().checked).toBe(false)
    expect(save().disabled).toBe(true)
    await act(async () => { checkbox().click() })
    expect(workflow.setup.value.continuations).toBe(true)
    expect(save().disabled).toBe(false)
    await act(async () => { workflow.close() })
    await act(async () => { workflow.show() })
    expect(checkbox().checked).toBe(true)
    await act(async () => { checkbox().click() })
    expect(save().disabled).toBe(true)
  } finally { render(null, container); workflow.dispose(); container.remove() }
})

it('opens newly selected and drawn pages and edits their zoom and orientation independently', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const canvas = { layers: [{ name: 'zones', visible: true, opacity: 1 }], plants: [], annotations: [], measurements: [], zones: [
    { name: 'Wide bed', bounds: { x: 0, y: 0, width: 30, height: 5 }, path: 'M0 0 H30 V5 H0 Z', fill: null },
    { name: 'Tall bed', bounds: { x: 40, y: 0, width: 5, height: 30 }, path: 'M40 0 H45 V30 H40 Z', fill: null },
  ] }
  const text = createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true, input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }),
    prepare: async ({ input, setup, labels }) => ({ bytes: new Uint8Array([1]), plan: buildPdfPlan(input, setup, text, labels) }),
    resolveNames: async () => ({}), delivery: { save: vi.fn(), dispose: vi.fn() },
    labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }),
    namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  const button = (name: string) => Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === name || node.textContent === name)!
  const checkbox = (name: string) => Array.from(container.querySelectorAll('label')).find((node) => node.textContent === name)!.querySelector('input')!
  const zoom = () => container.querySelector<HTMLInputElement>('input[type="number"]')!
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    await act(async () => { checkbox('Wide bed').click() })
    expect(container.querySelector('svg[data-pdf-page="2"]')).not.toBeNull()
    expect(button('Orientation').textContent).toContain('Landscape')
    expect(zoom().value).toBe('100')
    await act(async () => { zoom().value = '137.5'; zoom().dispatchEvent(new Event('input', { bubbles: true })); zoom().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(workflow.setup.value.views?.['zone:Wide%20bed']?.zoom).toBe(137.5)
    await act(async () => { button('Orientation').click() })
    await act(async () => { button('Portrait').click() })
    expect(workflow.setup.value.views?.['zone:Wide%20bed']?.orientation).toBe('portrait')
    await act(async () => { checkbox('Tall bed').click() })
    expect(container.querySelector('svg[data-pdf-page="3"]')).not.toBeNull()
    expect(zoom().value).toBe('100')
    await act(async () => { button('View page: Wide bed').click() })
    expect(zoom().value).toBe('137.5')
    await act(async () => { zoom().value = ''; zoom().dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { zoom().dispatchEvent(new FocusEvent('blur')) })
    expect(zoom().value).toBe('137.5')
    await act(async () => { button('Reset fit').click() })
    expect(workflow.setup.value.views?.['zone:Wide%20bed']).toEqual({ zoom: 100, orientation: 'portrait' })
    await act(async () => { button('Draw a print area').click() })
    const overview = workflow.state.value.result!.plan.pages[0]!, svg = container.querySelector('svg')!
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, overview.width, overview.height))
    let captured = false
    svg.setPointerCapture = () => { captured = true }; svg.hasPointerCapture = () => captured; svg.releasePointerCapture = () => { captured = false }
    const pointer = async (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      await act(async () => { svg.dispatchEvent(event) })
    }
    await pointer('pointerdown', overview.frame.x + 20, overview.frame.y + 20)
    await pointer('pointerup', overview.frame.x + 220, overview.frame.y + 70)
    expect(container.querySelector('svg[data-pdf-page="4"]')).not.toBeNull()
    expect(button('Orientation').textContent).toContain('Landscape')
    expect(zoom().value).toBe('100')
    const area = workflow.setup.value.areas!.find((area) => area.kind === 'rectangle')!
    if (area.kind !== 'rectangle') throw new Error('Missing Print Area')
    const page = workflow.state.value.result!.plan.pages[3]!
    expect(page.ground.x).toBeLessThanOrEqual(area.bounds.x)
    expect(page.ground.x + page.ground.width).toBeGreaterThanOrEqual(area.bounds.x + area.bounds.width)
    expect(page.ground.y).toBeLessThanOrEqual(area.bounds.y)
    expect(page.ground.y + page.ground.height).toBeGreaterThanOrEqual(area.bounds.y + area.bounds.height)
  } finally { render(null, container); workflow.dispose(); container.remove() }
})
