import type { SceneDesignObjectTarget } from '../../canvas/runtime/scene'
import { roundGeoDegrees, storedBearing, type GeographicExtent, type GeographicView } from '../../canvas/session-plane'
import { SAVED_VIEW_MAX_ZOOM } from '../../generated/canopi-design-format'
import type { CanopiFile, SavedView, SavedViewBackground, SavedViewObject } from '../../types/design'
import { mapBackgroundOf, type MapLayersState } from '../map-layers/state'

export interface SavedViewCaptureInput {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly view: GeographicView
  /** The ground the map shows (written with the view; going to it and its thumbnails use the camera); null when it leaves one world. */
  readonly extent?: GeographicExtent | null
  readonly mapLayers: MapLayersState
  readonly sceneLayers: readonly { readonly name: string; readonly visible: boolean }[]
  readonly siteData: readonly { readonly id: string; readonly visible: boolean }[]
  readonly focusedSpecies: string | null
  readonly selection: readonly SceneDesignObjectTarget[]
}

/** What the current view shows, as a saved view: its camera with the bearing rounded to 1e-6 and folded into [0, 360) (spec §4.10). */
export function composeSavedView(input: SavedViewCaptureInput): SavedView {
  return {
    id: input.id,
    name: input.name,
    camera: {
      lon: roundGeoDegrees(input.view.lon),
      lat: roundGeoDegrees(input.view.lat),
      zoom: Math.min(SAVED_VIEW_MAX_ZOOM, Math.max(0, Math.round(input.view.zoom * 1e6) / 1e6)),
      bearing: storedBearing(input.view.bearing),
    },
    visible_layers: {
      background: backgroundOf(input.mapLayers),
      terrain: {
        contours: input.mapLayers.contours.visible,
        hillshade: input.mapLayers.hillshade.visible,
      },
      scene_layers: input.sceneLayers.filter((layer) => layer.visible).map((layer) => layer.name),
      site_data: input.siteData.filter((entry) => entry.visible).map((entry) => entry.id),
    },
    highlighted: {
      species: input.focusedSpecies ? [input.focusedSpecies] : [],
      objects: input.selection.map(savedViewObjectOf),
    },
    title: input.title,
    text: [],
    ...(input.extent ? {
      extent: {
        west: roundGeoDegrees(input.extent.west),
        south: roundGeoDegrees(input.extent.south),
        east: roundGeoDegrees(input.extent.east),
        north: roundGeoDegrees(input.extent.north),
      },
    } : {}),
  }
}

/** The stories with a step that shows this view, by name, in story order. */
export function storiesShowingView(design: CanopiFile | null, viewId: string): string[] {
  return (design?.stories ?? [])
    .filter((story) => story.steps.some((step) => step.view_id === viewId))
    .map((story) => story.name)
}

function backgroundOf(state: MapLayersState): SavedViewBackground {
  switch (mapBackgroundOf(state)) {
    case 'satellite':
      return { kind: 'satellite' }
    case 'basemap':
      return { kind: 'basemap', style: state.basemap.style }
    case 'none':
      return { kind: 'none' }
  }
}

function savedViewObjectOf(target: SceneDesignObjectTarget): SavedViewObject {
  return target.kind === 'measurement-guide'
    ? { kind: 'measurement_guide', id: target.id }
    : { kind: target.kind, id: target.id }
}
