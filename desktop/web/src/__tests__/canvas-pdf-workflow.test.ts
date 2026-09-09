import type { CanvasPrintSnapshot, PrintPlant } from '../canvas/print'
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
  let currentCanvas = capture.input.canvas
  const workflow = createPdfWorkflow({ capture: () => ({ ...capture, input: { ...capture.input, canvas: currentCanvas } }), prepare, resolveNames,
    delivery: { save, dispose: vi.fn() }, labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page' }), namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => 'https://test/fonts/' })
  return { workflow, prepare, save, resolveNames, capture, setCanvas: (canvas: CanvasPrintSnapshot) => { currentCanvas = canvas }, replace: () => { current = false; workflow.synchronize({}) } }
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
  it('retains independent choices across close/edit/reopen and flags missing selections', async () => {
    const { workflow, prepare, capture, setCanvas, replace } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(workflow.availableLayers.value).toEqual(['plants'])
    workflow.configure({ paper: 'Letter', layers: [] })
    workflow.close()
    setCanvas({ ...capture.input.canvas, layers: [{ name: 'plants', visible: true, opacity: 1 }, { name: 'annotations', visible: true, opacity: 1 }] })
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(workflow.setup.value).toEqual({ paper: 'Letter', orientation: 'auto', layers: [] })
    workflow.configure({ layers: ['plants'] }); workflow.close()
    setCanvas({ ...capture.input.canvas, layers: [{ name: 'annotations', visible: true, opacity: 1 }] })
    prepare.mockClear()
    workflow.show()
    expect(workflow.state.value.error).toBe('selection-missing')
    expect(workflow.setup.value.layers).toEqual(['plants'])
    expect(prepare).not.toHaveBeenCalled()
    workflow.configure({ layers: ['annotations'] })
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.calls[0]![0].setup.layers).toEqual(['annotations'])
    expect(capture.input.canvas.layers[0]!.visible).toBe(true)
    replace()
    expect(workflow.setup.value.layers).toEqual([])
    expect(workflow.availableLayers.value).toEqual([])
    workflow.dispose()
  })
  it('retains selected Zones after resizing and requires review after a Zone is renamed', async () => {
    const { workflow, prepare, capture, setCanvas } = fixture()
    const zone = { name: 'Orchard', bounds: { x: 0, y: 0, width: 10, height: 10 }, path: 'M0 0 H10 V10 H0 Z', fill: null }
    setCanvas({ ...capture.input.canvas, zones: [zone] })
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(workflow.setup.value.areas ?? []).toEqual([])
    workflow.selectZone('Orchard', true); workflow.configure({ detailScale: 50 }); workflow.close()
    setCanvas({ ...capture.input.canvas, zones: [{ ...zone, bounds: { ...zone.bounds, width: 20 } }] })
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].input.canvas.zones[0]!.bounds.width).toBe(20)
    expect(prepare.mock.lastCall![0].setup.detailScale).toBe(50)
    workflow.close(); setCanvas({ ...capture.input.canvas, zones: [{ ...zone, name: 'Renamed' }] })
    workflow.show()
    expect(workflow.state.value.error).toBe('selection-missing')
    expect(workflow.setup.value.areas).toEqual([{ kind: 'zone', name: 'Orchard' }])
    workflow.selectZone('Orchard', false); workflow.selectZone('Renamed', true)
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    workflow.dispose()
  })
  it('owns Print Areas and individual scale overrides only for the current session', async () => {
    const { workflow, prepare, capture, replace } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    const bounds = { x: 1, y: 2, width: 4, height: 5 }
    workflow.addPrintArea(bounds); bounds.width = 99
    workflow.addPrintArea({ x: 10, y: 20, width: 3, height: 6 })
    workflow.setAreaScale('area:1', 20); workflow.setAreaScale('area:2', 500)
    workflow.close(); workflow.show()
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].setup.areas).toEqual([
      { kind: 'rectangle', id: '1', name: 'Print area 1', bounds: { x: 1, y: 2, width: 4, height: 5 }, scale: 20 },
      { kind: 'rectangle', id: '2', name: 'Print area 2', bounds: { x: 10, y: 20, width: 3, height: 6 }, scale: 500 },
    ])
    expect(capture.input.canvas.zones).toEqual([])
    workflow.removeArea('area:1')
    expect(workflow.setup.value.areas?.map((area) => area.scale)).toEqual([500])
    replace()
    expect(workflow.setup.value.areas ?? []).toEqual([])
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
