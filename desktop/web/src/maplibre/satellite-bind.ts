import { effect } from '@preact/signals'
import type { SatelliteImageryProvider, SatelliteState, SatelliteViewport } from './satellite-provider-session'
import { SatelliteImageryProvider as Provider } from './satellite-provider-session'
import { createBrowserSatelliteHttp } from './satellite-http.browser'
import { BasemapTileAuth } from './basemap-tile-auth'
import { activeGoogleMapsApiKey, locale } from '../app/settings/state'
import {
  reconcileSatelliteContribution,
  setSatelliteContributionVisibility,
  type SatelliteReconcileTarget,
} from './satellite-contribution'

/**
 * Wire a live provider to a live map.
 *
 * The provider owns the session, the viewport requests and the retry policy; the
 * map owns its camera, its scene and every other layer. This binding is the only
 * place they meet, and it deliberately does exactly two things: apply the
 * provider's published state to the basemap source and layer once the style can
 * accept it, and apply visibility. It never calls `setStyle()` and never
 * recreates the map, which is what lets a key change or a
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
export interface MapStyleReadiness {
  isReady(): boolean
  /**
   * Wait for the style once. The callback runs at most once, and firing or
   * disposing removes every listener the wait registered. Returns the disposer;
   * the caller owns it and keeps at most one pending wait.
   */
  whenReady(listener: () => void): () => void
}

export interface SatelliteBindingDeps {
  readonly provider: SatelliteImageryProvider
  readonly map: SatelliteReconcileTarget
  /** Relative cost of one zoom level at this map's projection; a raster
   * contribution is a single source, so this is constant. */
  readonly maxzoomFallback?: number
  /** User visibility of the satellite layer, independent of provider readiness. */
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
  readonly styleReady?: MapStyleReadiness
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

/** Effective basemap visibility: user visibility AND provider renderability. */
function effectiveBasemapVisibility(
  state: SatelliteState,
  userVisible: boolean,
): boolean {
  return userVisible && state.state === 'ready'
}

/** Install the binding and return its disposer. */
export function bindSatelliteImagery(deps: SatelliteBindingDeps): () => void {
  const { provider, map, tileAuth } = deps
  const visible = deps.visible ?? (() => true)
  let disposed = false
  let pending: SatelliteState | null = null
  let cancelReadyWait: (() => void) | null = null

  const target: SatelliteReconcileTarget = {
    getSource: (id) => map.getSource(id),
    getLayer: (id) => map.getLayer(id),
    removeLayer: (id) => map.removeLayer(id),
    removeSource: (id) => map.removeSource(id),
    addSource: (id, source) => map.addSource(id, source),
    addLayer: (layer, beforeId) => {
      if (beforeId) map.addLayer(layer, beforeId)
      else map.addLayer(layer)
    },
    setLayoutProperty: (id, name, value) => map.setLayoutProperty?.(id, name, value),
  }
  // Only expose the attribution adapter when a real control seam exists, so
  // the contribution can fall back to source-carried credit.
  if (map.replaceSatelliteAttribution) {
    target.replaceSatelliteAttribution = (attribution: string) =>
      map.replaceSatelliteAttribution?.(attribution)
  }

  const apply = (state: SatelliteState): void => {
    // The latest state always wins: a state that arrives while the style is
    // still loading is what gets applied when it finishes, not the one that
    // happened to arrive first.
    pending = state
    if (deps.styleReady && !deps.styleReady.isReady()) return
    pending = null
    reconcileSatelliteContribution(target, state, {
      officialTilesResolvable: tileAuth?.installed === true,
      ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
    })
    // Effective visibility is user visibility AND provider renderability:
    // Loading official metadata must not expose cached imagery.
    setSatelliteContributionVisibility(
      target,
      effectiveBasemapVisibility(state, visible()),
    )
    deps.afterApply?.()
  }


  // Adopt whatever the provider already published. Without this a map created
  // after the provider resolved would show no basemap until the next change.
  apply(provider.snapshot())

  const unsubscribe = provider.subscribe(apply)
  if (deps.styleReady && !deps.styleReady.isReady()) {
    cancelReadyWait = deps.styleReady.whenReady(() => {
      cancelReadyWait = null
      if (disposed) return
      const state = pending ?? provider.snapshot()
      pending = null
      reconcileSatelliteContribution(target, state, {
        officialTilesResolvable: tileAuth?.installed === true,
        ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
      })
      setSatelliteContributionVisibility(
        target,
        effectiveBasemapVisibility(state, visible()),
      )
      deps.afterApply?.()
    })
  }

  return () => {
    disposed = true
    pending = null
    cancelReadyWait?.()
    cancelReadyWait = null
    unsubscribe()
    // The credential belongs to the surface that installed it: a removed map
    // must not leave a live session token in a shared transport.
    tileAuth?.clear()
  }
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
function createSatelliteImagery(
  tileAuth: BasemapTileAuth | null = null,
): SatelliteImageryProvider {
  return new Provider(
    createBrowserSatelliteHttp(),
    () => ({
      // The saved key only while Settings › Map and imagery chooses it.
      googleMapsApiKey: activeGoogleMapsApiKey.value,
      locale: locale.value,
    }),
    () => Date.now(),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tileAuth,
  )
}

/**
 * Observe the effective key and application locale for one map lifetime.
 *
 * A getter without an observer is insufficient: an already mounted provider
 * must be updated when any of these change, so the configuration identity is
 * re-evaluated and an incompatible session is replaced. Returns its disposer.
 */
function installSatelliteConfigObserver(
  provider: SatelliteImageryProvider,
  readViewport: () => SatelliteViewport,
): () => void {
  let mounted = false
  return effect(() => {
    // Subscribe to every configuration identity input.
    void activeGoogleMapsApiKey.value
    void locale.value
    // The caller already applied the initial configuration; only later
    // configuration identity changes update the already mounted provider.
    if (!mounted) {
      mounted = true
      return
    }
    try {
      provider.update(readViewport())
    } catch {
      // A map that rejects the new contribution reports through its own
      // failure watcher; a settings change must not become an unhandled throw.
    }
  })
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
  lifetime: {
    on(type: string, listener: (event?: unknown) => void): void
    off(type: string, listener: (event?: unknown) => void): void
  },
): MapStyleReadiness {
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
      let settled = false
      const release = () => {
        if (settled) return
        settled = true
        lifetime.off('load', onReady)
        lifetime.off('style.load', onReady)
      }
      // `load` and `style.load` both signal readiness; whichever comes first
      // wins and a later style reload is not this wait's business.
      const onReady = () => {
        if (settled) return
        release()
        listener()
      }
      lifetime.on('load', onReady)
      lifetime.on('style.load', onReady)
      return release
    },
  }
}

