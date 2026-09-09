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
  const workflow = createPdfWorkflow({ capture: () => {
    const canvas = currentCanvas
    return { ...capture, input: { ...capture.input, canvas }, isCurrent: () => current && canvas === currentCanvas }
  }, prepare, resolveNames,
    delivery: { save, dispose: vi.fn() }, labels: () => ({ overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }), namePrintArea: (number) => `Print area ${number}`, fontBaseUrl: () => 'https://test/fonts/' })
  return { workflow, prepare, save, resolveNames, capture, setCanvas: (canvas: CanvasPrintSnapshot) => { currentCanvas = canvas }, replace: () => { current = false; workflow.synchronize({}) } }
}
describe('PDF workflow lifetime', () => {
  it('accepts text retention only from a current prepared result and clears it on replacement', async () => {
    vi.useFakeTimers()
    const { workflow, capture, setCanvas, prepare, replace } = fixture()
    prepare.mockResolvedValue({ bytes: null, plan: { pages: [], outlines: {}, blocked: 'text-needs-detail',
      textIssues: [{ key: 'reviewed text', kind: 'annotation' }] } })
    try {
      workflow.show(); await Promise.resolve()
      setCanvas({ ...capture.input.canvas })
      workflow.retainCrowdedText()
      expect(workflow.setup.value.retainedTextKeys).toBeUndefined()
      workflow.synchronize(capture.identity)
      workflow.retainCrowdedText()
      expect(workflow.setup.value.retainedTextKeys).toBeUndefined()
      await vi.advanceTimersByTimeAsync(150)
      workflow.retainCrowdedText()
      expect(workflow.setup.value.retainedTextKeys).toEqual(['reviewed text'])
      replace()
      expect(workflow.setup.value.retainedTextKeys).toBeUndefined()
    } finally { workflow.dispose(); vi.useRealTimers() }
  })
  it('refreshes changed content automatically, coalesces revisions, and cancels refresh on close', async () => {
    vi.useFakeTimers()
    const { workflow, capture, setCanvas, prepare, save } = fixture()
    try {
      workflow.show(); await Promise.resolve()
      workflow.setPageView('overview', { offset: { x: 5, y: 3 }, zoom: 120 })
      await Promise.resolve()
      prepare.mockClear()
      setCanvas({ ...capture.input.canvas, annotations: [] })
      workflow.synchronize(capture.identity)
      expect(workflow.state.value.result).toBeNull()
      await workflow.save(); expect(save).not.toHaveBeenCalled()
      workflow.synchronize(capture.identity)
      await vi.advanceTimersByTimeAsync(150)
      expect(prepare).toHaveBeenCalledOnce()
      expect(workflow.state.value.status).toBe('ready')
      expect(prepare.mock.lastCall![0].setup.views?.overview).toEqual({ offset: { x: 5, y: 3 }, zoom: 120 })
      setCanvas({ ...capture.input.canvas }); workflow.synchronize(capture.identity)
      workflow.close(); await vi.advanceTimersByTimeAsync(150)
      expect(prepare).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { workflow.dispose(); vi.useRealTimers() }
  })
  it('owns framing values and restores zoom and centre together while retaining orientation', async () => {
    const { workflow, prepare } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    const offset = { x: 10, y: -5 }
    workflow.setPageView('overview', { offset, zoom: 125, orientation: 'portrait' })
    offset.x = 500
    expect(workflow.setup.value.views?.overview?.offset?.x).toBe(10)
    const before = workflow.setup.peek()
    workflow.setPageView('overview', { offset: { x: NaN, y: 0 } })
    expect(workflow.setup.peek()).toBe(before)
    workflow.fitPage('overview')
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].setup.views?.overview).toEqual({ offset: { x: 0, y: 0 }, zoom: 100, orientation: 'portrait' })
    workflow.dispose()
  })
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
    expect(workflow.setup.value).toEqual({ paper: 'Letter', layers: [] })
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
    expect(workflow.setup.value.views).toBeUndefined()
    workflow.selectZone('Orchard', true); workflow.setPageView('zone:Orchard', { zoom: 75, orientation: 'landscape' }); workflow.close()
    setCanvas({ ...capture.input.canvas, zones: [{ ...zone, bounds: { ...zone.bounds, width: 20 } }] })
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].input.canvas.zones[0]!.bounds.width).toBe(20)
    expect(prepare.mock.lastCall![0].setup.views?.['zone:Orchard']).toEqual({ zoom: 75, orientation: 'landscape' })
    workflow.close(); setCanvas({ ...capture.input.canvas, zones: [{ ...zone, name: 'Renamed' }] })
    workflow.show()
    expect(workflow.state.value.error).toBe('selection-missing')
    expect(workflow.setup.value.areas).toEqual([{ kind: 'zone', name: 'Orchard' }])
    workflow.selectZone('Orchard', false); workflow.selectZone('Renamed', true)
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    workflow.dispose()
  })
  it('owns Print Areas and individual page views only for the current session', async () => {
    const { workflow, prepare, capture, replace } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    const bounds = { x: 1, y: 2, width: 4, height: 5 }
    workflow.addPrintArea(bounds); bounds.width = 99
    workflow.addPrintArea({ x: 10, y: 20, width: 3, height: 6 })
    workflow.setPageView('area:1', { zoom: 125.5, orientation: 'portrait' }); workflow.setPageView('area:2', { zoom: 80, orientation: 'landscape' })
    workflow.close(); workflow.show()
    await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].setup.areas).toEqual([
      { kind: 'rectangle', id: '1', name: 'Print area 1', bounds: { x: 1, y: 2, width: 4, height: 5 } },
      { kind: 'rectangle', id: '2', name: 'Print area 2', bounds: { x: 10, y: 20, width: 3, height: 6 } },
    ])
    expect(prepare.mock.lastCall![0].setup.views).toEqual({ 'area:1': { zoom: 125.5, orientation: 'portrait' }, 'area:2': { zoom: 80, orientation: 'landscape' } })
    expect(capture.input.canvas.zones).toEqual([])
    workflow.removeArea('area:1')
    expect(workflow.setup.value.views).toEqual({ 'area:2': { zoom: 80, orientation: 'landscape' } })
    replace()
    expect(workflow.setup.value.areas ?? []).toEqual([])
    expect(workflow.setup.value.views).toBeUndefined()
    workflow.dispose()
  })
  it('ignores invalid zoom edits and aborts superseded page preparations', async () => {
    const { workflow, prepare } = fixture()
    workflow.show(); await vi.waitFor(() => expect(workflow.state.value.status).toBe('ready'))
    workflow.setPageView('overview', { zoom: 75 })
    const before = workflow.setup.peek()
    for (const zoom of [NaN, Infinity, 0, -1, 1001]) workflow.setPageView('overview', { zoom })
    expect(workflow.setup.peek()).toBe(before)
    prepare.mockImplementation(() => new Promise(() => {}))
    workflow.setPageView('overview', { zoom: 120 })
    const previous = prepare.mock.lastCall![1]
    workflow.setPageView('overview', { orientation: 'landscape' })
    expect(previous.aborted).toBe(true)
    expect(workflow.setup.value.views?.overview).toEqual({ zoom: 120, orientation: 'landscape' })
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

it('bounds an unavailable name lookup and releases its deadline when preview closes', async () => {
  vi.useFakeTimers()
  const { workflow, prepare, resolveNames } = fixture([{ id: 'a', canonicalName: 'Malus domestica', position: { x: 0, y: 0 }, color: '#000000', symbol: 'round', mark: [], pinnedName: false }])
  resolveNames.mockImplementation(() => new Promise(() => {}))
  try {
    workflow.show()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(workflow.state.value.status).toBe('ready')
    expect(prepare.mock.lastCall![0].input.commonNames).toEqual({})
    workflow.close(); workflow.show()
    expect(vi.getTimerCount()).toBe(1)
    workflow.close()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
    expect(workflow.state.value.status).toBe('idle')
  } finally { workflow.dispose(); vi.useRealTimers() }
})

it('recovers from encoding and delivery failures without rebuilding valid bytes for a delivery retry', async () => {
  const { workflow, prepare, save, capture } = fixture()
  const before = structuredClone(capture.input)
  try {
    prepare.mockRejectedValueOnce(new Error('encoding failed'))
    workflow.show()
    await vi.waitFor(() => expect(workflow.state.value.error).toBe('prepare-failed'))
    await workflow.rebuild()
    expect(workflow.state.value.status).toBe('ready')
    save.mockRejectedValueOnce(new Error('disk full'))
    await workflow.save()
    expect(workflow.state.value.error).toBe('delivery-failed')
    expect(workflow.state.value.result?.bytes).toBe(result.bytes)
    await workflow.save()
    expect(workflow.state.value.status).toBe('saved')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(capture.input).toEqual(before)
  } finally { workflow.dispose() }
})
