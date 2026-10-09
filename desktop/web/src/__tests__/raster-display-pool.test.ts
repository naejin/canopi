import { describe, expect, it, vi } from 'vitest'
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
    if (message.op === 'open') this.reply(message.id, { boundsLonLat: [0, 0, 1, 1] })
    else if (message.op !== 'render' && message.op !== 'bbox' && message.op !== 'statistics') this.reply(message.id, true)
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
  it('reads one asset\'s statistics in a lane through a handle it closes afterwards', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const lane = created[0]!
    const statistics = client.statistics('asset://localhost/a.tif')
    await vi.waitFor(() => expect(lane.requests.some((request) => request.op === 'statistics')).toBe(true))
    const request = lane.requests.find((candidate) => candidate.op === 'statistics')!
    const answer = { min: 1, max: 9, percentile2: 1.5, percentile98: 8.5, histogram: [1, 2], pixels: 4 }
    lane.answer(request, answer)
    expect(await statistics).toEqual(answer)
    await settle()
    const opened = lane.requests.find((candidate) => candidate.op === 'open')!
    expect(opened).toMatchObject({ url: 'asset://localhost/a.tif' })
    expect(lane.requests.at(-1)).toMatchObject({ op: 'close', handle: (opened as { handle: number }).handle })
  })

  it('runs statistics behind tiles and keeps one lane free of them, so a mosaic\'s reads never hold back the map', async () => {
    const { instance, created } = pool(2, 4)
    const map = instance.acquire()
    const ranges = instance.acquire()
    const source = await map.openCog('asset://localhost/tile.tif')
    const [laneA, laneB] = created as [FakeLane, FakeLane]
    const all = (op: string) => created.flatMap((lane) => lane.requests.filter((request) => request.op === op))
    const reads = Array.from({ length: 30 }, (_, index) =>
      ranges.statistics(`asset://localhost/part-${index}.tif`).catch((error: unknown) => error))
    await settle()
    expect(all('statistics')).toHaveLength(1)
    const reading = laneA.requests.some((request) => request.op === 'statistics') ? laneA : laneB
    const free = reading === laneA ? laneB : laneA
    // Tiles go to the lane no read blocks, even once it holds more tiles.
    const tiles = [source.renderTilePNG(10, 1, 1), source.renderTilePNG(10, 2, 1)]
    await settle()
    expect(free.renders()).toHaveLength(2)
    expect(reading.renders()).toHaveLength(0)
    // An answered read frees the one statistics slot for the next one.
    const first = all('statistics')[0]!
    reading.answer(first, null)
    await expect(reads[0]).resolves.toBeNull()
    await settle()
    expect(all('statistics')).toHaveLength(2)
    expect(free.requests.some((request) => request.op === 'statistics')).toBe(false)
    for (const render of free.renders()) free.answer(render)
    await expect(Promise.all(tiles)).resolves.toEqual([new Uint8Array([1]), new Uint8Array([1])])
    ranges.dispose()
    await expect(reads.at(-1)).resolves.toMatchObject({ name: 'AbortError' })
    map.dispose()
  })

  it('runs at most one statistics read per lane and one fewer than the lanes in all', async () => {
    const { instance, created } = pool(3, 4)
    const ranges = instance.acquire()
    const reads = Array.from({ length: 5 }, (_, index) =>
      ranges.statistics(`asset://localhost/part-${index}.tif`).catch((error: unknown) => error))
    await settle()
    const statistics = (lane: FakeLane) => lane.requests.filter((request) => request.op === 'statistics').length
    expect(created.map(statistics).sort()).toEqual([0, 1, 1])
    ranges.dispose()
    await Promise.all(reads)
  })

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

  it('closes the sources opened for a released URL in every lane and keeps the others open', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const released = await client.openCog('asset://localhost/a.tif')
    await client.openCog('asset://localhost/b.tif')
    const lane = created[0]!
    const handleOf = (url: string) => lane.requests.find((request) => request.op === 'open' && request.url === url)!
    const releasedHandle = (handleOf('asset://localhost/a.tif') as { handle: number }).handle
    const keptHandle = (handleOf('asset://localhost/b.tif') as { handle: number }).handle

    client.releaseSources(['asset://localhost/a.tif'])
    const closed = lane.requests.filter((request) => request.op === 'close').map((request) => (request as { handle: number }).handle)
    expect(closed).toEqual([releasedHandle])
    expect(closed).not.toContain(keptHandle)
    // A released source never reopens behind the engine's back.
    await expect(released.renderTilePNG(1, 0, 0)).rejects.toMatchObject({ name: 'AbortError' })
    expect(lane.requests.filter((request) => request.op === 'open')).toHaveLength(2)
    client.dispose()
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

  it('replaces a crashed lane so later tiles render instead of failing forever', async () => {
    const { instance, created } = pool(1, 1)
    const client = instance.acquire()
    const source = await client.openCog('asset://localhost/a.tif')
    const pending = source.renderTilePNG(8, 0, 0).catch((error: unknown) => error)
    await settle()
    created[0]!.onerror?.({ message: 'wasm trap' } as ErrorEvent)
    await pending
    expect(created[0]!.terminated).toBe(true)
    expect(created).toHaveLength(2)
    expect(instance.laneCount).toBe(1)

    // The source is reopened in the new lane and its next tile renders there.
    const next = source.renderTilePNG(8, 1, 0)
    await settle()
    const lane = created[1]!
    expect(lane.requests.some((request) => request.op === 'open')).toBe(true)
    lane.answer(lane.renders()[0]!)
    expect(await next).toBeInstanceOf(Uint8Array)
    client.dispose()
    expect(lane.terminated).toBe(true)
  })
})
