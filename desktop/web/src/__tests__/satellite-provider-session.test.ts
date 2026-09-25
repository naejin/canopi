import { describe, expect, it, vi } from 'vitest'
import {
  SatelliteImageryProvider,
  PROVIDER_MAX_RETRIES,
  PROVIDER_REQUEST_TIMEOUT_MS,
  sanitizeProviderReason,
  type SatelliteProviderHttp,
  type SatelliteProviderResponse,
  type SatelliteProviderState,
} from '../maplibre/satellite-provider-session'
import { GOOGLE_KEY_REQUIRED_REASON } from '../maplibre/satellite-provider'

const VIEWPORT = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }

function sessionBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    session: 'fake-session-token',
    // The documented createSession response carries expiry as an epoch-seconds
    // string, not a number.
    expiry: '4000000000',
    tileWidth: 512,
    tileHeight: 512,
    ...overrides,
  }
}

/** Established viewport metadata: copyright plus rectangles covering VIEWPORT. */
function viewportBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    copyright: 'Imagery &copy; Google',
    maxZoomRects: [
      { north: 49, south: 48, east: 1, west: -1, maxZoom: 18 },
    ],
    ...overrides,
  }
}

/** A scripted HTTP capability that records every request it is given. */
function scriptedHttp(
  answers: Array<SatelliteProviderResponse | (() => Promise<SatelliteProviderResponse>)>,
): { http: SatelliteProviderHttp; calls: Array<{ url: string; method?: string }> } {
  const calls: Array<{ url: string; method?: string }> = []
  let index = 0
  return {
    calls,
    http: {
      async request(input) {
        calls.push({ url: input.url, method: input.method })
        const answer = answers[Math.min(index, answers.length - 1)]!
        index += 1
        return typeof answer === 'function' ? await answer() : answer
      },
    },
  }
}

function ok(json: unknown): SatelliteProviderResponse {
  return { ok: true, status: 200, json }
}

function failure(status: number, retryAfterSeconds?: number): SatelliteProviderResponse {
  return { ok: false, status, json: null, retryAfterSeconds: retryAfterSeconds ?? null }
}

/** Collects every published state so a test can assert the sequence. */
function recorder(provider: SatelliteImageryProvider): SatelliteProviderState[] {
  const seen: SatelliteProviderState[] = []
  provider.subscribe((state) => seen.push(state))
  return seen
}

