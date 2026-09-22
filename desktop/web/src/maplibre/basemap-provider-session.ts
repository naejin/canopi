import type { BasemapStyle } from '../generated/contracts'
import {
  GOOGLE_KEY_PROMPT,
  resolveBasemapAvailability,
  type BasemapDescriptor,
  type BasemapProviderConfig,
} from './basemap-provider'

/**
 * One active basemap provider generation.
 *
 * The module above decides *what* a style maps to; this owns the lifecycle of
 * getting there. It is deliberately separate from any map: a provider
 * generation is bound to the map surface that admitted it, owns its own
 * requests and timers, and is fenced so a superseded generation cannot publish
 * a session, an attribution string, a descriptor or an error over the current
 * one.
 *
 * It performs no map mutation at all. A caller reacts to published state through
 * the existing contribution reconciliation, which is what keeps a provider or
 * key change from needing `setStyle()` or a new map.
 */

/** The bounded HTTP capability the provider is given, injected per edition. */
export interface BasemapProviderHttp {
  /**
   * Perform one request. `signal` must abort the underlying work. The provider
   * always supplies a finite timeout, so an implementation that ignores the
   * signal still cannot hang the caller indefinitely.
   */
  request(input: {
    readonly url: string
    readonly signal: AbortSignal
    /** Defaults to GET. */
    readonly method?: 'GET' | 'POST'
    /** JSON body for a POST; the adapter serialises it. */
    readonly body?: unknown
  }): Promise<BasemapProviderResponse>
}

export interface BasemapProviderResponse {
  readonly ok: boolean
  readonly status: number
  /** Parsed JSON body, or `null` when the body is absent or not JSON. */
  readonly json: unknown
  /** `Retry-After` in seconds when the response carried one. */
  readonly retryAfterSeconds?: number | null
}

/** The viewport a caller asks the provider to serve. */
export interface BasemapViewport {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
  readonly zoom: number
}

export type BasemapProviderState =
  | { readonly state: 'idle' }
  | { readonly state: 'loading'; readonly style: BasemapStyle }
  | {
      readonly state: 'ready'
      readonly descriptor: BasemapDescriptor
      /** Viewport copyright, when the provider supplies and requires one. */
      readonly copyright: string | null
    }
  | { readonly state: 'unavailable'; readonly style: BasemapStyle; readonly reason: string }

/** The fixed retry/timeout policy the product contract settles. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000
export const PROVIDER_MAX_RETRIES = 2
export const PROVIDER_RETRY_BACKOFF_MS = [1_000, 2_000] as const
/** Renew an official session within this window of its expiry. */
export const PROVIDER_SESSION_RENEWAL_WINDOW_MS = 60_000

interface GoogleSession {
  /**
   * Live session token. Held in memory on this provider only: it is never
   * returned to a caller, so it cannot be persisted, logged or exported, and it
   * expires.
   */
  readonly sessionToken: string
  readonly tileWidth: number
  readonly tileHeight: number
  readonly expiresAtMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Errors are sanitised before they can reach a console, a diagnostic sink or
 * the UI: a provider error must never carry the configured key back out.
 */
export function sanitizeProviderReason(text: string, secret: string | null): string {
  const trimmed = text.trim()
  const withoutSecret = secret
    ? trimmed.split(secret).join('[redacted]')
    : trimmed
  return withoutSecret.length > 0 ? withoutSecret : 'The provider request failed.'
}

/** One session/viewport answer, fenced by generation. */
interface Pending<T> {
  readonly generation: number
  readonly promise: Promise<T>
}

export class BasemapProvider {
  private generation = 0
  private disposed = false
  private state: BasemapProviderState = { state: 'idle' }
  private listeners = new Set<(state: BasemapProviderState) => void>()
  private controller: AbortController | null = null
  private session: GoogleSession | null = null
  private lastViewport: BasemapViewport | null = null
  /**
   * Viewport refresh in flight for one generation.
   *
   * Sessions need no equivalent bookkeeping: `update()` advances the
   * generation and aborts the controller, so a superseded session attempt can
   * neither publish nor install itself, and at most one attempt per generation
   * can reach the publish point.
   */
  private viewportInFlight: Pending<string | null> | null = null

