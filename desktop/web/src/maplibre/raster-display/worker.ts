/**
 * Raster display worker lane.
 *
 * Hosts the pinned `cog-tiler-wasm` module off the UI thread: COG header
 * reads, block decode, reprojection and colorizing all happen here. The main
 * thread only forwards requests through `pool.ts`, which presents this lane to
 * the upstream `LayerManager` as its public `loadCogTiler` module.
 *
 * Decoded blocks are cached by the upstream `CogSource` in a per-source
 * `tileCache` map capped by entry count only. This lane replaces that map with
 * one that charges every decoded block to a single lane-wide byte budget, so
 * many open sources cannot multiply the cache. The replacement relies on the
 * `tileCache` field of `cog-tiler-wasm@0.4.0`; `open` fails loudly if the
 * pinned module stops exposing it rather than silently losing the bound.
 */
import { init, openCog, rgbaToPng } from 'cog-tiler-wasm'
import type { CogSource, RenderOptions } from 'cog-tiler-wasm'
import type { RasterWorkerReply, RasterWorkerRequest, RasterSourceMetadata } from './protocol'

/** The dedicated worker scope, typed narrowly so the DOM program stays unchanged. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RasterWorkerRequest>) => void) | null
  postMessage(message: RasterWorkerReply, transfer?: Transferable[]): void
}

/** Lane-wide byte budget for decoded blocks; set by the pool on start. */
let budgetBytes = 64 * 1024 * 1024
let usedBytes = 0

interface CacheEntry {
  readonly cache: BudgetedTileCache
  readonly key: string
  bytes: number
}

/** Least-recently-used order across every open source in this lane. */
const lru = new Map<string, CacheEntry>()
let cacheSequence = 0

/**
 * A `Map` compatible with the upstream tile cache that charges resolved
 * decoded blocks to the lane budget and evicts least-recently-used blocks
 * across sources once the budget is exceeded.
 */
class BudgetedTileCache extends Map<string, Promise<unknown>> {
  private readonly prefix = `c${++cacheSequence}:`

  override get(key: string): Promise<unknown> | undefined {
    const value = super.get(key)
    const entry = lru.get(this.prefix + key)
    if (value && entry) {
      lru.delete(this.prefix + key)
      lru.set(this.prefix + key, entry)
    }
    return value
  }

  override set(key: string, value: Promise<unknown>): this {
    super.set(key, value)
    const lruKey = this.prefix + key
    const entry: CacheEntry = { cache: this, key, bytes: 0 }
    forget(lruKey)
    lru.set(lruKey, entry)
    value.then((decoded) => {
      if (lru.get(lruKey) !== entry) return
      entry.bytes = decodedBytes(decoded)
      usedBytes += entry.bytes
      enforceBudget()
    }, () => {})
    return this
  }

  override delete(key: string): boolean {
    forget(this.prefix + key)
    return super.delete(key)
  }

  override clear(): void {
    for (const key of super.keys()) forget(this.prefix + key)
    super.clear()
  }

  evict(key: string): void {
    super.delete(key)
  }
}

function decodedBytes(decoded: unknown): number {
  if (ArrayBuffer.isView(decoded)) return decoded.byteLength
  return 0
}

function forget(lruKey: string): void {
  const entry = lru.get(lruKey)
  if (!entry) return
  lru.delete(lruKey)
  usedBytes -= entry.bytes
}

function enforceBudget(): void {
  for (const [lruKey, entry] of lru) {
    if (usedBytes <= budgetBytes) return
    lru.delete(lruKey)
    usedBytes -= entry.bytes
    entry.cache.evict(entry.key)
  }
}

/** Opened sources by pool handle. A pending open is awaited by later calls. */
const sources = new Map<number, Promise<CogSource>>()

function sourceFor(handle: number): Promise<CogSource> {
  const source = sources.get(handle)
  if (!source) throw new Error(`raster source ${handle} is not open in this lane`)
  return source
}

function metadataOf(source: CogSource): RasterSourceMetadata {
  return {
    boundsLonLat: [...source.boundsLonLat],
    levels: source.levels.map((level) => ({ width: level.width, height: level.height })),
    mode: source.mode,
    crsLabel: source.crsLabel,
    hasPalette: source.hasPalette,
  }
}

async function handle(request: RasterWorkerRequest): Promise<{ value: unknown; transfer: Transferable[] }> {
  switch (request.op) {
    case 'init':
      budgetBytes = request.budgetBytes
      await init()
      enforceBudget()
      return { value: true, transfer: [] }
    case 'open': {
      const opening = (async () => {
        await init()
        const source = await openCog(request.url)
        const upstream = source as unknown as { tileCache?: unknown }
        if (!(upstream.tileCache instanceof Map)) {
          throw new Error('cog-tiler-wasm no longer exposes its decoded tile cache; the lane budget cannot be enforced')
        }
        upstream.tileCache = new BudgetedTileCache()
        return source
      })()
      sources.set(request.handle, opening)
      opening.catch(() => {
        if (sources.get(request.handle) === opening) sources.delete(request.handle)
      })
      return { value: metadataOf(await opening), transfer: [] }
    }
    case 'render': {
      const source = await sourceFor(request.handle)
      const rgba = await source.renderTileRGBA(request.z, request.x, request.y, request.render as RenderOptions)
      if (!rgba) return { value: null, transfer: [] }
      if (request.encoding === 'rgba') {
        const copy = new Uint8ClampedArray(rgba)
        return { value: copy, transfer: [copy.buffer] }
      }
      const png = await rgbaToPng(rgba, 256, 256)
      return { value: png, transfer: [png.buffer] }
    }
    case 'bbox': {
      const source = await sourceFor(request.handle)
      const image = await source.bbox(request.bbox, {
        ...(request.render as RenderOptions),
        width: request.width,
        height: request.height,
      })
      const copy = new Uint8ClampedArray(image.rgba)
      return { value: copy, transfer: [copy.buffer] }
    }
    case 'encode': {
      const png = await rgbaToPng(request.rgba, request.width, request.height)
      return { value: png, transfer: [png.buffer] }
    }
    case 'close': {
      const source = sources.get(request.handle)
      sources.delete(request.handle)
      if (source) {
        const opened = await source.catch(() => null)
        const cache = (opened as unknown as { tileCache?: unknown } | null)?.tileCache
        if (cache instanceof BudgetedTileCache) cache.clear()
      }
      return { value: true, transfer: [] }
    }
    case 'usage':
      return { value: { cacheBytes: usedBytes, cacheBlocks: lru.size, openSources: sources.size }, transfer: [] }
  }
}

scope.onmessage = (event: MessageEvent<RasterWorkerRequest>) => {
  const request = event.data
  handle(request).then(
    ({ value, transfer }) => {
      const reply: RasterWorkerReply = { id: request.id, ok: true, value }
      scope.postMessage(reply, transfer)
    },
    (error: unknown) => {
      const reply: RasterWorkerReply = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      scope.postMessage(reply)
    },
  )
}
