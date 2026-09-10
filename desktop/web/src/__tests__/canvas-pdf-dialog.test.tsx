import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
vi.mock('../app/canvas-pdf/live', () => ({ canvasPdf: null }))
import { CanvasPdfDialog } from '../components/canvas-pdf/CanvasPdfDialog'
import { createPdfWorkflow } from '../app/canvas-pdf/workflow'
import { readFileSync } from 'node:fs'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'

it('opens with one overview and explicitly adds a whole-design field sheet', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const canvas = { layers: [{ name: 'annotations', visible: true, opacity: 1 }], plants: [], zones: [], measurements: [],
    annotations: ['Water weekly', 'Protect from wind'].map((text, i) => ({ id: String(i), text, position: { x: 0, y: 0 }, fontSize: 14, rotation: 0 })) }
  const text = createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true, input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }),
    prepare: async ({ input, setup, labels }) => {
      const plan = buildPdfPlan(input, setup, text, labels)
      return { plan, bytes: plan.blocked ? null : new Uint8Array([1]) }
    }, resolveNames: async () => ({}), delivery: { save: vi.fn(), dispose: vi.fn() },
    labels: () => ({ notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }),
    namePrintArea: number => `Area ${number}`, fontBaseUrl: () => '' })
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    const button = (name: string) => Array.from(container.querySelectorAll('button')).find(node => node.textContent === name || node.getAttribute('aria-label') === name)!
    expect(button('Save PDF').disabled).toBe(false)
    expect(button('Add detail page')).toBeUndefined()
    expect(button('Keep text on overview')).toBeUndefined()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(workflow.state.value.result!.plan.pages).toHaveLength(1)
    await act(async () => { button('Add field sheet').click() })
    await act(async () => { button('Whole design').click() })
    expect(workflow.state.value.result!.plan.pages.some(page => page.kind === 'legend')).toBe(true)
    const original = workflow.setup.peek()
    await act(async () => { button('Split into readable sheets').click(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready')) })
    expect(workflow.setup.peek()).toBe(original)
    expect(workflow.splitPreview.value!.areas).toHaveLength(2)
    expect(container.querySelector('[data-pdf-editor]')!.getAttribute('width')).toBe('100%')
    expect(button('Save PDF').disabled).toBe(true)
    await act(async () => { button('Cancel').click(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready')) })
    expect(workflow.setup.peek()).toBe(original)
    await act(async () => { button('View page: Area 1').click() })
    await act(async () => { button('Split into readable sheets').click(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready')) })
    await act(async () => { button('Apply sheets').click() })
    expect(workflow.splitPreview.value).toBeNull()
    expect(workflow.setup.value.areas).toHaveLength(2)
    expect(button('Save PDF').disabled).toBe(false)

    await act(async () => { workflow.close(); workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready')) })
    expect(button('Save PDF').disabled).toBe(false)
  } finally { render(null, container); workflow.dispose(); container.remove() }
})

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
    delivery: { save: vi.fn(), dispose: vi.fn() }, labels: () => ({ notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }), namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Print layers"]')!.click() })
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.checked).toBe(true)
    expect(boxes[1]!.checked).toBe(false)
    await act(async () => { boxes[0]!.click(); boxes[1]!.click() })
    expect(workflow.setup.value.layers).toEqual(['annotations'])
    expect(canvas.layers.map((layer) => layer.visible)).toEqual([true, false, true])
  } finally { render(null, container); workflow.dispose(); container.remove() }
})

it('creates explicitly drawn detail pages and edits their zoom and orientation independently', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const canvas = { layers: [{ name: 'zones', visible: true, opacity: 1 }], plants: [], annotations: [], measurements: [], zones: [
    { name: 'Wide bed', bounds: { x: 0, y: 0, width: 30, height: 5 }, path: 'M0 0 H30 V5 H0 Z', fill: null },
    { name: 'Tall bed', bounds: { x: 40, y: 0, width: 5, height: 30 }, path: 'M40 0 H45 V30 H40 Z', fill: null },
  ] }
  const text = createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true, input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }),
    prepare: async ({ input, setup, labels }) => ({ bytes: new Uint8Array([1]), plan: buildPdfPlan(input, setup, text, labels) }),
    resolveNames: async () => ({}), delivery: { save: vi.fn(), dispose: vi.fn() },
    labels: () => ({ notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }),
    namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => '' })
  const button = (name: string) => Array.from(container.querySelectorAll('button')).find((node) => node.getAttribute('aria-label') === name || node.textContent === name)!
  const zoom = () => container.querySelector<HTMLInputElement>('input[type="number"]')!
  try {
    await act(async () => { workflow.show(); render(<CanvasPdfDialog workflow={workflow} />, container) })
    const draw = async (width: number, height: number) => {
      await act(async () => { button('Add field sheet').click() })
      expect(container.querySelector('input[type="search"]')).toBeNull()
      expect(button('Wide bed')).toBeUndefined()
      const overview = workflow.state.value.result!.plan.pickerPage!, svg = container.querySelector<SVGSVGElement>('[data-pdf-editor]')!
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, overview.width, overview.height))
      let captured = false
      svg.setPointerCapture = () => { captured = true }; svg.hasPointerCapture = () => captured; svg.releasePointerCapture = () => { captured = false }
      const pointer = async (type: string, x: number, y: number, target: Element = svg) => {
        const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
        Object.defineProperty(event, 'pointerId', { value: 1 })
        await act(async () => { target.dispatchEvent(event) })
      }
      // Authored Zone artwork remains printable, but clicking it creates no page.
      const artwork = svg.querySelector('path[d="M0 0 H30 V5 H0 Z"]')!
      expect(artwork).not.toBeNull()
      const count = workflow.setup.value.areas?.length ?? 0
      await pointer('pointerdown', overview.frame.x + 20, overview.frame.y + 20, artwork)
      await pointer('pointerup', overview.frame.x + 20, overview.frame.y + 20)
      expect(workflow.setup.value.areas?.length ?? 0).toBe(count)
      await pointer('pointerdown', overview.frame.x + 20, overview.frame.y + 20, artwork)
      await pointer('pointerup', overview.frame.x + 20 + width, overview.frame.y + 20 + height)
      expect(workflow.setup.value.areas).toHaveLength(count + 1)
    }
    await draw(200, 50)
    expect(container.querySelector('svg[data-pdf-page="2"]')).not.toBeNull()
    expect(container.querySelector('[data-pdf-editor]')!.getAttribute('viewBox')!.split(' ').map(Number)[2]).toBeGreaterThan(700)
    expect(zoom().value).toBe('100')
    await act(async () => { zoom().value = '137.5'; zoom().dispatchEvent(new Event('input', { bubbles: true })); zoom().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(workflow.setup.value.views?.['area:1']?.zoom).toBe(137.5)
    await act(async () => { button('Portrait').click() })
    expect(workflow.setup.value.views?.['area:1']?.orientation).toBe('portrait')
    await draw(50, 200)
    expect(container.querySelector('svg[data-pdf-page="3"]')).not.toBeNull()
    expect(zoom().value).toBe('100')
    const area = workflow.setup.value.areas![1]!
    const page = workflow.state.value.result!.plan.pages[2]!
    expect(page.width).toBeLessThan(page.height)
    expect(page.ground.x).toBeLessThanOrEqual(area.bounds.x)
    expect(page.ground.x + page.ground.width).toBeGreaterThanOrEqual(area.bounds.x + area.bounds.width)
    expect(page.ground.y).toBeLessThanOrEqual(area.bounds.y)
    expect(page.ground.y + page.ground.height).toBeGreaterThanOrEqual(area.bounds.y + area.bounds.height)
    await act(async () => { button('View page: Print area 1').click() })
    expect(zoom().value).toBe('137.5')
    await act(async () => { zoom().value = ''; zoom().dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { zoom().dispatchEvent(new FocusEvent('blur')) })
    expect(zoom().value).toBe('137.5')
    await act(async () => { button('Fit').click() })
    expect(workflow.setup.value.views?.['area:1']).toEqual({ zoom: 100, orientation: 'portrait', offset: { x: 0, y: 0 } })
    const retained = workflow.setup.peek()
    await act(async () => { button('Add field sheet').click() })
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.activeElement).toBe(container.querySelector('[data-pdf-editor]'))
    expect(workflow.setup.peek()).toBe(retained)
    await act(async () => { button('Inspect text').click() })
    await act(async () => { button('Done inspecting').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-pdf-editor]')!.getAttribute('width')).toBe('100%')
    expect(workflow.setup.peek()).toBe(retained)
  } finally { render(null, container); workflow.dispose(); container.remove() }
})

