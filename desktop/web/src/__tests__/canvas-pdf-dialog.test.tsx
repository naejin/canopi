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