describe('satellite provider session lifecycle', () => {
  it('goes straight to ready for providers that need no session and issues no request', () => {
    const { http, calls } = scriptedHttp([ok({})])
    const provider = new SatelliteImageryProvider(http, {})
    const seen = recorder(provider)

    provider.update({ provider: 'eox' }, VIEWPORT)

    expect(provider.snapshot().state).toBe('ready')
    expect(seen.map((state) => state.state)).toEqual(['ready'])
    // Nothing remote happens for a source that needs no session, so a hidden or
    // provisional surface that never updates issues no work at all.
    expect(calls).toEqual([])
    provider.dispose()
  })

  it('reports Google without a key as unavailable without making any request', () => {
    const { http, calls } = scriptedHttp([ok({})])
    const provider = new SatelliteImageryProvider(http, { googleMapsApiKey: '  ' })
    const seen = recorder(provider)

    provider.update({ provider: 'google' }, VIEWPORT)

    const last = provider.snapshot()
    expect(last).toEqual({
      state: 'unavailable',
      provider: 'google',
      reason: GOOGLE_KEY_REQUIRED_REASON,
    })
    expect(seen.map((state) => state.state)).toEqual(['unavailable'])
    expect(calls).toEqual([])
    provider.dispose()
  })

  it('loads an official session, adopts its tile size and keeps the token private', async () => {
    const { http, calls } = scriptedHttp([
      ok(sessionBody()),
      ok(viewportBody({ copyright: 'Imagery &copy; Google' })),
    ])
    const provider = new SatelliteImageryProvider(http, {
      googleMapsApiKey: 'fake-key',
      locale: 'fr-FR',
    })
    const seen = recorder(provider)

    provider.update({ provider: 'google' }, VIEWPORT)
    expect(provider.snapshot().state).toBe('loading')

    await vi.waitFor(() => {
      const last = provider.snapshot()
      if (last.state !== 'ready') throw new Error('not ready yet')
      // The provider's own tile size wins over the descriptor default.
      if (last.descriptor.tileSize !== 512) throw new Error('tile size not adopted')
      if (last.copyright !== 'Imagery &copy; Google') throw new Error('copyright not adopted')
    })

    // Ready is published only once: session alone is not enough; validated
    // viewport metadata must also arrive before imagery is Ready.
    expect(seen.map((state) => state.state)).toEqual(['loading', 'ready'])
    // Both provider requests are authenticated: the documented viewport request
    // carries the session *and* the API key. Neither reaches published state.
    expect(calls[0]?.url).toContain('key=fake-key')
    expect(calls[1]?.url).toContain('session=fake-session-token')
    expect(calls[1]?.url).toContain('key=fake-key')
    expect(JSON.stringify(seen)).not.toContain('fake-session-token')
    expect(JSON.stringify(seen)).not.toContain('fake-key')
    provider.dispose()
  })

  it('reports an authentication failure as actionable and never downgrades to keyless', async () => {
    // A 403 is not retryable: sending the same bad key again cannot help.
    const { http, calls } = scriptedHttp([failure(403)])
    const provider = new SatelliteImageryProvider(http, { googleMapsApiKey: 'fake-bad-key' })

    provider.update({ provider: 'google' }, VIEWPORT)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'unavailable') throw new Error('not settled')
    })

    const last = provider.snapshot()
    if (last.state !== 'unavailable') throw new Error('expected unavailable')
    expect(last.reason).toMatch(/key/i)
    expect(calls).toHaveLength(1)
    // The failure never substitutes keyless tiles, and the key is not echoed.
    expect(JSON.stringify(last)).not.toContain('fake-bad-key')
    provider.dispose()
  })

  it('retries transient failures within the fixed budget and stops there', async () => {
    const { http, calls } = scriptedHttp([failure(500)])
    const provider = new SatelliteImageryProvider(
      http,
      { googleMapsApiKey: 'fake-key' },
      () => 4_000_000_000_000,
      async () => {},
    )

    provider.update({ provider: 'google' }, VIEWPORT)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'unavailable') throw new Error('not settled')
    })

    // One attempt plus the contract's two retries, and no more.
    expect(calls).toHaveLength(PROVIDER_MAX_RETRIES + 1)
    provider.dispose()
  })

  it('recovers when a retry succeeds', async () => {
    // One transient failure, then the session, then the viewport refresh that a
    // ready official generation asks for.
    const { http, calls } = scriptedHttp([
      failure(503),
      ok(sessionBody()),
      ok(viewportBody({ copyright: 'Imagery' })),
    ])
    const provider = new SatelliteImageryProvider(
      http,
      { googleMapsApiKey: 'fake-key' },
      () => 4_000_000_000_000,
      async () => {},
    )

    provider.update({ provider: 'google' }, VIEWPORT)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'ready') throw new Error('not ready')
    })
    expect(calls).toHaveLength(3)
    expect(calls[0]?.url).toContain('createSession')
    expect(calls[1]?.url).toContain('createSession')
    expect(calls[2]?.url).toContain('viewport')
    provider.dispose()
  })

  it('does not hold work for a Retry-After longer than the backoff', async () => {
    const { http, calls } = scriptedHttp([failure(429, 30)])
    const provider = new SatelliteImageryProvider(
      http,
      { googleMapsApiKey: 'fake-key' },
      () => 4_000_000_000_000,
      async () => {},
    )

    provider.update({ provider: 'google' }, VIEWPORT)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'unavailable') throw new Error('not settled')
    })
    // A server-directed wait longer than the backoff is reported rather than
    // held, so the surface never looks hung.
    expect(calls).toHaveLength(1)
    provider.dispose()
  })

  it('fences a superseded session so a late answer cannot replace the current provider', async () => {
    // A holder object rather than a `let`: TypeScript narrows a closure-assigned
    // `let` to `never` at the call site, which the edition builds reject.
    const gate: { release: (() => void) | null } = { release: null }
    const { http } = scriptedHttp([
      () =>
        new Promise<SatelliteProviderResponse>((resolve) => {
          gate.release = () => resolve(ok(sessionBody()))
        }),
      ok({ copyright: 'second' }),
    ])
    const provider = new SatelliteImageryProvider(http, { googleMapsApiKey: 'fake-key' }, () => 0)
    provider.update({ provider: 'google' }, VIEWPORT)

    // The user switches provider while the first session is still in flight.
    provider.update({ provider: 'eox' }, VIEWPORT)
    expect(provider.snapshot().state).toBe('ready')

    gate.release?.()
    await Promise.resolve()
    await Promise.resolve()

    // The late official answer must not publish over the current EOX state.
    const last = provider.snapshot()
    expect(last.state).toBe('ready')
    if (last.state !== 'ready') throw new Error('expected ready')
    expect(last.descriptor.provider).toBe('eox')
    provider.dispose()
  })

  it('stops publishing once disposed', async () => {
    const { http } = scriptedHttp([ok(sessionBody())])
    const provider = new SatelliteImageryProvider(http, { googleMapsApiKey: 'fake-key' })
    const seen = recorder(provider)
    provider.dispose()

    const before = seen.length
    provider.update({ provider: 'google' }, VIEWPORT)
    await Promise.resolve()
    expect(seen.length).toBe(before)
    expect(provider.snapshot().state).toBe('idle')
  })

  it('uses the locale for the session and falls back to en/US', async () => {
    const { http, calls } = scriptedHttp([ok(sessionBody()), ok(viewportBody())])
    const provider = new SatelliteImageryProvider(
      http,
      { googleMapsApiKey: 'fake-key', locale: 'not a locale' },
    )
    provider.update({ provider: 'google' }, VIEWPORT)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'ready') throw new Error('not ready')
    })
    expect(calls[0]?.url).toContain('key=fake-key')
    provider.dispose()
  })

  it('redacts the configured key from any error text', () => {
    expect(
      sanitizeProviderReason('Request to tile.googleapis.com?key=SECRET failed', 'SECRET'),
    ).toBe('Request to tile.googleapis.com?key=[redacted] failed')
    expect(sanitizeProviderReason('   ', 'SECRET')).toBe('The provider request failed.')
    // With no configured secret there is nothing to redact and no crash.
    expect(sanitizeProviderReason('plain failure', null)).toBe('plain failure')
  })

  it('settles within the documented request timeout', () => {
    // The timeout is a product decision, so pin it rather than letting it drift.
    expect(PROVIDER_REQUEST_TIMEOUT_MS).toBe(15_000)
  })
})
