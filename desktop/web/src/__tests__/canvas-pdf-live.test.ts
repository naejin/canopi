import { signal } from '@preact/signals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasPrintSnapshot } from '../canvas/print'
import type { PdfPreparation } from '../app/canvas-pdf/prepare'
import type { PreparedPdf } from '../app/canvas-pdf/types'

const view = vi.hoisted(() => ({ live: 0 }))
const fakes = vi.hoisted(() => ({ prepare: undefined as unknown as (input: PdfPreparation) => Promise<PreparedPdf> }))
const snapshot: CanvasPrintSnapshot = { layers: [{ name: 'plants', visible: true, opacity: 1 }], plants: [], zones: [], annotations: [], measurements: [] }
const settledCamera = signal({ center: { lon: 0, lat: 0 }, zoom: 18, bearingDeg: 0, pitchDeg: 0 })
const query = signal({
  revision: { scene: signal(0) },
  capturePrintSnapshot: () => snapshot,
  getSettledPlacedPlants: () => [],
  view: { settledCamera, captureView: () => ({ camera: { ...settledCamera.peek(), bearingDeg: view.live } }) },
})
vi.mock('../canvas/session', () => ({ currentCanvasQuerySurface: query }))
vi.mock('../app/document-session/store', async () => {
  const { signal } = await import('@preact/signals')
  return { designSessionStore: { currentDesign: signal({}), sessionIdentity: signal({}), designName: signal('Garden') } }
})
vi.mock('../app/plant-browser', () => ({ speciesCatalogWorkbench: {
  resolveDisplayNames: async () => ({ names: {}, englishFallbacks: [] }), resolveHabits: async () => ({}) } }))
vi.mock('#canvas-pdf-platform', () => ({ createPdfDelivery: () => ({ save: async () => 'saved', dispose: () => {} }) }))
vi.mock('../app/canvas-pdf/job', () => ({ preparePdfJob: (input: PdfPreparation) => fakes.prepare(input) }))

const { canvasPdf } = await import('../app/canvas-pdf/live')

describe('the live PDF workflow', () => {
  afterEach(() => { canvasPdf.close(); vi.useRealTimers() })
  it('waits for a turn still easing on open and lays pages out at the bearing it ends at', async () => {
    vi.useFakeTimers()
    const prepare = vi.fn(async ({ input }: PdfPreparation): Promise<PreparedPdf> =>
      ({ bytes: new Uint8Array([1]), plan: { pages: [], outlines: {}, blocked: null, angleDeg: input.viewBearingDeg } }))
    fakes.prepare = prepare
    // Shift+→ eases from 0 to 15 over 300 ms (ADR 0015); Ctrl+P about 150 ms in reads about 9 on the live camera.
    view.live = 9
    canvasPdf.show()
    canvasPdf.configure({ mapOrientation: 'as-on-screen' })
    await vi.advanceTimersByTimeAsync(200)
    expect(prepare).not.toHaveBeenCalled()
    expect(canvasPdf.state.value).toMatchObject({ status: 'preparing', error: null })
    // The turn ends at 15 and the view settles 150 ms later.
    view.live = 15
    settledCamera.value = { ...settledCamera.peek(), bearingDeg: 15 }
    await vi.advanceTimersByTimeAsync(200)
    expect(canvasPdf.state.value.status).toBe('ready')
    expect(prepare.mock.calls.map(([preparation]) => preparation.input.viewBearingDeg)).toEqual([15])
  })
  it('holds a settled bearing without waiting', async () => {
    const prepare = vi.fn(async ({ input }: PdfPreparation): Promise<PreparedPdf> =>
      ({ bytes: new Uint8Array([1]), plan: { pages: [], outlines: {}, blocked: null, angleDeg: input.viewBearingDeg } }))
    fakes.prepare = prepare
    view.live = 375
    settledCamera.value = { ...settledCamera.peek(), bearingDeg: 15 }
    canvasPdf.show()
    await vi.waitFor(() => expect(canvasPdf.state.value.status).toBe('ready'))
    expect(prepare.mock.lastCall![0].input.viewBearingDeg).toBe(375)
  })
})
