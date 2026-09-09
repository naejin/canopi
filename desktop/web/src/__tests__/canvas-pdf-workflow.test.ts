import type { PrintPlant } from '../canvas/print'
import type { PdfPreparation } from '../app/canvas-pdf/prepare'
import { describe, expect, it, vi } from 'vitest'
import { createPdfWorkflow, type PdfCapture } from '../app/canvas-pdf/workflow'
import type { PreparedPdf } from '../app/canvas-pdf/types'
const result: PreparedPdf = { bytes: new Uint8Array([37, 80, 68, 70]), plan: { pages: [], outlines: {}, blocked: null } }
function fixture(plants: PrintPlant[] = []) {
  const identity = {}
  let current = true
  const capture: PdfCapture = { identity, isCurrent: () => current, input: { name: 'Garden', locale: 'fr', commonNames: {},
    canvas: { layers: [{ name: 'plants', visible: true, opacity: 1 }, { name: 'base', visible: true, opacity: 1 }],
      plants, zones: [], annotations: [], measurements: [] } } }
  const prepare = vi.fn<(input: PdfPreparation, signal: AbortSignal) => Promise<PreparedPdf>>(async () => result)
  const save = vi.fn(async () => 'saved' as const)
  const resolveNames = vi.fn(async (_names: readonly string[], _locale: string): Promise<Record<string, string>> => ({}))
  const workflow = createPdfWorkflow({ capture: () => capture, prepare, resolveNames,
    delivery: { save, dispose: vi.fn() }, labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page' }), fontBaseUrl: () => 'https://test/fonts/' })
  return { workflow, prepare, save, resolveNames, capture, replace: () => { current = false; workflow.synchronize({}) } }
}
describe('PDF workflow lifetime', () => {
  it('prepares and delivers derived bytes without including map layers', async () => {
    const { workflow, prepare, save } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(workflow.setup.value.layers).toEqual(['plants'])
    expect(prepare).toHaveBeenCalledOnce()
    await workflow.save()
    expect(save).toHaveBeenCalledWith(result.bytes, 'Garden', expect.any(AbortSignal))
    expect(workflow.state.value.status).toBe('saved')
    await workflow.save()
    expect(save).toHaveBeenCalledTimes(2)
    workflow.dispose()
  })
  it('keeps full canonical names when the catalog is unavailable', async () => {
    const { workflow, prepare, resolveNames } = fixture([{ id: 'a', canonicalName: 'Malus domestica', position: { x: 0, y: 0 }, color: '#000000', symbol: 'round', mark: [], pinnedName: false }])
    resolveNames.mockRejectedValue(new Error('catalog unavailable'))
    workflow.show()
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.calls[0]![0].input.commonNames).toEqual({})
    workflow.dispose()
  })
  it('discards late preparation after Design replacement and never delivers it', async () => {
    const { workflow, prepare, save, replace } = fixture()
    let finish!: (result: PreparedPdf) => void
    prepare.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    workflow.show(); replace(); finish(result)
    await Promise.resolve(); await workflow.save()
    expect(workflow.open.value).toBe(false)
    expect(workflow.state.value.result).toBeNull()
    expect(save).not.toHaveBeenCalled()
    workflow.dispose()
  })
  it('cancels a preparing job when the preview closes', async () => {
    const { workflow, prepare } = fixture()
    prepare.mockImplementation(() => new Promise(() => {}))
    workflow.show()
    const signal = prepare.mock.calls[0]![1]
    workflow.close()
    expect(signal.aborted).toBe(true)
    expect(workflow.state.value.status).toBe('idle')
    workflow.dispose()
  })
})
