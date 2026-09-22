import type {
  BasemapProviderHttp,
  BasemapProviderResponse,
} from '../maplibre/basemap-provider-session'

/** Longest response body the provider will read, in bytes. */
export const BASEMAP_HTTP_MAX_BODY_BYTES = 256 * 1024

/**
 * The bounded browser HTTP capability the basemap provider is given.
 *
 * It is deliberately narrow: the provider supplies a fixed endpoint and an
 * `AbortSignal`, and this adapter adds the transport rules the product contract
 * requires — a bounded response body, JSON-only body reading, `Retry-After`
 * extraction, and errors that carry no request URL. A provider error must never
 * be able to echo a configured API key into a console, a diagnostic sink or the
 * UI, and the key travels in the URL.
 */
export function createBrowserBasemapHttp(
  fetchImpl: typeof fetch = globalThis.fetch,
): BasemapProviderHttp {
  return {
    async request(input): Promise<BasemapProviderResponse> {
      let response: Response
      try {
        response = await fetchImpl(input.url, {
          method: input.method ?? 'GET',
          signal: input.signal,
          headers:
            input.method === 'POST'
              ? { 'Content-Type': 'application/json' }
              : undefined,
          body: input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
          // No ambient credentials: these are public tile endpoints and sending
          // cookies would widen the request beyond what the provider needs.
          credentials: 'omit',
          mode: 'cors',
          redirect: 'follow',
        })
      } catch {
        // The throw is swallowed rather than re-thrown with its cause, because
        // a fetch failure message can contain the full request URL and with it
        // the API key. A status of 0 is the provider's "transport failure".
        return { ok: false, status: 0, json: null }
      }

      const retryAfterSeconds = readRetryAfter(response.headers)
      let json: unknown = null
      if (response.ok) {
        json = await readBoundedJson(response)
      }
      return {
        ok: response.ok,
        status: response.status,
        json,
        retryAfterSeconds,
      }
    },
  }
}

/** `Retry-After` as seconds, accepting the HTTP-date form too. */
function readRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(raw)
  if (!Number.isFinite(date)) return null
  const delta = (date - Date.now()) / 1000
  return delta > 0 ? delta : 0
}

/**
 * Read a response body only when it is JSON, and only up to the cap.
 *
 * A non-JSON or oversized body is reported as `null` rather than being parsed
 * or buffered whole, so a misbehaving endpoint cannot make the provider hold
 * unbounded data.
 */
async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) return null
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > BASEMAP_HTTP_MAX_BODY_BYTES) return null
  let text: string
  try {
    text = await response.text()
  } catch {
    return null
  }
  if (text.length > BASEMAP_HTTP_MAX_BODY_BYTES) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
