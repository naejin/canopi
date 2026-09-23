import type { BasemapStyle } from '../generated/contracts'
import {
  GOOGLE_KEY_PROMPT,
  resolveBasemapAvailability,
  type BasemapDescriptor,
  type BasemapProviderConfig,
} from './basemap-provider'
import type { BasemapTileAuth } from './basemap-tile-auth'

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
      /**
       * Nothing. The live session token and key are published separately, into
       * the map's tile transport, so they can never be persisted, exported or
       * logged as part of a provider state.
       */
    }
  | { readonly state: 'unavailable'; readonly style: BasemapStyle; readonly reason: string }

/** The fixed retry/timeout policy the product contract settles. */
export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000
export const PROVIDER_MAX_RETRIES = 2
export const PROVIDER_RETRY_BACKOFF_MS = [1_000, 2_000] as const
/** Renew an official session within this window of its expiry. */
export const PROVIDER_SESSION_RENEWAL_WINDOW_MS = 60_000
/** The longest single timer any runtime reliably supports, in milliseconds. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

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

export class BasemapProvider {
  private generation = 0
  private disposed = false
  private state: BasemapProviderState = { state: 'idle' }
  private listeners = new Set<(state: BasemapProviderState) => void>()
  private controller: AbortController | null = null
  private session: GoogleSession | null = null
  private lastViewport: BasemapViewport | null = null
  /**
   * The newest viewport the caller wants served, even while a request is in
   * flight. One active request plus one latest desired viewport: a newer
   * viewport supersedes the older request/result rather than queueing.
   */
  private latestDesiredViewport: BasemapViewport | null = null
  /**
   * Viewport refresh in flight for one generation.
   *
   * Sessions need no equivalent bookkeeping: `update()` advances the
   * generation and aborts the controller, so a superseded session attempt can
   * neither publish nor install itself, and at most one attempt per generation
   * can reach the publish point.
   */
  private viewportInFlight: { readonly generation: number; readonly viewport: BasemapViewport } | null = null
  /** Validated viewport metadata for the current generation, when established. */
  private viewportMetadata: BasemapViewportMetadata | null = null
  /** The descriptor as resolved before any viewport zoom clamp. */
  private baseDescriptor: BasemapDescriptor | null = null
  /**
   * Identity of the configuration the live session was acquired under.
   *
   * A key or locale change is a different credential/session identity: the old
   * session, viewport facts, credentials and renewal must not survive it.
   */
  private configIdentity: string | null = null

  private renewalTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly http: BasemapProviderHttp,
    /**
     * The configuration, or a getter for it.
     *
     * A getter is how a device-local key or a locale change reaches a provider
     * that is already serving a live map: `update()` re-reads it, so no caller
     * has to capture the key at map-creation time and go stale.
     */
    private readonly config: BasemapProviderConfig | (() => BasemapProviderConfig),
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    /**
     * Where the live credential is published, when the surface has a tile
     * transport. Absent for a caller that never renders tiles.
     */
    private readonly credentials: BasemapTileAuth | null = null,
  ) {}

  /** The configuration in force for this call. */
  private currentConfig(): BasemapProviderConfig {
    return typeof this.config === 'function' ? this.config() : this.config
  }

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
   * A configuration identity change also drops incompatible session, viewport
   * facts, credentials and renewal before the new session is acquired.
   */
  update(presentation: { readonly style: BasemapStyle }, viewport: BasemapViewport): void {
    if (this.disposed) return
    this.generation += 1
    const generation = this.generation
    this.controller?.abort()
    this.controller = new AbortController()
    this.lastViewport = viewport
    this.latestDesiredViewport = viewport
    this.viewportInFlight = null
    this.clearRenewal()

    const config = this.currentConfig()
    const nextIdentity = this.configIdentityOf(config)
    const configChanged = this.configIdentity !== nextIdentity
    if (configChanged) {
      this.session = null
      this.credentials?.clear()
      this.viewportMetadata = null
    }
    this.configIdentity = nextIdentity

    const resolved = resolveBasemapAvailability(presentation.style, config)
    if (resolved.state === 'unavailable') {
      this.session = null
      this.credentials?.clear()
      this.viewportMetadata = null
      this.baseDescriptor = null
      // A style change or a cleared key must not leave the previous provider's
      // session usable by an in-flight map request.
      this.publish({ state: 'unavailable', style: presentation.style, reason: resolved.reason })
      return
    }

    this.baseDescriptor = resolved.descriptor

    if (!resolved.descriptor.official) {
      // Street, MapTiler and the keyless Google path need no session and no
      // viewport metadata, so there is no loading state to show and no request.
      this.session = null
      this.credentials?.clear()
      this.viewportMetadata = null
      this.publish({
        state: 'ready',
        descriptor: resolved.descriptor,
        copyright: null,
      })
      return
    }

    // An official generation needs a live session *and* validated viewport
    // metadata before imagery is Ready. A session that still matches this
    // configuration may be reused; otherwise it is re-acquired.
    const existing = this.session
    if (existing && existing.expiresAtMs - this.now() > PROVIDER_SESSION_RENEWAL_WINDOW_MS) {
      this.publish({ state: 'loading', style: presentation.style })
      void this.refreshViewport(generation, viewport)
      return
    }

    this.publish({ state: 'loading', style: presentation.style })
    void this.acquireSession(generation, resolved.descriptor)
  }

  /**
   * Adopt a settled viewport without restarting the provider generation.
   *
   * A session is not per-viewport, so moving the map refreshes the viewport
   * metadata in place: aborting and re-acquiring the session on every pan would
   * cost a request per movement and blank the imagery while it completed.
   * Only the latest desired viewport is kept; an older in-flight result is
   * discarded and the latest is requested immediately.
   */
  updateViewport(viewport: BasemapViewport): void {
    if (this.disposed) return
    this.lastViewport = viewport
    this.latestDesiredViewport = viewport
    if (!this.session) return
    // Same settled viewport need not refetch when metadata is already valid.
    if (
      this.viewportMetadata !== null &&
      this.viewportInFlight === null &&
      this.lastPublishedViewport &&
      sameViewport(this.lastPublishedViewport, viewport)
    ) {
      return
    }
    void this.refreshViewport(this.generation, viewport)
  }

  /** Release every request, timer and listener this provider owns. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.controller?.abort()
    this.controller = null
    this.clearRenewal()
    this.listeners.clear()
    this.session = null
    // The map's transport must stop carrying a credential the moment its owner
    // stops serving that provider.
    this.credentials?.clear()
    this.viewportInFlight = null
    this.latestDesiredViewport = null
    this.viewportMetadata = null
    this.baseDescriptor = null
    this.configIdentity = null
    this.state = { state: 'idle' }
  }

  /** Stable identity for the credential/session-relevant configuration. */
  private configIdentityOf(config: BasemapProviderConfig): string {
    return JSON.stringify({
      key: config.googleMapsApiKey?.trim() ?? '',
      locale: config.locale ?? '',
    })
  }

  /** The viewport last published as current metadata, when one was published. */
  private lastPublishedViewport: BasemapViewport | null = null

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
    const key = this.currentConfig().googleMapsApiKey?.trim() ?? ''
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
      this.credentials?.clear()
      this.viewportMetadata = null
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
    // Official imagery stays withheld until validated viewport metadata also
    // arrives. Credentials are installed so the tile transport is ready, but
    // the contribution is not published Ready yet.
    this.installCredentials(session)
    this.scheduleRenewal(generation, session, descriptor)
    if (this.lastViewport) void this.refreshViewport(generation, this.lastViewport)
  }

  /** Hand the live session to the map's transport, when the surface has one. */
  private installCredentials(session: GoogleSession): void {
    if (!this.credentials) return
    const key = this.currentConfig().googleMapsApiKey?.trim() ?? ''
    if (!key) return
    this.credentials.set({ sessionToken: session.sessionToken, apiKey: key })
  }

  /**
   * The descriptor for a live session: the session's own tile size, the
   * validated viewport copyright and the zoom the current viewport metadata
   * actually permits, always computed against the base descriptor so
   * availability can increase and decrease.
   */
  private descriptorForSession(
    descriptor: BasemapDescriptor,
    session: GoogleSession,
  ): BasemapDescriptor {
    const metadataZoom = this.viewportMetadata?.maxZoom
    const copyright = this.viewportMetadata?.copyright
    return {
      ...descriptor,
      tiles: [...descriptor.tiles],
      tileSize: session.tileWidth,
      attribution: copyright ?? descriptor.attribution,
      maxzoom: Math.min(
        descriptor.maxzoom,
        typeof metadataZoom === 'number' && Number.isFinite(metadataZoom)
          ? metadataZoom
          : descriptor.maxzoom,
      ),
    }
  }

  /** Publish Ready only when session and validated viewport metadata agree. */
  private publishOfficialReady(generation: number, descriptor: BasemapDescriptor): void {
    if (!this.isCurrent(generation)) return
    const session = this.session
    const metadata = this.viewportMetadata
    if (!session || !metadata) return
    this.installCredentials(session)
    this.publish({
      state: 'ready',
      descriptor: this.descriptorForSession(descriptor, session),
      copyright: metadata.copyright,
    })
    this.scheduleRenewal(generation, session, descriptor)
  }

  /**
   * Renew a session before it expires.
   *
   * Scheduling is part of the session's own lifetime: a session that expired
   * while the map was idle would leave the transport authenticating with a dead
   * token, so the renewal starts inside the renewal window and publishes
   * `loading` while it runs, which withdraws the tiles a dead token would fail.
   */
  private scheduleRenewal(
    generation: number,
    session: GoogleSession,
    descriptor: BasemapDescriptor,
  ): void {
    this.clearRenewal()
    const remaining = session.expiresAtMs - this.now() - PROVIDER_SESSION_RENEWAL_WINDOW_MS
    // A session far in the future cannot be waited for in one timer: the delay
    // would exceed the platform's timer range, so a bounded wait is armed and
    // re-armed until the renewal window is actually reached.
    const delay = Math.max(1_000, Math.min(remaining, MAX_TIMER_DELAY_MS))
    this.renewalTimer = setTimeout(() => {
      this.renewalTimer = null
      if (!this.isCurrent(generation)) return
      if (session.expiresAtMs - this.now() > PROVIDER_SESSION_RENEWAL_WINDOW_MS) {
        this.scheduleRenewal(generation, session, descriptor)
        return
      }
      this.session = null
      this.credentials?.clear()
      this.publish({ state: 'loading', style: descriptor.style })
      void this.acquireSession(generation, descriptor)
    }, delay)
  }

  private clearRenewal(): void {
    if (this.renewalTimer !== null) {
      clearTimeout(this.renewalTimer)
      this.renewalTimer = null
    }
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
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) return null
    const tileWidth = Number(body.tileWidth)
    const tileHeight = Number(body.tileHeight)
    return {
      sessionToken,
      tileWidth: Number.isFinite(tileWidth) && tileWidth > 0 ? tileWidth : 256,
      tileHeight: Number.isFinite(tileHeight) && tileHeight > 0 ? tileHeight : 256,
      expiresAtMs: readSessionExpiryMs(body.expiry, this.now()),
    }
  }

  /**
   * Viewport copyright and zoom availability, refreshed on settled viewport
   * changes.
   *
   * The documented viewport request is authenticated with the session **and**
   * the API key, so both are sent. A refused or malformed answer becomes an
   * actionable unavailable state rather than leaving the previous attribution
   * in place as if it still described what is on screen. A later valid request
   * for a distinct settled viewport (or an explicit retry) may recover.
   */
  private async refreshViewport(
    generation: number,
    viewport: BasemapViewport,
  ): Promise<void> {
    if (this.viewportInFlight && this.viewportInFlight.generation === generation) {
      // Keep only the latest desired viewport; the in-flight request will be
      // superseded when it settles if it is no longer the latest.
      this.latestDesiredViewport = viewport
      return
    }
    const session = this.session
    const key = this.currentConfig().googleMapsApiKey?.trim() ?? ''
    if (!session || !key) return
    this.latestDesiredViewport = viewport
    this.viewportInFlight = { generation, viewport }
    const url =
      `https://tile.googleapis.com/v1/viewport?session=${encodeURIComponent(session.sessionToken)}` +
      `&key=${encodeURIComponent(key)}` +
      `&zoom=${viewport.zoom}&north=${viewport.north}&south=${viewport.south}` +
      `&east=${viewport.east}&west=${viewport.west}`
    let response: BasemapProviderResponse | null = null
    try {
      response = await this.requestWithRetry(generation, url, { method: 'GET' })
    } catch {
      response = null
    }
    if (!this.isCurrent(generation)) return
    this.viewportInFlight = null

    // A newer viewport arrived while this request was running: discard this
    // result without publishing and immediately request the latest.
    const latest = this.latestDesiredViewport
    if (latest && !sameViewport(latest, viewport)) {
      void this.refreshViewport(generation, latest)
      return
    }

    if (!response || !response.ok) {
      this.failViewportMetadata(generation, key, response)
      return
    }
    const metadata = readViewportMetadata(response.json, viewport)
    if (metadata === null) {
      this.failViewportMetadata(generation, key, response)
      return
    }
    this.viewportMetadata = metadata
    this.lastPublishedViewport = viewport
    const descriptor = this.baseDescriptor
    if (!descriptor) return
    this.publishOfficialReady(generation, descriptor)
  }

  /**
   * Report viewport metadata that could not be established.
   *
   * Official imagery is not shown without usable viewport attribution and
   * availability, so a failed metadata request is an unavailable provider with
   * an actionable reason — not a ready provider with a stale credit line. The
   * transport credential is cleared so stale tokens cannot authenticate tiles.
   * A later valid request may recover through the same bounded policy.
   */
  private failViewportMetadata(
    generation: number,
    key: string,
    response: BasemapProviderResponse | null,
  ): void {
    if (!this.isCurrent(generation)) return
    this.credentials?.clear()
    this.viewportMetadata = null
    this.clearRenewal()
    this.publish({
      state: 'unavailable',
      style: styleOf(this.state),
      reason: sanitizeProviderReason(
        response && response.status !== 0
          ? `Google Maps could not confirm the viewport for this layer (HTTP ${response.status}). Try again or choose another basemap.`
          : 'Google Maps viewport metadata is unavailable. Try again or choose another basemap.',
        key,
      ),
    })
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
    const locale = this.currentConfig().locale?.trim()
    return locale && /^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale) ? locale : 'en'
  }

  /** A validated region, defaulting to `US` as the contract specifies. */
  private sessionRegion(): string {
    const locale = this.currentConfig().locale ?? ''
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

/**
 * A session's expiry in milliseconds.
 *
 * The documented `createSession` response carries `expiry` as an
 * **epoch-seconds string**, so a numeric-only parse would silently discard a
 * real expiry and fall back to a guessed lifetime. Both forms are accepted, and
 * a malformed value falls back to the conservative default rather than to a
 * session that never renews.
 */
export function readSessionExpiryMs(expiry: unknown, nowMs: number): number {
  const raw =
    typeof expiry === 'string' ? Number(expiry.trim())
    : typeof expiry === 'number' ? expiry
    : Number.NaN
  if (!Number.isFinite(raw) || raw <= 0) {
    return nowMs + PROVIDER_SESSION_RENEWAL_WINDOW_MS * 2
  }
  // A value that is implausibly small cannot be epoch seconds; treat it as a
  // relative lifetime in seconds so a shortened response is still honoured.
  const seconds = raw > 1_000_000_000 ? raw : raw
  return seconds * 1000
}

/** The style a published state belongs to, whichever shape it has. */
function styleOf(state: BasemapProviderState): BasemapStyle {
  if (state.state === 'ready') return state.descriptor.style
  if (state.state === 'idle') return 'street'
  return state.style
}

/** The attribution and zoom availability one viewport answer supplies. */
export interface BasemapViewportMetadata {
  readonly copyright: string | null
  readonly maxZoom: number
}

/**
 * Read the documented viewport response.
 *
 * `maxZoomRects` describes availability over sub-rectangles of the request.
 * Overlapping rectangles offer the greatest supported zoom at a point; the
 * source-wide ceiling cannot exceed the least such availability across the
 * requested viewport, respecting wrapped longitudes. Uncovered or unsupported
 * metadata is unavailable, not an invented zoom. Empty objects and answers
 * without finite applicable availability or a copyright are not established
 * metadata.
 */
export function readViewportMetadata(
  json: unknown,
  viewport: BasemapViewport,
  fallbackMaxZoom = 22,
): BasemapViewportMetadata | null {
  if (!isRecord(json)) return null
  const copyright =
    typeof json.copyright === 'string' && json.copyright.length > 0 ? json.copyright : null
  const rects = Array.isArray(json.maxZoomRects) ? json.maxZoomRects : []
  const parsed: Array<{ north: number; south: number; east: number; west: number; maxZoom: number }> = []
  for (const rect of rects) {
    if (!isRecord(rect)) continue
    const value = Number(rect.maxZoom)
    if (!Number.isFinite(value) || value <= 0) continue
    const north = Number(rect.north)
    const south = Number(rect.south)
    const east = Number(rect.east)
    const west = Number(rect.west)
    if (
      !Number.isFinite(north) || !Number.isFinite(south)
      || !Number.isFinite(east) || !Number.isFinite(west)
    ) {
      continue
    }
    parsed.push({ north, south, east, west, maxZoom: value })
  }
  if (parsed.length === 0) {
    // `{}` or a response with no applicable rectangles is not established
    // metadata, even if a fallback zoom would otherwise be available.
    return null
  }
  // Sample the requested viewport so support is required across it, not only
  // at the centre. Corners plus the centre catch the common thin-coverage case;
  // wrapped longitudes are normalised into the rectangles' own frame.
  const samples: Array<{ lat: number; lon: number }> = [
    { lat: viewport.south, lon: viewport.west },
    { lat: viewport.south, lon: viewport.east },
    { lat: viewport.north, lon: viewport.west },
    { lat: viewport.north, lon: viewport.east },
    { lat: (viewport.south + viewport.north) / 2, lon: (viewport.west + viewport.east) / 2 },
  ]
  let ceiling: number | null = null
  for (const sample of samples) {
    // At a point, overlapping rectangles offer the greatest supported zoom.
    let pointZoom: number | null = null
    for (const rect of parsed) {
      if (!rectContains(rect, sample.lat, sample.lon)) continue
      pointZoom = pointZoom === null ? rect.maxZoom : Math.max(pointZoom, rect.maxZoom)
    }
    if (pointZoom === null) return null
    // The source-wide ceiling cannot exceed the least such availability.
    ceiling = ceiling === null ? pointZoom : Math.min(ceiling, pointZoom)
  }
  if (ceiling === null) return null
  // Missing or malformed copyright is not established metadata for an official
  // viewport answer that must carry attribution.
  if (copyright === null) return null
  return {
    copyright,
    maxZoom: Math.min(ceiling, fallbackMaxZoom),
  }
}

function rectContains(
  rect: { north: number; south: number; east: number; west: number },
  lat: number,
  lon: number,
): boolean {
  if (lat > rect.north || lat < rect.south) return false
  // Respect wrapped longitudes: a rectangle may span the antimeridian.
  if (rect.west <= rect.east) {
    return lon >= rect.west && lon <= rect.east
  }
  return lon >= rect.west || lon <= rect.east
}

function sameViewport(a: BasemapViewport, b: BasemapViewport): boolean {
  return (
    a.west === b.west &&
    a.south === b.south &&
    a.east === b.east &&
    a.north === b.north &&
    a.zoom === b.zoom
  )
}

export { GOOGLE_KEY_PROMPT }
