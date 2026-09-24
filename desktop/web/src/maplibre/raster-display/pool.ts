/**
 * Shared raster display worker lanes.
 *
 * The pool owns every raster decode worker in the workspace. Callers acquire a
 * client; the pool starts its lanes on the first acquisition and terminates
 * them when the last client is disposed, so a map teardown with no other
 * raster consumer returns to zero workers and zero cache.
 *
 * A client is shaped like the `cog-tiler-wasm` module the upstream
 * `LayerManager` loads through its public `loadCogTiler` dependency. Its
 * sources are proxies: header reads, decode, reprojection and colorizing run in
 * a lane, and only encoded tiles cross back to the UI thread.
 *
 * Scheduling is owned here because the upstream engine never forwards
 * MapLibre's abort signal. Tile work is dispatched newest first, a bounded
 * number per lane, and a queued tile the client reports as no longer relevant
 * (outside the current viewport) is rejected before it starts. Disposing a
 * client rejects its queued work and closes its sources in every lane.
 */
import type {
  RasterLaneUsage,
  RasterRenderOptions,
  RasterSourceMetadata,
  RasterWorkerReply,
  RasterWorkerRequest,
} from './protocol'
import { recordRaster } from './diagnostics'

/** Minimal worker surface; tests substitute an in-process implementation. */
export interface RasterWorkerLike {
  postMessage(message: RasterWorkerRequest, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<RasterWorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  terminate(): void
}

export interface RasterPoolOptions {
  /** Worker lanes shared by every client (plan §5: start with two). */
  readonly lanes: number
  /** Aggregate decoded-block budget, split evenly across lanes. */
  readonly budgetBytes: number
  /** Requests a lane may hold in flight while it awaits range reads. */
  readonly maxInFlightPerLane: number
  readonly createWorker: () => RasterWorkerLike
}

/** Tile coordinates a relevance check can reject before work starts. */
export interface RasterTileRequest {
  readonly z: number
  readonly x: number
  readonly y: number
}

export type RasterTileRelevance = (tile: RasterTileRequest) => boolean

/** One opened COG as the upstream engine sees it. */
export interface RasterProxySource extends RasterSourceMetadata {
  renderTilePNG(z: number, x: number, y: number, render?: RasterRenderOptions): Promise<Uint8Array>
  renderTileRGBA(z: number, x: number, y: number, render?: RasterRenderOptions): Promise<Uint8ClampedArray | null>
}

/** The client the upstream `LayerManager` treats as the cog-tiler module. */
export interface RasterPoolClient {
  init(): Promise<void>
  openCog(url: string): Promise<RasterProxySource>
  colormaps(): string[]
  rgbaToPng(rgba: Uint8Array | Uint8ClampedArray, width?: number, height?: number): Promise<Uint8Array>
  /** Render several COGs over one WGS84 box, first listed on top, as PNG bytes. */
  renderPreview(
    urls: readonly string[],
    bbox: [number, number, number, number],
    size: { width: number; height: number },
    render: RasterRenderOptions,
  ): Promise<Uint8Array>
  /** Report whether a queued tile still matters; checked just before dispatch. */
  setRelevance(relevance: RasterTileRelevance | null): void
  /** Re-check queued tiles against the current relevance (call after the viewport moves). */
  prune(): void
  usage(): Promise<RasterLaneUsage[]>
  readonly disposed: boolean
  dispose(): void
}

/** Built-in single-band colormaps of the pinned `cog-tiler-wasm@0.4.0`. */
const COLORMAPS = ['viridis', 'magma', 'plasma', 'inferno', 'cividis', 'turbo', 'terrain', 'blues', 'greens', 'reds', 'rdylgn', 'spectral', 'gray']

type TaskKind = 'control' | 'tile'

interface Task {
  readonly client: ClientState
  readonly kind: TaskKind
  readonly tile?: RasterTileRequest
  /** Lane that must run this task, when it is bound to one lane's state. */
  readonly lane?: number
  run(lane: Lane): Promise<unknown>
  resolve(value: unknown): void
  reject(error: unknown): void
}

interface Lane {
  readonly index: number
  readonly worker: RasterWorkerLike
  readonly pending: Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>
  inFlight: number
  broken: Error | null
}

interface ClientState {
  disposed: boolean
  relevance: RasterTileRelevance | null
  readonly handles: Set<number>
}

export function abortError(message = 'Raster request aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export class RasterWorkerPool {
  private lanes: Lane[] = []
  private queue: Task[] = []
  private clients = 0
  private requestSequence = 0
  private handleSequence = 0
  /** Lanes each handle is opened in, keyed by handle. */
  private readonly openedIn = new Map<number, Map<number, Promise<unknown>>>()
  private readonly urls = new Map<number, string>()

  constructor(private readonly options: RasterPoolOptions) {}

  /** Live lanes; zero when no client holds the pool. */
  get laneCount(): number {
    return this.lanes.length
  }

  acquire(): RasterPoolClient {
    if (this.clients === 0) this.start()
    this.clients += 1
    const state: ClientState = { disposed: false, relevance: null, handles: new Set() }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const pool = this
    const client: RasterPoolClient = {
      async init() {
        if (state.disposed) throw abortError('Raster client is disposed')
      },
      openCog: (url) => pool.openSource(state, url),
      colormaps: () => [...COLORMAPS],
      rgbaToPng: (rgba, width = 256, height = 256) => {
        const copy = new Uint8ClampedArray(rgba)
        return pool.schedule<Uint8Array>(state, 'control', undefined, undefined, (lane) =>
          pool.post(lane, { id: 0, op: 'encode', rgba: copy, width, height }, [copy.buffer]))
      },
      renderPreview: (urls, bbox, size, render) => pool.renderPreview(state, urls, bbox, size, render),
      setRelevance(relevance) {
        state.relevance = relevance
      },
      prune: () => pool.dispatch(),
      usage: () => pool.usage(),
      get disposed() {
        return state.disposed
      },
      dispose: () => pool.release(state),
    }
    return client
  }

  private start(): void {
    recordRaster({ kind: 'lanes-start', detail: String(this.options.lanes) })
    this.lanes = Array.from({ length: this.options.lanes }, (_, index) => this.createLane(index))
  }

  private createLane(index: number): Lane {
    const worker = this.options.createWorker()
    const lane: Lane = { index, worker, pending: new Map(), inFlight: 0, broken: null }
    worker.onmessage = (event) => {
      const reply = event.data
      const waiter = lane.pending.get(reply.id)
      if (!waiter) return
      lane.pending.delete(reply.id)
      if (reply.ok) waiter.resolve(reply.value)
      else waiter.reject(new Error(reply.error))
    }
    worker.onerror = (event) => {
      // A lane that crashed cannot answer; fail its work instead of hanging it.
      lane.broken = new Error(event.message || 'Raster worker lane failed')
      for (const waiter of lane.pending.values()) waiter.reject(lane.broken)
      lane.pending.clear()
    }
    const budget = Math.max(1, Math.floor(this.options.budgetBytes / this.options.lanes))
    void this.post(lane, { id: 0, op: 'init', budgetBytes: budget }).catch(() => {})
    return lane
  }

  private post<T>(lane: Lane, request: RasterWorkerRequest, transfer: Transferable[] = []): Promise<T> {
    if (lane.broken) return Promise.reject(lane.broken)
    const id = ++this.requestSequence
    return new Promise<T>((resolve, reject) => {
      lane.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      lane.worker.postMessage({ ...request, id } as RasterWorkerRequest, transfer)
    })
  }

  private schedule<T>(
    client: ClientState,
    kind: TaskKind,
    tile: RasterTileRequest | undefined,
    lane: number | undefined,
    run: (lane: Lane) => Promise<unknown>,
  ): Promise<T> {
    if (client.disposed) return Promise.reject(abortError('Raster client is disposed'))
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ client, kind, tile, lane, run, resolve: resolve as (value: unknown) => void, reject })
      this.dispatch()
    })
  }

  /** Start queued work while lanes have capacity: control first, then newest tiles. */
  private dispatch(): void {
    this.dropObsoleteTiles()
    for (;;) {
      const task = this.nextTask()
      if (!task) return
      const lane = task.lane !== undefined
        ? this.lanes[task.lane]!
        : this.leastLoadedLane()!
      lane.inFlight += 1
      const started = performance.now()
      const label = task.tile ? `${task.tile.z}/${task.tile.x}/${task.tile.y}` : undefined
      task.run(lane).then((value) => {
        if (label) recordRaster({ kind: 'tile', detail: `lane ${lane.index} ${label}`, ms: performance.now() - started })
        task.resolve(value)
      }, (error: unknown) => {
        recordRaster({ kind: task.tile ? 'tile-error' : 'control-error', detail: `${label ?? ''} ${error instanceof Error ? error.message : String(error)}`.trim(), ms: performance.now() - started })
        task.reject(error)
      }).finally(() => {
        lane.inFlight -= 1
        this.dispatch()
      })
    }
  }

  /** Reject queued tiles their client no longer wants, so obsolete work never waits for a lane. */
  private dropObsoleteTiles(): void {
    if (!this.queue.some((task) => task.tile && task.client.relevance)) return
    this.queue = this.queue.filter((task) => {
      if (!task.tile || !task.client.relevance || task.client.relevance(task.tile)) return true
      recordRaster({ kind: 'tile-dropped', detail: `${task.tile.z}/${task.tile.x}/${task.tile.y}` })
      task.reject(abortError('Raster tile left the viewport'))
      return false
    })
  }

  private nextTask(): Task | null {
    const capacity = (lane: Lane) => lane.inFlight < this.options.maxInFlightPerLane
    if (!this.lanes.some(capacity)) return null
    // Controls (open, close, encode) are cheap and unblock tiles: oldest first.
    for (let index = 0; index < this.queue.length; index += 1) {
      const task = this.queue[index]!
      if (task.kind !== 'control') continue
      if (task.lane !== undefined && !capacity(this.lanes[task.lane]!)) continue
      this.queue.splice(index, 1)
      return task
    }
    // Tiles: the newest request belongs to the current viewport.
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const task = this.queue[index]!
      if (task.lane !== undefined && !capacity(this.lanes[task.lane]!)) continue
      this.queue.splice(index, 1)
      if (task.client.disposed) {
        task.reject(abortError('Raster client is disposed'))
        continue
      }
      if (task.tile && task.client.relevance && !task.client.relevance(task.tile)) {
        recordRaster({ kind: 'tile-dropped', detail: `${task.tile.z}/${task.tile.x}/${task.tile.y}` })
        task.reject(abortError('Raster tile left the viewport'))
        continue
      }
      return task
    }
    return null
  }

  private leastLoadedLane(): Lane | null {
    let best: Lane | null = null
    for (const lane of this.lanes) {
      if (lane.inFlight >= this.options.maxInFlightPerLane) continue
      if (!best || lane.inFlight < best.inFlight) best = lane
    }
    return best
  }

  /** Open one handle in one lane, once; later renders there await it. */
  private ensureOpen(lane: Lane, handle: number): Promise<unknown> {
    let lanes = this.openedIn.get(handle)
    if (!lanes) {
      lanes = new Map()
      this.openedIn.set(handle, lanes)
    }
    let opening = lanes.get(lane.index)
    if (!opening) {
      opening = this.post<RasterSourceMetadata>(lane, { id: 0, op: 'open', handle, url: this.urls.get(handle)! })
      opening.catch(() => lanes!.delete(lane.index))
      lanes.set(lane.index, opening)
    }
    return opening
  }

  private async openSource(client: ClientState, url: string): Promise<RasterProxySource> {
    const handle = ++this.handleSequence
    this.urls.set(handle, url)
    client.handles.add(handle)
    let metadata: RasterSourceMetadata
    try {
      metadata = await this.schedule<RasterSourceMetadata>(client, 'control', undefined, undefined, (lane) =>
        this.ensureOpen(lane, handle))
    } catch (error) {
      this.closeHandle(handle)
      client.handles.delete(handle)
      throw error
    }
    if (client.disposed) {
      this.closeHandle(handle)
      throw abortError('Raster client is disposed')
    }
    const render = (encoding: 'png' | 'rgba', z: number, x: number, y: number, options: RasterRenderOptions = {}) =>
      this.schedule<Uint8Array | Uint8ClampedArray | null>(client, 'tile', { z, x, y }, undefined, async (lane) => {
        await this.ensureOpen(lane, handle)
        return this.post(lane, { id: 0, op: 'render', handle, z, x, y, render: options, encoding })
      })
    return {
      ...metadata,
      async renderTilePNG(z, x, y, options) {
        return ((await render('png', z, x, y, options)) as Uint8Array | null) ?? new Uint8Array(0)
      },
      renderTileRGBA: (z, x, y, options) => render('rgba', z, x, y, options) as Promise<Uint8ClampedArray | null>,
    }
  }

  private async renderPreview(
    client: ClientState,
    urls: readonly string[],
    bbox: [number, number, number, number],
    size: { width: number; height: number },
    render: RasterRenderOptions,
  ): Promise<Uint8Array> {
    const composite = new Uint8ClampedArray(size.width * size.height * 4)
    const handles: number[] = []
    try {
      for (const url of urls) {
        const handle = ++this.handleSequence
        this.urls.set(handle, url)
        client.handles.add(handle)
        handles.push(handle)
        const rgba = await this.schedule<Uint8ClampedArray>(client, 'tile', undefined, undefined, async (lane) => {
          await this.ensureOpen(lane, handle)
          return this.post(lane, { id: 0, op: 'bbox', handle, bbox, width: size.width, height: size.height, render })
        })
        // First listed source stays on top: fill only still-transparent pixels.
        let complete = true
        for (let index = 3; index < composite.length; index += 4) {
          if (composite[index] !== 0) continue
          if (rgba[index] === 0) {
            complete = false
            continue
          }
          composite[index - 3] = rgba[index - 3]!
          composite[index - 2] = rgba[index - 2]!
          composite[index - 1] = rgba[index - 1]!
          composite[index] = rgba[index]!
        }
        if (complete) break
      }
      return await this.schedule<Uint8Array>(client, 'control', undefined, undefined, (lane) =>
        this.post(lane, { id: 0, op: 'encode', rgba: composite, width: size.width, height: size.height }, [composite.buffer]))
    } finally {
      for (const handle of handles) {
        client.handles.delete(handle)
        this.closeHandle(handle)
      }
    }
  }

  private closeHandle(handle: number): void {
    const lanes = this.openedIn.get(handle)
    this.openedIn.delete(handle)
    this.urls.delete(handle)
    if (!lanes) return
    for (const laneIndex of lanes.keys()) {
      const lane = this.lanes[laneIndex]
      if (lane) void this.post(lane, { id: 0, op: 'close', handle }).catch(() => {})
    }
  }

  private async usage(): Promise<RasterLaneUsage[]> {
    return Promise.all(this.lanes.map((lane) => this.post<RasterLaneUsage>(lane, { id: 0, op: 'usage' })))
  }

  private release(client: ClientState): void {
    if (client.disposed) return
    client.disposed = true
    recordRaster({ kind: 'client-dispose', detail: `${this.queue.filter((task) => task.client === client).length} queued, ${client.handles.size} sources` })
    const kept: Task[] = []
    for (const task of this.queue) {
      if (task.client === client) task.reject(abortError('Raster client is disposed'))
      else kept.push(task)
    }
    this.queue = kept
    for (const handle of client.handles) this.closeHandle(handle)
    client.handles.clear()
    this.clients -= 1
    if (this.clients === 0) this.stop()
  }

  private stop(): void {
    recordRaster({ kind: 'lanes-stop', detail: `${this.lanes.reduce((sum, lane) => sum + lane.pending.size, 0)} in flight` })
    for (const lane of this.lanes) {
      const error = abortError('Raster workers stopped')
      for (const waiter of lane.pending.values()) waiter.reject(error)
      lane.pending.clear()
      lane.worker.onmessage = null
      lane.worker.onerror = null
      lane.worker.terminate()
    }
    this.lanes = []
    this.queue = []
    this.openedIn.clear()
    this.urls.clear()
  }
}

/** Decoded-block cache shared by all display sources (plan §5: 128 MiB). */
export const RASTER_DECODED_CACHE_BYTES = 128 * 1024 * 1024

let workspacePool: RasterWorkerPool | null = null

/** The workspace's shared pool, created on first use. */
export function rasterWorkerPool(): RasterWorkerPool {
  workspacePool ??= new RasterWorkerPool({
    lanes: 2,
    budgetBytes: RASTER_DECODED_CACHE_BYTES,
    maxInFlightPerLane: 4,
    createWorker: () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'canopi-raster-display' }) as unknown as RasterWorkerLike,
  })
  return workspacePool
}
