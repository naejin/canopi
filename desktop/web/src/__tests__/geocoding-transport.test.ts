import { afterEach, describe, expect, it, vi } from 'vitest'

const geocodeAddress = vi.hoisted(() => vi.fn())
vi.mock('../ipc/geocoding', () => ({ geocodeAddress }))

import { geocodeForward } from '../app/geocoding/registry'
import { geocodingTransport as browserTransport } from '../app/geocoding/transport.browser'
import { geocodingTransport as desktopTransport } from '../app/geocoding/transport.desktop'

afterEach(() => {
  vi.unstubAllGlobals()
  geocodeAddress.mockReset()
})

describe('geocoding transports', () => {
  it('Web reaches the registry through browser fetch', async () => {
    const fetchStub = vi.fn(async (_url: string) => new Response(JSON.stringify([{ lat: '47.39', lon: '0.689', display_name: 'Tours' }])))
    vi.stubGlobal('fetch', fetchStub)
    const matches = await geocodeForward('Tours', browserTransport, { limit: 5 })
    expect(new URL(fetchStub.mock.calls[0]![0]).hostname).toBe('nominatim.openstreetmap.org')
    expect(matches).toEqual([{ lat: 47.39, lon: 0.689, displayName: 'Tours', score: null }])
  })

  it('Desktop sends Nominatim through the native transport, never the webview fetch', async () => {
    const fetchStub = vi.fn()
    vi.stubGlobal('fetch', fetchStub)
    geocodeAddress.mockResolvedValue([{ lat: 47.39, lon: 0.689, display_name: 'Tours' }])
    const matches = await geocodeForward('Tours', desktopTransport, { limit: 5 })
    expect(geocodeAddress).toHaveBeenCalledWith('Tours')
    expect(fetchStub).not.toHaveBeenCalled()
    expect(matches).toEqual([{ lat: 47.39, lon: 0.689, displayName: 'Tours', score: null }])
  })

  it('reports an HTTP failure from the browser transport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))
    await expect(geocodeForward('Tours', browserTransport)).rejects.toThrow('HTTP 429')
  })
})
