import { effect } from '@preact/signals'
import type { BasemapProvider, BasemapProviderState, BasemapViewport } from './basemap-provider-session'
import { BasemapProvider as Provider } from './basemap-provider-session'
import { createBrowserBasemapHttp } from './basemap-http.browser'
import { BasemapTileAuth } from './basemap-tile-auth'
import { googleMapsApiKey, locale } from '../app/settings/state'
import type { BasemapStyle } from '../generated/contracts'
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
  /**
   * Production map-owned attribution control seam.
   *
   * Copyright-only updates replace this owned control rather than removing the
   * tile source. Required for a live map: a required behavior must not silently
   * disappear behind an optional method.
   */
  readonly attributionControls?: {
    create(options: {
      compact?: boolean
      customAttribution?: string | string[]
    }): unknown
    add(control: unknown): void
    remove(control: unknown): void
  }
}

/** Effective basemap visibility: user visibility AND provider renderability. */
function effectiveBasemapVisibility(
  state: BasemapProviderState,
  userVisible: boolean,
): boolean {
  return userVisible && state.state === 'ready'
}

/** Install the binding and return its disposer. */
export function bindBasemapProvider(deps: BasemapBindingDeps): () => void {
  const { provider, map, tileAuth } = deps
  const visible = deps.visible ?? (() => true)
  let disposed = false
  let pending: BasemapProviderState | null = null
  let ownedAttribution: unknown = null
  let ownedCredit: string | null = null

  const target: BasemapReconcileTarget = {
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
  if (map.replaceBasemapAttribution) {
    target.replaceBasemapAttribution = (attribution: string) =>
      map.replaceBasemapAttribution?.(attribution)
  } else if (deps.attributionControls) {
    const controls = deps.attributionControls
    target.replaceBasemapAttribution = (attribution: string) => {
      // Keep an existing control when its credit is unchanged.
      if (ownedAttribution && ownedCredit === attribution) return
      if (ownedAttribution) {
        controls.remove(ownedAttribution)
        ownedAttribution = null
      }
      ownedCredit = attribution
      // Never create an extra empty control on withdrawal.
      if (attribution === '') return
      ownedAttribution = controls.create({
        compact: true,
        customAttribution: attribution,
      })
      controls.add(ownedAttribution)
    }
  }

  const apply = (state: BasemapProviderState): void => {
    // The latest state always wins: a state that arrives while the style is
    // still loading is what gets applied when it finishes, not the one that
    // happened to arrive first.
    pending = state
    if (deps.styleReady && !deps.styleReady.isReady()) return
    pending = null
    reconcileBasemapContribution(target, state, {
      officialTilesResolvable: tileAuth?.installed === true,
      ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
    })
    // Effective visibility is user visibility AND provider renderability:
    // Loading official metadata must not expose cached imagery.
    setBasemapContributionVisibility(
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
    deps.styleReady.whenReady(() => {
      if (disposed) return
      const state = pending ?? provider.snapshot()
      pending = null
      reconcileBasemapContribution(target, state, {
        officialTilesResolvable: tileAuth?.installed === true,
        ...(deps.beforeLayerId ? { beforeLayerId: deps.beforeLayerId } : {}),
      })
      setBasemapContributionVisibility(
        target,
        effectiveBasemapVisibility(state, visible()),
      )
      deps.afterApply?.()
    })
  }

  return () => {
    disposed = true
    pending = null
    unsubscribe()
    if (ownedAttribution) {
      deps.attributionControls?.remove(ownedAttribution)
      ownedAttribution = null
    }
    // The credential belongs to the surface that installed it: a removed map
    // must not leave a live session token in a shared transport.
    tileAuth?.clear()
  }
}

/**
 * Re-apply visibility alone.
 *
 * Hiding the basemap must not disturb the provider session or re-request tiles,
 * so this touches only the layer's layout property. The caller supplies
 * effective visibility (user visibility AND provider renderability).
 */
export function applyBasemapVisibility(
  map: BasemapReconcileTarget,
  visible: boolean,
): void {
  setBasemapContributionVisibility(map, visible)
}

/**
 * Map-owned attribution control seam for production MapLibre maps.
 *
 * Reuses the public add/remove-control APIs. Replacing the owned control is
 * how a copyright-only change updates attribution without removing the tile
 * source or disturbing other sources' credits.
 */
export function createAttributionControls(
  maplibre: unknown,
  map: {
    addControl?(control: unknown, position?: string): unknown
    removeControl?(control: unknown): unknown
  },
): BasemapBindingDeps['attributionControls'] {
  // Safe lookup: a partial maplibre stub or test mock may throw on a missing
  // export rather than returning undefined.
  let AttributionControl:
    | (new (options?: {
        compact?: boolean
        customAttribution?: string | string[]
      }) => unknown)
    | undefined
  try {
    AttributionControl = (maplibre as {
      AttributionControl?: new (options?: {
        compact?: boolean
        customAttribution?: string | string[]
      }) => unknown
    } | null | undefined)?.AttributionControl
  } catch {
    AttributionControl = undefined
  }
  if (!AttributionControl || !map.addControl || !map.removeControl) return undefined
  const addControl = map.addControl.bind(map)
  const removeControl = map.removeControl.bind(map)
  return {
    create: (options) => new AttributionControl(options),
    add: (control) => {
      addControl(control, 'bottom-right')
    },
    remove: (control) => {
      removeControl(control)
    },
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
export function createBasemapProvider(
  tileAuth: BasemapTileAuth | null = null,
): BasemapProvider {
  return new Provider(
    createBrowserBasemapHttp(),
    () => ({
      mapTilerKey: import.meta.env.VITE_MAPTILER_KEY,
      googleMapsApiKey: googleMapsApiKey.value,
      locale: locale.value,
    }),
    () => Date.now(),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tileAuth,
  )
}

/**
 * Observe style, effective key and application locale for one map lifetime.
 *
 * A getter without an observer is insufficient: an already mounted provider
 * must be updated when any of these change, so the configuration identity is
 * re-evaluated and an incompatible session is replaced. Returns its disposer.
 */
export function installBasemapConfigObserver(
  provider: BasemapProvider,
  readPresentation: () => { readonly style: BasemapStyle },
  readViewport: () => BasemapViewport,
): () => void {
  let mounted = false
  return effect(() => {
    // Subscribe to every configuration identity input.
    void googleMapsApiKey.value
    void locale.value
    const presentation = readPresentation()
    void presentation.style
    // The caller already applied the initial presentation; only later
    // configuration identity changes update the already mounted provider.
    if (!mounted) {
      mounted = true
      return
    }
    try {
      provider.update(presentation, readViewport())
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

/**
 * One per-map basemap mount operation.
 *
 * Creates the provider and its observers/binding, initializes from current
 * configuration immediately, applies later configuration and viewport changes,
 * and cleans up subscriptions, pending callbacks, requests, credentials and
 * owned controls. Where request transformation must exist before map
 * construction, the map host creates that credential capability and supplies
 * it; this mount never installs a second transform or recreates the map.
 */
export interface BasemapMountOptions {
  readonly map: BasemapReconcileTarget
  readonly tileAuth?: BasemapTileAuth | null
  readonly readStyle: () => BasemapStyle
  readonly readViewport: () => BasemapViewport
  readonly readVisible?: () => boolean
  readonly styleReady?: BasemapStyleReadiness
  readonly beforeLayerId?: () => string | null
  readonly afterApply?: () => void
  readonly attributionControls?: BasemapBindingDeps['attributionControls']
  readonly maplibre?: unknown
  readonly mapControls?: {
    addControl?(control: unknown, position?: string): unknown
    removeControl?(control: unknown): unknown
  }
  /**
   * Lifetime-owned event registration from the map host. The mount registers
   * `moveend` once and unregisters on disposal. Host camera/UI listeners stay
   * with their existing owners.
   */
  readonly events?: {
    on(type: string, listener: () => void): void
    off?(type: string, listener: () => void): void
  }
  readonly replaceBasemapAttribution?: (attribution: string) => void
}

export interface BasemapMountHandle {
  update(presentation: { readonly style: BasemapStyle }, viewport: BasemapViewport): void
  updateViewport(viewport: BasemapViewport): void
  dispose(): void
}

export function mountBasemapLifecycle(options: BasemapMountOptions): BasemapMountHandle {
  const tileAuth = options.tileAuth ?? null
  const provider = createBasemapProvider(tileAuth)
  const attributionControls =
    options.attributionControls ??
    (options.maplibre && options.mapControls
      ? createAttributionControls(options.maplibre, options.mapControls)
      : undefined)
  const mapTarget: BasemapReconcileTarget = options.replaceBasemapAttribution
    ? { ...options.map, replaceBasemapAttribution: options.replaceBasemapAttribution }
    : options.map
  const unbind = bindBasemapProvider({
    provider,
    map: mapTarget,
    ...(tileAuth ? { tileAuth } : {}),
    ...(options.styleReady ? { styleReady: options.styleReady } : {}),
    ...(options.beforeLayerId ? { beforeLayerId: options.beforeLayerId } : {}),
    ...(options.afterApply ? { afterApply: options.afterApply } : {}),
    ...(attributionControls ? { attributionControls } : {}),
    ...(options.readVisible ? { visible: options.readVisible } : {}),
  })
  // Initialize from current configuration immediately: no movement, settings
  // or style-ready event is required before the first provider generation.
  provider.update({ style: options.readStyle() }, options.readViewport())
  const disposeObserver = installBasemapConfigObserver(
    provider,
    () => ({ style: options.readStyle() }),
    options.readViewport,
  )
  // The mount owns viewport-event subscription as well as configuration
  // observation. Read the current map viewport when the event fires.
  const onMoveEnd = () => provider.updateViewport(options.readViewport())
  options.events?.on('moveend', onMoveEnd)
  return {
    update: (presentation, viewport) => provider.update(presentation, viewport),
    updateViewport: (viewport: BasemapViewport) => provider.updateViewport(viewport),
    dispose: () => {
      options.events?.off?.('moveend', onMoveEnd)
      disposeObserver()
      unbind()
      provider.dispose()
      // Withdraw the contribution so teardown leaves no source, layer or
      // basemap-owned credit on a map that outlives the mount.
      try {
        reconcileBasemapContribution(mapTarget, { state: 'idle' })
      } catch {
        // A map that rejects withdrawal still tears down its own resources.
      }
    },
  }
}
