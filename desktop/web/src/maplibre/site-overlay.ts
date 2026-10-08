// maplibre/site-overlay.ts
//
// The Site data pin and profile line on the map (canopi-f47t.42, spec §1.10; plan §4 "Map overlay route"; stream C builds
// it): a pure contract from the overlay snapshot's `site` (lon/lat) to one GeoJSON source and its layers in the
// interaction-overlay band, drawn by the generalised overlay sync with its own skip key. The pin is a two-tone dot (ink
// core, white ring), the line a light line on the draft casing with vertex dots, coloured from scene-visuals.ts. The chart
// hover never rides the snapshot: it is one setData on its own source (WorkspaceMapContributions.setSiteHover). No
// setters. Commit 0's stub with the final signature.

/** The overlay snapshot's Site data part, in [lon, lat]; null on Web and in overview. */
export interface SiteMapOverlay {
  readonly pin: readonly [number, number] | null
  readonly profileLine: readonly (readonly [number, number])[] | null
}

interface SiteMapOverlayFeature {
  readonly type: 'Feature'
  readonly geometry:
    | { readonly type: 'Point'; readonly coordinates: readonly [number, number] }
    | { readonly type: 'LineString'; readonly coordinates: readonly (readonly [number, number])[] }
  readonly properties: { readonly role: 'pin' | 'profile-line' | 'profile-vertex' }
}

interface SiteMapOverlayLayer {
  readonly id: string
  readonly source: string
  readonly type: 'circle' | 'line'
  readonly filter: readonly unknown[]
  readonly paint: Readonly<Record<string, string | number>>
}

export interface SiteMapOverlayContract {
  readonly source: {
    readonly id: string
    readonly type: 'geojson'
    readonly data: { readonly type: 'FeatureCollection'; readonly features: readonly SiteMapOverlayFeature[] }
  }
  readonly layers: readonly SiteMapOverlayLayer[]
  readonly hasRenderableFeatures: boolean
}

/**
 * The ids the map seam registers in the interaction-overlay band, back to front: the pin and line's source and layers, then
 * the chart hover's own source and ring (one setData per scrub, never the snapshot).
 */
export function siteMapOverlayIds() {
  return {
    sourceId: 'site-overlay-source',
    layerIds: [
      'site-profile-casing',
      'site-profile-line',
      'site-profile-vertices',
      'site-pin-ring',
      'site-pin-core',
    ] as const,
    hover: {
      sourceId: 'site-hover-source',
      layerIds: ['site-hover-ring'] as const,
    },
  }
}

export function siteMapOverlayContract(site: SiteMapOverlay | null): SiteMapOverlayContract {
  void site
  return {
    source: { id: siteMapOverlayIds().sourceId, type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    layers: [],
    hasRenderableFeatures: false,
  }
}
