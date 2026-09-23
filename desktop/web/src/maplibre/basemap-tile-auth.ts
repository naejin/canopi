/**
 * The ephemeral credential the official Google tile path needs.
 *
 * A session token is per-generation and expires, so it cannot live in a
 * published source descriptor: the descriptor is a stable, non-secret template
 * and this owner supplies the live token and API key at request time through
 * MapLibre's request transformation seam.
 *
 * The scope is deliberately one fixed endpoint. This is not a proxy and not a
 * general credential injector: a URL that is not the official Google 2D tile
 * path is returned untouched, so a caller-supplied or third-party URL can never
 * receive the key.
 */

/** The only endpoint this transport authenticates. */
export const GOOGLE_OFFICIAL_TILE_ENDPOINT = 'https://tile.googleapis.com/v1/2dtiles/'

/** The placeholder a published descriptor carries instead of a live token. */
export const GOOGLE_SESSION_PLACEHOLDER = '{session}'

export interface BasemapTileCredentials {
  readonly sessionToken: string
  readonly apiKey: string
}

/** Whether a URL addresses the fixed official tile endpoint. */
export function isOfficialGoogleTileUrl(url: string): boolean {
  return url.startsWith(GOOGLE_OFFICIAL_TILE_ENDPOINT)
}

/**
 * Whether a tile template still carries the unresolved session placeholder.
 *
 * A descriptor that reaches a map in this state would request a literal
 * `{session}` and fail every tile, so callers refuse it rather than publishing
 * a source they cannot serve.
 */
export function hasUnresolvedSession(url: string): boolean {
  return isOfficialGoogleTileUrl(url) && url.includes(GOOGLE_SESSION_PLACEHOLDER)
}

/**
 * One map lifetime's worth of official tile credentials.
 *
 * Owned by the map, not by the provider and not by a module: the provider
 * publishes into it while it is live and clears it when it is disposed, so a
 * torn-down surface cannot keep authenticating requests.
 */
export class BasemapTileAuth {
  private credentials: BasemapTileCredentials | null = null

  set(credentials: BasemapTileCredentials | null): void {
    this.credentials = credentials
  }

  clear(): void {
    this.credentials = null
  }

  /** Whether a live credential is installed. */
  get installed(): boolean {
    return this.credentials !== null
  }

  /**
   * Authenticate one outgoing request URL.
   *
   * The session placeholder is replaced and the key appended, in that order,
   * for the fixed official endpoint only. Without a credential the template is
   * returned unchanged: the caller has already withdrawn the contribution, and
   * a request that slips through fails on Google's side rather than silently
   * addressing a different service.
   */
  authorize(url: string): string {
    if (!isOfficialGoogleTileUrl(url)) return url
    const credentials = this.credentials
    if (!credentials) return url
    const withSession = url.includes(GOOGLE_SESSION_PLACEHOLDER)
      ? url.split(GOOGLE_SESSION_PLACEHOLDER).join(encodeURIComponent(credentials.sessionToken))
      : url
    const separator = withSession.includes('?') ? '&' : '?'
    return `${withSession}${separator}key=${encodeURIComponent(credentials.apiKey)}`
  }

  /**
   * The request transformation MapLibre calls for every resource it fetches.
   *
   * Bound as a function rather than a method so a map can be handed
   * `tileAuth.transformRequest` directly.
   */
  readonly transformRequest = (url: string): { url: string } => ({ url: this.authorize(url) })
}
