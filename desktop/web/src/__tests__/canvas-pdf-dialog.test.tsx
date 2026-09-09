import { render } from 'preact'
import { act } from 'preact/test-utils'
import { expect, it, vi } from 'vitest'
vi.mock('../app/canvas-pdf/live', () => ({ canvasPdf: null }))
import { CanvasPdfDialog } from '../components/canvas-pdf/CanvasPdfDialog'
import { createPdfWorkflow } from '../app/canvas-pdf/workflow'

it('keeps keyboard commands inside the preview and returns focus when it closes', async () => {
  const launch = document.createElement('button'), container = document.createElement('div')
  document.body.append(launch, container); launch.focus()
  const workflow = createPdfWorkflow({ capture: () => null, prepare: vi.fn(), resolveNames: vi.fn(),
    delivery: { save: vi.fn(), dispose: vi.fn() }, labels: vi.fn(), fontBaseUrl: () => '' })
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
    delivery: { save: vi.fn(), dispose: vi.fn() }, labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page' }), fontBaseUrl: () => '' })
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
