// @vitest-environment node
/**
 * The display seam through its real implementations: a derivative the Rust
 * engine wrote (`fixtures/rust-display-cog.tif`, an RD New tile near Delft,
 * kept current by `display_cog::library_tests::the_web_display_fixture_is_what_the_engine_writes`)
 * opened by the pinned `cog-tiler-wasm`, its WebAssembly started in Node.
 * The lane opens it on cog-tiler's affine EPSG:3857 path, and at each probed
 * pixel centre cog-tiler reads the value native hover read there (A4).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RasterWorkerReply, RasterWorkerRequest } from './protocol'

interface Fixture {
  bounds: [number, number, number, number]
  nodata: number | null
  width: number
  height: number
  probes: { longitude: number; latitude: number; value: number | null }[]
}

const fixtureUrl = new URL('./fixtures/rust-display-cog.tif', import.meta.url)
const tif = new Uint8Array(readFileSync(fileURLToPath(fixtureUrl)))
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rust-display-cog.json', import.meta.url)), 'utf8')) as Fixture
const ASSET = 'asset://localhost/display-cog/rust-display-cog.tif'

/** Serves the wasm binaries from disk and the derivative by byte range, as the asset protocol does. */
async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
  if (url.startsWith('file:')) {
    return new Response(new Uint8Array(readFileSync(fileURLToPath(url))), { headers: { 'Content-Type': 'application/wasm' } })
  }
  if (url !== ASSET) return new Response(null, { status: 404 })
  const range = /bytes=(\d+)-(\d*)/.exec(new Headers(init?.headers).get('Range') ?? '')
  if (!range) return new Response(tif)
  const start = Number(range[1])
  const end = range[2] ? Math.min(Number(range[2]) + 1, tif.length) : tif.length
  return new Response(tif.slice(start, end), {
    status: 206,
    headers: { 'Content-Range': `bytes ${start}-${end - 1}/${tif.length}` },
  })
}

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(serve))
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('a display derivative the Rust engine wrote', () => {
  it('opens in the worker lane on the EPSG:3857 path with the bounds Rust registered', async () => {
    const replies: RasterWorkerReply[] = []
    const scope: {
      onmessage: ((event: MessageEvent<RasterWorkerRequest>) => void) | null
      postMessage(message: RasterWorkerReply): void
    } = { onmessage: null, postMessage: (message) => replies.push(message) }
    vi.stubGlobal('self', scope)
    vi.resetModules()
    await import('./worker')
    scope.onmessage?.({ data: { op: 'open', id: 1, handle: 1, url: ASSET } } as MessageEvent<RasterWorkerRequest>)
    await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 10_000 })
    const reply = replies[0]!
    if (!reply.ok) throw new Error(reply.error)
    const metadata = reply.value as { mode: string; crsLabel: string; boundsLonLat: number[]; levels: { width: number; height: number }[] }
    expect(metadata.mode).toBe('3857')
    expect(metadata.crsLabel).toBe('EPSG:3857')
    expect(metadata.levels[0]).toEqual({ width: fixture.width, height: fixture.height })
    metadata.boundsLonLat.forEach((value, index) => expect(value).toBeCloseTo(fixture.bounds[index]!, 9))
  })

  it('reads at each pixel centre the value native hover read there', async () => {
    const { init, openCog } = await import('cog-tiler-wasm')
    await init()
    const source = await openCog(tif)
    expect(source.mode).toBe('3857')
    const valued = fixture.probes.filter((probe) => probe.value !== null)
    expect(valued.length).toBeGreaterThan(5)
    expect(fixture.probes.length - valued.length).toBeGreaterThan(0)
    for (const probe of fixture.probes) {
      const read = await source.point(probe.longitude, probe.latitude)
      expect(read.outside, `${probe.longitude}, ${probe.latitude}`).toBeUndefined()
      const value = read.values[0]!
      const empty = Number.isNaN(value) || value === fixture.nodata
      expect(empty ? null : value, `${probe.longitude}, ${probe.latitude}`).toBe(probe.value)
    }
  })
})
