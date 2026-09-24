import { describe, expect, it } from 'vitest'
import { RasterWorkerPool, type RasterWorkerLike } from '../maplibre/raster-display/pool'
import type { RasterWorkerReply, RasterWorkerRequest } from '../maplibre/raster-display/protocol'

/** In-process lane: records requests and answers only when the test says so. */
class FakeLane implements RasterWorkerLike {
  onmessage: ((event: MessageEvent<RasterWorkerReply>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: RasterWorkerRequest[] = []
  terminated = false

  postMessage(message: RasterWorkerRequest): void {
    this.requests.push(message)
    // Control messages answer immediately; renders wait for `answer`.
    if (message.op === 'open') this.reply(message.id, { boundsLonLat: [0, 0, 1, 1], levels: [], mode: 'warp', crsLabel: 'EPSG:2154', hasPalette: false })
    else if (message.op !== 'render' && message.op !== 'bbox') this.reply(message.id, true)
  }

  terminate(): void {
    this.terminated = true
  }

  renders(): Extract<RasterWorkerRequest, { op: 'render' }>[] {
    return this.requests.filter((request): request is Extract<RasterWorkerRequest, { op: 'render' }> => request.op === 'render')
  }

  answer(request: RasterWorkerRequest, value: unknown = new Uint8Array([1])): void {
    this.reply(request.id, value)
  }

  private reply(id: number, value: unknown): void {
    queueMicrotask(() => this.onmessage?.({ data: { id, ok: true, value } } as MessageEvent<RasterWorkerReply>))
  }
}

function pool(lanes = 1, maxInFlightPerLane = 1) {
  const created: FakeLane[] = []
  const instance = new RasterWorkerPool({
    lanes,
    budgetBytes: 128 * 1024 * 1024,
    maxInFlightPerLane,
    createWorker: () => {
      const lane = new FakeLane()
      created.push(lane)
      return lane
    },
  })
  return { instance, created }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('raster display worker pool', () => {
  it('starts lanes with an even share of one aggregate decoded-block budget', () => {
    const { instance, created } = pool(2)
    instance.acquire()
    expect(created).toHaveLength(2)
    expect(created.map((lane) => lane.requests[0])).toEqual([
      expect.objectContaining({ op: 'init', budgetBytes: 64 * 1024 * 1024 }),
      expect.objectContaining({ op: 'init', budgetBytes: 64 * 1024 * 1024 }),
    ])
  })

  it('dispatches the newest tile first and drops queued tiles that left the viewport', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const source = await client.openCog('asset://localhost/a.tif')
    const lane = created[0]!
    const first = source.renderTilePNG(10, 0, 0)
    await settle()
    // The lane is busy; the next two queue behind it.
    const stale = source.renderTilePNG(10, 1, 0).catch((error: unknown) => error)
    const fresh = source.renderTilePNG(10, 2, 0)
    client.setRelevance((tile) => tile.x !== 1)
    lane.answer(lane.renders()[0]!)
    await first
    await settle()
    expect(lane.renders().map((request) => request.x)).toEqual([0, 2])
    expect(await stale).toMatchObject({ name: 'AbortError' })
    lane.answer(lane.renders()[1]!)
    await expect(fresh).resolves.toEqual(new Uint8Array([1]))
  })

  it('rejects a disposed client’s queued work, closes its sources and stops idle workers', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const other = instance.acquire()
    const source = await client.openCog('asset://localhost/a.tif')
    const lane = created[0]!
    const running = source.renderTilePNG(12, 0, 0)
    await settle()
    const queued = source.renderTilePNG(12, 1, 0)
    client.dispose()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(lane.requests.some((request) => request.op === 'close')).toBe(true)
    expect(instance.laneCount).toBe(1)
    lane.answer(lane.renders()[0]!)
    await running
    other.dispose()
    expect(instance.laneCount).toBe(0)
    expect(lane.terminated).toBe(true)
    await expect(client.openCog('asset://localhost/b.tif')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fails a crashed lane’s pending work instead of leaving it waiting', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const source = await client.openCog('asset://localhost/a.tif')
    const pending = source.renderTilePNG(8, 0, 0)
    await settle()
    created[0]!.onerror?.({ message: 'wasm trap' } as ErrorEvent)
    await expect(pending).rejects.toThrow('wasm trap')
  })
})
