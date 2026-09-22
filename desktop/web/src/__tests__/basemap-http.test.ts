import { describe, expect, it, vi } from 'vitest'
import {
  BASEMAP_HTTP_MAX_BODY_BYTES,
  createBrowserBasemapHttp,
} from '../maplibre/basemap-http.browser'

const SECRET = 'fake-recognizable-key'
const URL_WITH_SECRET = `https://tile.googleapis.com/v1/createSession?key=${SECRET}`

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('bounded browser basemap HTTP capability', () => {
  it('never lets the request URL — and therefore the key — escape through a failure', async () => {
    // A transport failure whose message carries the whole URL is the realistic
    // worst case: a naive adapter re-throws it and the key reaches the console.
    const http = createBrowserBasemapHttp(
      vi.fn(async () => {
        throw new Error(`request to ${URL_WITH_SECRET} failed`)
      }) as unknown as typeof fetch,
    )

    const response = await http.request({
      url: URL_WITH_SECRET,
      signal: new AbortController().signal,
    })

    expect(response).toEqual({ ok: false, status: 0, json: null })
    expect(JSON.stringify(response)).not.toContain(SECRET)
  })

  it('reads JSON only, so a misbehaving endpoint cannot inject a parsed body', async () => {
    const http = createBrowserBasemapHttp(
      vi.fn(async () =>
        new Response('<html>maintenance</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })) as unknown as typeof fetch,
    )
    const response = await http.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
    })
    // A 200 with a non-JSON body is not a usable session answer.
    expect(response.ok).toBe(true)
    expect(response.json).toBeNull()
  })

  it('refuses an oversized body rather than buffering it', async () => {
    const oversized = 'x'.repeat(BASEMAP_HTTP_MAX_BODY_BYTES + 1)
    const http = createBrowserBasemapHttp(
      vi.fn(async () =>
        new Response(JSON.stringify({ padding: oversized }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    )
    const response = await http.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
    })
    expect(response.json).toBeNull()
  })

  it('reports Retry-After in both its numeric and HTTP-date forms', async () => {
    const numeric = createBrowserBasemapHttp(
      vi.fn(async () =>
        jsonResponse({}, { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } })) as unknown as typeof fetch,
    )
    const first = await numeric.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
    })
    expect(first.ok).toBe(false)
    expect(first.status).toBe(429)
    expect(first.retryAfterSeconds).toBe(30)

    const future = new Date(Date.now() + 45_000).toUTCString()
    const dated = createBrowserBasemapHttp(
      vi.fn(async () =>
        jsonResponse({}, { status: 503, headers: { 'content-type': 'application/json', 'retry-after': future } })) as unknown as typeof fetch,
    )
    const second = await dated.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
    })
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(45)
  })

  it('sends no ambient credentials and posts a JSON body for a session', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ session: 'fake-token', expiry: 1 }))
    const http = createBrowserBasemapHttp(fetchImpl as unknown as typeof fetch)
    await http.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
      method: 'POST',
      body: { mapType: 'satellite' },
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(init.body).toBe(JSON.stringify({ mapType: 'satellite' }))
  })

  it('parses a normal JSON answer', async () => {
    const http = createBrowserBasemapHttp(
      vi.fn(async () => jsonResponse({ expiry: 1234, tileWidth: 512 })) as unknown as typeof fetch,
    )
    const response = await http.request({
      url: 'https://example.invalid/session',
      signal: new AbortController().signal,
    })
    expect(response.ok).toBe(true)
    expect(response.json).toEqual({ expiry: 1234, tileWidth: 512 })
  })

  it('does not read a body on an error status', async () => {
    // An error body can echo the request, so it is never parsed.
    const http = createBrowserBasemapHttp(
      vi.fn(async () =>
        new Response(JSON.stringify({ error: URL_WITH_SECRET }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    )
    const response = await http.request({
      url: URL_WITH_SECRET,
      signal: new AbortController().signal,
    })
    expect(response.ok).toBe(false)
    expect(response.json).toBeNull()
    expect(JSON.stringify(response)).not.toContain(SECRET)
  })
})