/**
 * One per-map basemap mount operation.
 *
 * Creates the provider and its observers/binding, initializes from current
 * configuration immediately, applies later configuration and viewport changes,
 * and cleans up subscriptions, pending callbacks, requests and credentials.
 * Where request transformation must exist before map
 * construction, the map host creates that credential capability and supplies
 * it; this mount never installs a second transform or recreates the map.
 */
export interface SatelliteMountOptions {
  readonly map: SatelliteReconcileTarget
  readonly tileAuth?: BasemapTileAuth | null
  readonly readViewport: () => SatelliteViewport
  readonly readVisible?: () => boolean
  readonly styleReady?: MapStyleReadiness
  readonly beforeLayerId?: () => string | null
  readonly afterApply?: () => void
  /**
   * Lifetime-owned event registration from the map host. The mount registers
   * `moveend` once and unregisters on disposal. Host camera/UI listeners stay
   * with their existing owners.
   */
  readonly events?: {
    on(type: string, listener: () => void): void
    off?(type: string, listener: () => void): void
  }
  readonly replaceSatelliteAttribution?: (attribution: string) => void
}

export interface SatelliteMountHandle {
  update(viewport: SatelliteViewport): void
  updateViewport(viewport: SatelliteViewport): void
  dispose(): void
}

export function mountSatelliteLifecycle(options: SatelliteMountOptions): SatelliteMountHandle {
  const tileAuth = options.tileAuth ?? null
  const provider = createSatelliteImagery(tileAuth)
  // Delegate explicitly: a live MapLibre map keeps its methods on the class
  // prototype, so spreading it would drop them.
  const map = options.map
  const replaceSatelliteAttribution = options.replaceSatelliteAttribution
  const mapTarget: SatelliteReconcileTarget = replaceSatelliteAttribution
    ? {
        getSource: (id) => map.getSource(id),
        getLayer: (id) => map.getLayer(id),
        removeLayer: (id) => map.removeLayer(id),
        removeSource: (id) => map.removeSource(id),
        addSource: (id, source) => map.addSource(id, source),
        addLayer: (layer, beforeId) => map.addLayer(layer, beforeId),
        setLayoutProperty: (id, name, value) => map.setLayoutProperty?.(id, name, value),
        replaceSatelliteAttribution,
      }
    : map
  const unbind = bindSatelliteImagery({
    provider,
    map: mapTarget,
    ...(tileAuth ? { tileAuth } : {}),
    ...(options.styleReady ? { styleReady: options.styleReady } : {}),
    ...(options.beforeLayerId ? { beforeLayerId: options.beforeLayerId } : {}),
    ...(options.afterApply ? { afterApply: options.afterApply } : {}),
    ...(options.readVisible ? { visible: options.readVisible } : {}),
  })
  // Initialize from current configuration immediately: no movement, settings
  // or style-ready event is required before the first provider generation.
  provider.update(options.readViewport())
  const disposeObserver = installSatelliteConfigObserver(provider, options.readViewport)
  // The mount owns viewport-event subscription as well as configuration
  // observation. Read the current map viewport when the event fires.
  const onMoveEnd = () => provider.updateViewport(options.readViewport())
  options.events?.on('moveend', onMoveEnd)
  return {
    update: (viewport: SatelliteViewport) => provider.update(viewport),
    updateViewport: (viewport: SatelliteViewport) => provider.updateViewport(viewport),
    dispose: () => {
      options.events?.off?.('moveend', onMoveEnd)
      disposeObserver()
      unbind()
      provider.dispose()
      // Withdraw the contribution so teardown leaves no source, layer or
      // basemap-owned credit on a map that outlives the mount.
      try {
        reconcileSatelliteContribution(mapTarget, { state: 'idle' })
      } catch {
        // A map that rejects withdrawal still tears down its own resources.
      }
    },
  }
}