  constructor(
    private readonly http: BasemapProviderHttp,
    private readonly config: BasemapProviderConfig,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** The current published state. */
  snapshot(): BasemapProviderState {
    return this.state
  }

  /** Subscribe to state changes; the returned function removes the listener. */
  subscribe(listener: (state: BasemapProviderState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Adopt a presentation and viewport.
   *
   * Every call begins a new generation. Anything the previous generation had in
   * flight is aborted and can no longer publish, which is what makes a key
   * change, a provider switch or a fast sequence of viewport moves safe.
   */
  update(presentation: { readonly style: BasemapStyle }, viewport: BasemapViewport): void {
    if (this.disposed) return
    this.generation += 1
    const generation = this.generation
    this.controller?.abort()
    this.controller = new AbortController()
    this.lastViewport = viewport
    this.viewportInFlight = null

    const resolved = resolveBasemapAvailability(presentation.style, this.config)
    if (resolved.state === 'unavailable') {
      this.session = null
      this.publish({ state: 'unavailable', style: presentation.style, reason: resolved.reason })
      return
    }

    if (!resolved.descriptor.official) {
      // Street, MapTiler and the keyless Google path need no session, so there
      // is no loading state to show and no request to make.
      this.session = null
      this.publish({
        state: 'ready',
        descriptor: resolved.descriptor,
        copyright: null,
      })
      return
    }

    // An official generation needs a live session before it can render.
    const existing = this.session
    if (existing && existing.expiresAtMs - this.now() > PROVIDER_SESSION_RENEWAL_WINDOW_MS) {
      this.publish({
        state: 'ready',
        descriptor: {
          ...resolved.descriptor,
          tileSize: existing.tileWidth,
        },
        copyright: null,
      })
      void this.refreshViewport(generation, viewport)
      return
    }

    this.publish({ state: 'loading', style: presentation.style })
    void this.acquireSession(generation, resolved.descriptor)
  }

  /** Release every request, timer and listener this provider owns. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.controller?.abort()
    this.controller = null
    this.listeners.clear()
    this.session = null
    this.viewportInFlight = null
    this.state = { state: 'idle' }
  }

  private publish(state: BasemapProviderState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  /** Whether one answer still belongs to the generation that asked for it. */
  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation && this.controller !== null
  }

  private async acquireSession(
    generation: number,
    descriptor: BasemapDescriptor,
  ): Promise<void> {
    const key = this.config.googleMapsApiKey?.trim() ?? ''
    let session: GoogleSession | null = null
    try {
      session = await this.runSessionRequest(generation, key)
    } catch {
      session = null
    }
    if (!this.isCurrent(generation)) return
    if (session === null) {
      // An authentication failure requires user correction; it is reported as
      // an actionable provider error and never downgraded to keyless tiles,
      // because silently serving different imagery would misrepresent it.
      this.session = null
      this.publish({
        state: 'unavailable',
        style: descriptor.style,
        reason: sanitizeProviderReason(
          'Google Maps rejected the configured API key. Edit or clear the key to continue.',
          key,
        ),
      })
      return
    }
    this.session = session
    this.publish({
      state: 'ready',
      descriptor: { ...descriptor, tileSize: session.tileWidth },
      copyright: null,
    })
    if (this.lastViewport) void this.refreshViewport(generation, this.lastViewport)
  }

  /** One session request with the fixed retry policy, fenced by generation. */
  private async runSessionRequest(generation: number, key: string): Promise<GoogleSession | null> {
    const url = `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`
    const response = await this.requestWithRetry(generation, url, {
      method: 'POST',
      body: { mapType: 'satellite', language: this.sessionLocale(), region: this.sessionRegion() },
    })
    if (response === null) return null
    if (!response.ok) return null
    const body = response.json
    if (!isRecord(body)) return null
    const sessionToken = body.session
    const expiry = body.expiry
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) return null
    const tileWidth = Number(body.tileWidth)
    const tileHeight = Number(body.tileHeight)
    const expiresAtMs =
      typeof expiry === 'number' && Number.isFinite(expiry)
        ? expiry * 1000
        : this.now() + PROVIDER_SESSION_RENEWAL_WINDOW_MS * 2
    return {
      sessionToken,
      tileWidth: Number.isFinite(tileWidth) && tileWidth > 0 ? tileWidth : 256,
      tileHeight: Number.isFinite(tileHeight) && tileHeight > 0 ? tileHeight : 256,
      expiresAtMs,
    }
  }

  /** Viewport copyright, refreshed on settled viewport changes. */
  private async refreshViewport(
    generation: number,
    viewport: BasemapViewport,
  ): Promise<void> {
    if (this.viewportInFlight?.generation === generation) return
    // The viewport request carries the session token; the API key is not needed
    // again here, and not putting it in this URL keeps it out of one more place.
    const token = this.session?.sessionToken
    if (!token) return
    const url =
      `https://tile.googleapis.com/v1/viewport?session=${encodeURIComponent(token)}` +
      `&zoom=${viewport.zoom}&north=${viewport.north}&south=${viewport.south}` +
      `&east=${viewport.east}&west=${viewport.west}`
    const pending = this.requestWithRetry(generation, url, { method: 'GET' })
    this.viewportInFlight = { generation, promise: pending.then(() => null) }
    let response: BasemapProviderResponse | null = null
    try {
      response = await pending
    } catch {
      response = null
    }
    if (!this.isCurrent(generation)) return
    this.viewportInFlight = null
    const copyright = extractCopyright(response?.json)
    if (copyright === null) return
    if (this.state.state !== 'ready') return
    this.publish({ ...this.state, copyright })
  }

  /**
   * One bounded request with the contract's retry policy.
   *
   * Transient network, 429 and 5xx answers get at most two retries with
   * jittered backoff, and a longer `Retry-After` is honoured by reporting retry
   * availability rather than holding work indefinitely. Invalid credentials are
   * never retried. Returns `null` when the generation was superseded, so no
   * caller can act on a stale answer.
   */
  private async requestWithRetry(
    generation: number,
    url: string,
    options: { readonly method: 'GET' | 'POST'; readonly body?: unknown },
  ): Promise<BasemapProviderResponse | null> {
    for (let attempt = 0; attempt <= PROVIDER_MAX_RETRIES; attempt += 1) {
      if (!this.isCurrent(generation)) return null
      const controller = this.controller
      if (!controller) return null
      const timeout = new AbortController()
      const onAbort = () => timeout.abort()
      controller.signal.addEventListener('abort', onAbort)
      const timer = setTimeout(() => timeout.abort(), PROVIDER_REQUEST_TIMEOUT_MS)
      let response: BasemapProviderResponse
      try {
        response = await this.http.request(
          options.method === 'POST'
            ? { url, signal: timeout.signal, method: 'POST', body: options.body }
            : { url, signal: timeout.signal },
        )
      } catch {
        response = { ok: false, status: 0, json: null }
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', onAbort)
      }
      if (!this.isCurrent(generation)) return null
      if (response.ok) return response

      const retryable = response.status === 0 || response.status === 429 || response.status >= 500
      if (!retryable || attempt === PROVIDER_MAX_RETRIES) return response
      const retryAfter = response.retryAfterSeconds
      if (typeof retryAfter === 'number' && retryAfter * 1000 > PROVIDER_RETRY_BACKOFF_MS[attempt]!) {
        // A longer server-directed wait is reported rather than held, so the
        // caller can offer retry instead of appearing to hang.
        return response
      }
      await this.sleep(jittered(PROVIDER_RETRY_BACKOFF_MS[attempt]!, attempt))
      if (!this.isCurrent(generation)) return null
    }
    return null
  }

  /** The app's supported locale as an IETF tag, falling back to `en`. */
  private sessionLocale(): string {
    const locale = this.config.locale?.trim()
    return locale && /^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale) ? locale : 'en'
  }

  /** A validated region, defaulting to `US` as the contract specifies. */
  private sessionRegion(): string {
    const locale = this.config.locale ?? ''
    const region = locale.split('-')[1]
    return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : 'US'
  }
}

/** A bounded, deterministic jitter so retries do not synchronise. */
function jittered(baseMs: number, attempt: number): number {
  const spread = baseMs * 0.25
  // Deterministic per attempt: tests must not depend on wall-clock randomness,
  // and the spread still separates retries from one another.
  const offset = attempt % 2 === 0 ? spread / 2 : -spread / 2
  return Math.max(0, Math.round(baseMs + offset))
}

/** Pull the copyright string out of a viewport answer, when it has one. */
function extractCopyright(json: unknown): string | null {
  if (!isRecord(json)) return null
  const copyright = json.copyright
  return typeof copyright === 'string' && copyright.length > 0 ? copyright : null
}

export { GOOGLE_KEY_PROMPT }
