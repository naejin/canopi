import { batch, signal } from '@preact/signals'
import type { PrintBounds } from '../../canvas/print'
import { splitFieldBounds } from './split-sheets'
import { contains } from './field-geometry'
import { PDF_ZOOM, pdfAreaKey, type PdfPageView } from './types'
import type { PdfPreparation } from './prepare'
import type { PdfInput, PdfLabels, PdfSetup, PreparedPdf, PdfPlan, PdfLayoutCache } from './types'
export interface PdfCapture { readonly identity: object; readonly input: PdfInput; isCurrent(): boolean }
export type PdfDeliveryResult = 'saved' | 'downloaded' | 'cancelled'
export interface PdfDelivery { save(bytes: Uint8Array, name: string, signal: AbortSignal): Promise<PdfDeliveryResult>; dispose(): void }
export interface PdfWorkflowDependencies {
  capture(): PdfCapture | null
  resolveNames(names: readonly string[], locale: string): Promise<Record<string, string>>
  prepare(input: PdfPreparation, signal: AbortSignal, progress?: (plan: PdfPlan) => void): Promise<PreparedPdf>
  readonly delivery: PdfDelivery
  labels(): PdfLabels
  fontBaseUrl(): string
  namePrintArea(number: number): string
}
export interface PdfWorkflowState {
  readonly status: 'idle' | 'preparing' | 'ready' | 'error' | 'delivering' | 'saved' | 'downloaded'
  readonly error: string | null
  readonly result: PreparedPdf | null
}
const IDLE: PdfWorkflowState = { status: 'idle', error: null, result: null }
const EXPORTABLE = new Set(['plants', 'zones', 'annotations', 'measurement-guides'])
export function createPdfWorkflow(deps: PdfWorkflowDependencies) {
  const open = signal(false)
  const state = signal<PdfWorkflowState>(IDLE)
  const defaults = (): PdfSetup => ({ paper: 'A4', layers: [] })
  const setup = signal<PdfSetup>(defaults())
  const splitPreview = signal<PdfSetup | null>(null)
  const availableLayers = signal<readonly string[]>([])
  let cache: PdfLayoutCache = {}
  let priority = 'overview'
  let nextAreaId = 0
  let identity: object | null = null
  let capture: PdfCapture | null = null
  let controller: AbortController | null = null
  let generation = 0
  let disposed = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  function stop() { generation++; controller?.abort(); controller = null; clearTimeout(refreshTimer); refreshTimer = undefined }
  function refreshSoon() {
    stop(); capture = null
    state.value = { status: 'preparing', error: null, result: null }
    // Leave the reactive observer before capturing; rapid revisions share one job.
    refreshTimer = setTimeout(() => { refreshTimer = undefined; void rebuild() }, 100)
  }
  function synchronize(nextIdentity: object) {
    if (disposed) return
    if (identity !== null && identity !== nextIdentity) {
      stop(); cache = {}; splitPreview.value = null; identity = null; capture = null; nextAreaId = 0
      batch(() => { open.value = false; state.value = IDLE; setup.value = defaults(); availableLayers.value = [] })
    } else if (open.peek() && ((capture && !capture.isCurrent()) || state.peek().error === 'canvas-busy')) {
      refreshSoon()
    }
  }
  async function rebuild(): Promise<void> {
    if (disposed || !open.peek() || state.peek().status === 'delivering') return
    stop()
    let next: PdfCapture | null
    try { next = deps.capture() } catch {
      state.value = { status: 'error', error: 'prepare-failed', result: null }; return
    }
    if (!next) { state.value = { status: 'error', error: 'canvas-busy', result: null }; return }
    if (identity !== next.identity) {
      identity = next.identity
      nextAreaId = 0
      setup.value = { paper: 'A4', layers: next.input.canvas.layers.filter((l) => EXPORTABLE.has(l.name) && l.visible).map((l) => l.name) }
    }
    availableLayers.value = next.input.canvas.layers.filter((layer) => EXPORTABLE.has(layer.name)).map((layer) => layer.name)
    capture = next
    if (setup.peek().layers.some((name) => !availableLayers.peek().includes(name))) {
      state.value = { status: 'error', error: 'selection-missing', result: null }; return
    }
    const abort = new AbortController(); controller = abort
    const ticket = generation
    const previous = state.peek().result
    state.value = { status: 'preparing', error: null, result: previous ? { ...previous, bytes: null } : null }
    const current = () => {
      if (disposed || !open.peek() || ticket !== generation || abort.signal.aborted) return false
      if (next.isCurrent()) return true
      refreshSoon()
      return false
    }
    try {
      const choices = splitPreview.peek() ?? setup.peek()
      const progress = (plan: PdfPlan) => { if (current()) state.value = { status: 'preparing', error: null, result: { plan, bytes: null } } }
      if (choices.areas?.length && !previous) {
        const overview = await deps.prepare({ input: next.input, setup: { ...choices, areas: [] }, labels: deps.labels(), fontBaseUrl: deps.fontBaseUrl() }, abort.signal)
        if (!current()) return
        progress(overview.plan)
      }
      const names = choices.areas?.length && choices.layers.includes('plants')
        ? Array.from(new Set(next.input.canvas.plants.filter(plant => choices.areas!.some(area => {
          // A manually displaced/zoomed view can include plants outside its original rectangle.
          return choices.views?.[pdfAreaKey(area)] ? true : contains(area.bounds, plant.position)
        })).map(plant => plant.canonicalName))) : []
      // Catalog failure retains full canonical identities on explicitly requested field sheets.
      const commonNames = names.length ? await resolvePrintNames(deps.resolveNames, names, next.input.locale, abort.signal) : {}
      if (!current()) return
      const result = await deps.prepare({ input: { ...next.input, commonNames }, setup: choices, labels: deps.labels(),
        fontBaseUrl: deps.fontBaseUrl(), cache, priority }, abort.signal, progress)
      if (!current()) return
      cache = result.layoutCache ?? {}
      state.value = { status: 'ready', error: null, result }
    } catch (error) {
      if (!current()) return
      const message = error instanceof Error ? error.message : ''
      state.value = { status: 'error', error: ['unsupported-text', 'text-too-wide', 'prepare-timeout', 'selection-missing', 'coverage-too-large', 'invalid-page-view'].includes(message) ? message : 'prepare-failed', result: null }
    } finally {
      if (controller === abort) controller = null
    }
  }
  function show(): void { if (disposed) return; open.value = true; void rebuild() }
  function close(): void {
    if (state.peek().status === 'delivering') return
    stop(); cache = {}; splitPreview.value = null; capture = null; batch(() => { open.value = false; state.value = IDLE; availableLayers.value = [] })
  }
  function configure(value: Partial<PdfSetup>): void {
    if (disposed || state.peek().status === 'delivering') return
    splitPreview.value = null
    setup.value = { ...setup.peek(), ...value }
    void rebuild()
  }
  function selectLayer(name: string, selected: boolean): void {
    const layers = setup.peek().layers.filter((layer) => layer !== name)
    configure({ layers: selected ? [...layers, name] : layers })
  }
  function addPrintArea(bounds: PrintBounds): string | undefined {
    if (!open.peek() || disposed || state.peek().status === 'delivering') return
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return
    const number = ++nextAreaId
    priority = `area:${number}`
    configure({ areas: [...setup.peek().areas ?? [], { id: String(number), name: deps.namePrintArea(number), bounds: { ...bounds } }] })
    return `area:${number}`
  }
  function addWholeDesign(): string | undefined {
    const page = state.peek().result?.plan.pickerPage
    return page ? addPrintArea(page.ground) : undefined
  }
  function previewSplit(id: string): void {
    const page = state.peek().result?.plan.pages.find(p => p.id === id && p.kind === 'detail')
    if (!page || !capture?.isCurrent() || !['ready', 'saved', 'downloaded', 'error'].includes(state.peek().status)) return
    const bounds = splitFieldBounds(page.ground, setup.peek().layers.includes('plants') ? capture.input.canvas.plants : [])
    const areas = bounds.map((bounds, index) => ({ id: String(nextAreaId + index + 1), name: deps.namePrintArea(nextAreaId + index + 1), bounds }))
    const views = Object.fromEntries(Object.entries(setup.peek().views ?? {}).filter(([key]) => key !== id && !key.startsWith(`${id}:legend:`)))
    splitPreview.value = { ...setup.peek(), areas: setup.peek().areas?.flatMap(a => pdfAreaKey(a) === id ? areas : [a]), views }
    priority = pdfAreaKey(areas[0]!)
    void rebuild()
  }
  function applySplit(): void {
    const preview = splitPreview.peek()
    if (!preview || state.peek().status !== 'ready' || !capture?.isCurrent()) return
    nextAreaId = Math.max(nextAreaId, ...preview.areas!.map(a => Number(a.id)))
    batch(() => { setup.value = preview; splitPreview.value = null })
  }
  function cancelSplit(): void { if (!splitPreview.peek()) return; splitPreview.value = null; void rebuild() }
  function prioritize(id: string): void { priority = id.split(':legend:')[0]! }
  function removeArea(key: string): void {
    const views = Object.fromEntries(Object.entries(setup.peek().views ?? {}).filter(([id]) => id !== key && !id.startsWith(`${key}:legend:`)))
    configure({ areas: (setup.peek().areas ?? []).filter((area) => pdfAreaKey(area) !== key), views })
  }
  function setPageView(id: string, value: PdfPageView): void {
    if (value.zoom !== undefined && (!Number.isFinite(value.zoom) || value.zoom < PDF_ZOOM.min || value.zoom > PDF_ZOOM.max)) return
    if (value.orientation !== undefined && !['auto', 'portrait', 'landscape'].includes(value.orientation)) return
    if (value.offset && ![value.offset.x, value.offset.y].every(Number.isFinite)) return
    const views = setup.peek().views ?? {}
    if ((value.zoom === undefined || value.zoom === (views[id]?.zoom ?? 100))
      && (value.orientation === undefined || value.orientation === (views[id]?.orientation ?? 'auto'))
      && (!value.offset || (value.offset.x === (views[id]?.offset?.x ?? 0) && value.offset.y === (views[id]?.offset?.y ?? 0)))) return
    configure({ views: { ...views, [id]: { ...views[id], ...value, ...(value.offset ? { offset: { ...value.offset } } : {}) } } })
  }
  function fitPage(id: string): void { setPageView(id, { zoom: 100, offset: { x: 0, y: 0 } }) }
  async function save(): Promise<void> {
    if (splitPreview.peek()) return
    const snapshot = state.peek(), source = capture
    if (!source || !source.isCurrent() || !['ready', 'saved', 'downloaded', 'error'].includes(snapshot.status) || !snapshot.result?.bytes || snapshot.result.plan.blocked) return
    const abort = new AbortController(); controller = abort
    const ticket = ++generation
    state.value = { ...snapshot, status: 'delivering', error: null }
    try {
      const outcome = await deps.delivery.save(snapshot.result.bytes, source.input.name, abort.signal)
      if (disposed || ticket !== generation || !source.isCurrent()) return
      state.value = { ...snapshot, status: outcome === 'cancelled' ? 'ready' : outcome, error: null }
    } catch {
      if (disposed || ticket !== generation || !source.isCurrent()) return
      state.value = { ...snapshot, status: 'error', error: 'delivery-failed' }
    } finally { if (controller === abort) controller = null }
  }
  function dispose(): void { if (disposed) return; disposed = true; stop(); cache = {}; splitPreview.value = null; deps.delivery.dispose(); open.value = false; state.value = IDLE; capture = null; setup.value = defaults(); availableLayers.value = [] }
  return { open, state, setup, splitPreview, availableLayers, prioritize, addWholeDesign, previewSplit, applySplit, cancelSplit, show, close, rebuild, configure, selectLayer, addPrintArea, removeArea, setPageView, fitPage, save, synchronize, dispose }
}
export type PdfWorkflow = ReturnType<typeof createPdfWorkflow>

// The catalog reader is shared with the app. Stop waiting without disposing it;
// a late answer must not keep an export job or its captured Design alive.
function resolvePrintNames(resolveNames: PdfWorkflowDependencies['resolveNames'], names: readonly string[], locale: string,
  signal: AbortSignal): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    const finish = (value: Record<string, string>) => { if (settled) return; settled = true; cleanup(); resolve(value) }
    const abort = () => { if (settled) return; settled = true; cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    const timer = setTimeout(() => finish({}), 30_000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    try { void resolveNames(names, locale).then(finish, () => finish({})) } catch { finish({}) }
  })
}
