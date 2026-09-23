import type { BasemapProvider, BasemapProviderState } from './basemap-provider-session'
import { BasemapProvider as Provider } from './basemap-provider-session'
import { createBrowserBasemapHttp } from './basemap-http.browser'
import { BasemapTileAuth } from './basemap-tile-auth'
import { googleMapsApiKey } from '../app/settings/state'
import {
  reconcileBasemapContribution,
  setBasemapContributionVisibility,
  type BasemapReconcileTarget,
} from './basemap-contribution'

/**
 * Wire a live provider to a live map.
 *
 * The provider owns the session, the viewport requests and the retry policy; the
 * map owns its camera, its scene and every other layer. This binding is the only
 * place they meet, and it deliberately does exactly two things: apply the
 * provider's published state to the basemap source and layer once the style can
 * accept it, and apply visibility. It never calls `setStyle()` and never
 * recreates the map, which is what lets a provider switch, a key change or a
 * re-issued session happen mid-edit without disturbing the camera, the scene
 * runtime, or placement.
 *
 * Callers pass a map that already carries a basemap — from the style the map was
 * created with — so the binding adopts that contribution rather than duplicating
 * it.
 */

/**
 * Whether a mounted map can accept a source and layer yet.
 *
 * MapLibre loads even an inline JSON style asynchronously, and `addSource`
 * throws `Style is not done loading.` before that finishes. A ready keyless
 * provider would therefore break map initialization if the contribution were
 * applied straight from `onCreate`, so the binding waits for this.
 */
export interface BasemapStyleReadiness {
  isReady(): boolean
  /** Register a one-shot style-ready callback on the map's lifetime. */
  whenReady(listener: () => void): void
}

export interface BasemapBindingDeps {
  readonly provider: BasemapProvider
  readonly map: BasemapReconcileTarget
  /** Relative cost of one zoom level at this map's projection; a raster
   * contribution is a single source, so this is constant. */
  readonly maxzoomFallback?: number
  /** Visibility of the basemap layer, independent of which provider is live. */
  readonly visible?: () => boolean
  /**
   * The map's credential owner, when the map was created with a request
   * transform. Without it an official provider has nothing to authenticate its
   * tiles and the binding withholds the contribution rather than requesting an
   * unresolved `{session}` template.
   */
  readonly tileAuth?: BasemapTileAuth
  /** When absent the contribution is applied immediately, which is correct for
   * a map stub with no asynchronous style load. */
  readonly styleReady?: BasemapStyleReadiness
  /** Where the raster layer belongs in the target's own stack. */
  readonly beforeLayerId?: () => string | null
  /**
   * Run after the contribution and visibility are applied.
   *
   * A map that keeps its own paint state on the basemap layer — opacity, for
   * one — needs it re-applied whenever the contribution is replaced, and only
   * then, so it is not applied twice for one published state.
   */
  readonly afterApply?: () => void
}

/** Install the binding and return its disposer. */
export function bindBasemapProvider(deps: BasemapBindingDeps): () => void {
  const { provider, map, tileAuth } = deps
  const visible = deps.visible ?? (() => true)
  let disposed = false
  let pending: BasemapProviderState | null = null

  const apply = (state: BasemapProviderState): void => {
    // The latest state always wins: a state that arrives while the style is
    // still loading is what gets applied when it finishes, not the one that
    // happened to arrive first.
    pending = state
    if (deps.styleReady && !deps.styleReady.isReady()) return
    pending = null
    reconcileBasemapContribution(map, state, {
      officialTilesResolvable: tileAuth?.installed === true,
      ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
    })
    // Visibility is applied after the contribution so a provider that has just
    // published does not briefly show imagery the user has hidden.
    setBasemapContributionVisibility(map, visible())
    deps.afterApply?.()
  }

  // Adopt whatever the provider already published. Without this a map created
  // after the provider resolved would show no basemap until the next change.
  apply(provider.snapshot())

  const unsubscribe = provider.subscribe(apply)
  if (deps.styleReady && !deps.styleReady.isReady()) {
    deps.styleReady.whenReady(() => {
      if (disposed) return
      const state = pending ?? provider.snapshot()
      pending = null
      reconcileBasemapContribution(map, state, {
        officialTilesResolvable: tileAuth?.installed === true,
        ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
      })
      setBasemapContributionVisibility(map, visible())
      deps.afterApply?.()
    })
  }

  return () => {
    disposed = true
    pending = null
    unsubscribe()
    // The credential belongs to the surface that installed it: a removed map
    // must not leave a live session token in a shared transport.
    tileAuth?.clear()
  }
}

/**
 * Re-apply visibility alone.
 *
 * Hiding the basemap must not disturb the provider session or re-request tiles,
 * so this touches only the layer's layout property.
 */
export function applyBasemapVisibility(
  map: BasemapReconcileTarget,
  visible: boolean,
): void {
  setBasemapContributionVisibility(map, visible)
}

/**
 * Create the provider the live map should use.
 *
 * The provider is a per-map-lifetime resource: session and viewport requests
 * belong to the active provider generation *and* the map lifetime, so a map
 * creates its own and disposes it with the map rather than a module-level
 * singleton outliving the surface that owns it.
 *
 * The configuration is supplied as a getter rather than as values, so a
 * device-local key or a locale change reaches a provider that is already
 * serving a live map: `update()` re-reads it, and no caller has to capture the
 * key at map-creation time and go stale.
 */
export function createBasemapProvider(
  tileAuth: BasemapTileAuth | null = null,
): BasemapProvider {
  return new Provider(
    createBrowserBasemapHttp(),
    () => ({
      mapTilerKey: import.meta.env.VITE_MAPTILER_KEY,
      googleMapsApiKey: googleMapsApiKey.value,
    }),
    () => Date.now(),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tileAuth,
  )
}

/**
 * Read style readiness from a live map and its lifetime.
 *
 * `isStyleLoaded` is the precise answer and `loaded` is the conservative
 * fallback; a map that exposes neither is treated as ready so a stub map with
 * no asynchronous style load is not blocked forever.
 */
export function mapStyleReadiness(
  map: { isStyleLoaded?(): boolean; loaded?(): boolean },
  lifetime: { on(type: string, listener: (event?: unknown) => void): void },
): BasemapStyleReadiness {
  const read = (): boolean | null => {
    for (const probe of [map.isStyleLoaded, map.loaded]) {
      if (typeof probe !== 'function') continue
      try {
        return probe.call(map)
      } catch {
        return false
      }
    }
    return null
  }
  return {
    isReady: () => read() ?? true,
    whenReady: (listener) => {
      lifetime.on('load', listener)
      lifetime.on('style.load', listener)
    },
  }
}