it('returns to the source page when refreshed content no longer needs the selected legend continuation', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const canvas = { layers: [{ name: 'plants', visible: true, opacity: 1 }], zones: [], annotations: [], measurements: [],
    plants: Array.from({ length: 90 }, (_, i) => ({ id: String(i), canonicalName: 'Species ' + String(i).padStart(3, '0'),
      position: { x: i % 10, y: Math.floor(i / 10) }, color: '#000000', symbol: 'round', mark: [], pinnedName: false })) }
  const text = createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
  const workflow = createPdfWorkflow({ capture: () => ({ identity: canvas, isCurrent: () => true, input: { name: 'Garden', locale: 'en', commonNames: {}, canvas } }),
    prepare: async ({ input, setup, labels }) => ({ bytes: new Uint8Array([1]), plan: buildPdfPlan(input, setup, text, labels) }),
    resolveNames: async () => ({}), delivery: { save: vi.fn(), dispose: vi.fn() },
    labels: () => ({ notes: 'Notes', observations: 'Field observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }),
    namePrintArea: (number) => 'Print area ' + number, fontBaseUrl: () => '' })
  try {
    await act(async () => {
      workflow.show()
      await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
      render(<CanvasPdfDialog workflow={workflow} />, container)
    })
    await act(async () => { workflow.addWholeDesign(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready')) })
    const continuation = container.querySelector<HTMLButtonElement>('button[aria-label^="View page: 2 · Key and notes"]')!
    expect(continuation).not.toBeNull()
    await act(async () => { continuation.click() })
    expect(container.querySelector('[data-pdf-editor]')!.getAttribute('data-pdf-page')).toBe('3')
    await act(async () => {
      workflow.selectLayer('plants', false)
      await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    })
    expect(container.querySelector('[data-pdf-editor]')!.getAttribute('data-pdf-page')).toBe('2')
    expect(container.querySelector('[aria-current="page"]')!.getAttribute('aria-label')).toBe('View page: Print area 1')
  } finally { render(null, container); workflow.dispose(); container.remove() }
})
