import type { BasemapProvider, BasemapProviderState } from './basemap-provider-session'
import { BasemapProvider as Provider } from './basemap-provider-session'
import { createBrowserBasemapHttp } from './basemap-http.browser'
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
 * provider's published state to the basemap source and layer, and apply
 * visibility. It never calls `setStyle()` and never recreates the map, which is
 * what lets a provider switch, a key change or a re-issued session happen
 * mid-edit without disturbing the camera, the scene runtime, or placement.
 *
 * Callers pass a map that already carries a basemap — from the style the map was
 * created with — so the binding adopts that contribution rather than duplicating
 * it.
 */
export interface BasemapBindingDeps {
  readonly provider: BasemapProvider
  readonly map: BasemapReconcileTarget
  /** Relative cost of one zoom level at this map's projection; a raster
   * contribution is a single source, so this is constant. */
  readonly maxzoomFallback?: number
  /** Visibility of the basemap layer, independent of which provider is live. */
  readonly visible?: () => boolean
}

/** Install the binding and return its disposer. */
export function bindBasemapProvider(deps: BasemapBindingDeps): () => void {
  const { provider, map } = deps
  const visible = deps.visible ?? (() => true)

  const apply = (state: BasemapProviderState): void => {
    reconcileBasemapContribution(map, state)
    // Visibility is applied after the contribution so a provider that has just
    // published does not briefly show imagery the user has hidden.
    setBasemapContributionVisibility(map, visible())
  }

  // Adopt whatever the provider already published. Without this a map created
  // after the provider resolved would show no basemap until the next change.
  apply(provider.snapshot())

  const unsubscribe = provider.subscribe(apply)
  return unsubscribe
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
 * singleton outliving the surface that owns it. The device-local Google key is
 * read here, at creation, instead of being captured as a module constant, so a
 * key change reaches the provider the next time a map is created.
 */
export function createBasemapProvider(): BasemapProvider {
  return new Provider(createBrowserBasemapHttp(), {
    mapTilerKey: import.meta.env.VITE_MAPTILER_KEY,
    googleMapsApiKey: googleMapsApiKey.value,
  })
}
