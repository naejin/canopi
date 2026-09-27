import { currentCanvasQuerySurface } from '../../canvas/session'
import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { WORKSPACE_MAP_MAX_ZOOM, WORKSPACE_MAP_MIN_ZOOM } from '../../canvas/workspace-camera-policy'
import { SETTINGS_BASEMAP_STYLES } from '../../generated/settings'
import { captureMapBackgroundPresentation, type MapBackgroundPresentation } from '../../maplibre/map-background'
import {
  createViewSnapshotMap,
  type ViewSnapshotCapture,
  type ViewSnapshotImageType,
  type ViewSnapshotMap,
  type ViewSnapshotRequest,
} from '../../maplibre/view-snapshot-map'
import type { BasemapStyle } from '../../generated/contracts'
import type { SavedView } from '../../types/design'
import { locale } from '../settings/state'
import { mapLayers, type MapLayersState } from '../map-layers/state'

/** Default wait for tiles before a snapshot is read with a "some tiles missing" flag. */
export const VIEW_SNAPSHOT_DEFAULT_TIMEOUT_MS = 8_000

export const VIEW_SNAPSHOT_THUMBNAIL = Object.freeze({ width: 320, height: 200 })
export const VIEW_SNAPSHOT_EXPORT = Object.freeze({ width: 1600, height: 1000 })

export interface SavedViewSnapshotOptions {
  /** CSS pixels of the image. */
  readonly width: number
  readonly height: number
  readonly pixelRatio?: number
  readonly timeoutMs?: number
  readonly type?: ViewSnapshotImageType
  readonly quality?: number
  readonly signal?: AbortSignal
}

export type SavedViewSnapshot = ViewSnapshotCapture

export interface SavedViewSnapshotContext {
  readonly queries: Pick<CanvasQuerySurface, 'sessionPlane' | 'viewport' | 'captureViewScene'>
  readonly mapLayers: MapLayersState
  readonly locale: string
}

/**
 * The off-screen capture request for a saved view of the open Design, or null
 * when no Design is open on a map. The camera is the view's centre, with the
 * zoom fitted so the image shows what the workspace showed at its current
 * size. Background, Design layers and the focused species come from the view;
 * opacities and locale from the user's current settings.
 */
export function describeSavedViewSnapshot(
  view: SavedView,
  options: SavedViewSnapshotOptions,
  context: SavedViewSnapshotContext,
): ViewSnapshotRequest | null {
  const plane = context.queries.sessionPlane.peek()
  if (!plane) return null
  const { screenSize } = context.queries.viewport.peek()
  const visibleLayerNames = [...view.visible_layers.scene_layers]
  const focusedSpecies = view.highlighted.species[0] ?? null
  return {
    camera: {
      lon: view.camera.lon,
      lat: view.camera.lat,
      zoom: fitZoom(view.camera.zoom, options, screenSize),
    },
    width: options.width,
    height: options.height,
    ...(options.pixelRatio === undefined ? {} : { pixelRatio: options.pixelRatio }),
    background: savedViewBackgroundPresentation(view, context.mapLayers, context.locale),
    scene: {
      origin: plane.origin,
      build(viewport) {
        const snapshot = context.queries.captureViewScene({ viewport, visibleLayerNames, focusedSpecies })
        if (!snapshot) throw new ViewSnapshotSceneBusyError()
        return snapshot
      },
    },
    timeoutMs: options.timeoutMs ?? VIEW_SNAPSHOT_DEFAULT_TIMEOUT_MS,
    ...(options.type === undefined ? {} : { type: options.type }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
}

/** An edit owned the Scene when the snapshot was drawn; try again later. */
export class ViewSnapshotSceneBusyError extends Error {
  constructor() {
    super('The Design was being edited; the view snapshot was not taken.')
    this.name = 'ViewSnapshotSceneBusyError'
  }
}

export function savedViewBackgroundPresentation(
  view: SavedView,
  layers: MapLayersState,
  activeLocale: string,
): MapBackgroundPresentation {
  const background = view.visible_layers.background
  const style = background.kind === 'basemap' && isBasemapStyle(background.style)
    ? background.style
    : layers.basemap.style
  return captureMapBackgroundPresentation({
    basemap: { style, visible: background.kind === 'basemap', opacity: layers.basemap.opacity },
    satellite: { visible: background.kind === 'satellite', opacity: layers.satellite.opacity },
    locale: activeLocale,
  })
}

let owner: ViewSnapshotMap | null = null

/**
 * Captures a saved view of the open Design as an image, off-screen: the
 * visible map, the camera and the Design are never touched. Resolves null when
 * no Design is open on a map; rejects with `ViewSnapshotSceneBusyError` while
 * an edit owns the Scene.
 */
export async function captureSavedViewSnapshot(
  view: SavedView,
  options: SavedViewSnapshotOptions,
): Promise<SavedViewSnapshot | null> {
  const queries = currentCanvasQuerySurface.peek()
  if (!queries) return null
  const request = describeSavedViewSnapshot(view, options, {
    queries,
    mapLayers: mapLayers.peek(),
    locale: locale.peek(),
  })
  if (!request) return null
  owner ??= createViewSnapshotMap()
  return owner.capture(request)
}

/** Releases the shared off-screen map now instead of after its idle delay. */
export async function disposeViewSnapshots(): Promise<void> {
  const current = owner
  owner = null
  await current?.dispose()
}

function fitZoom(
  zoom: number,
  size: { readonly width: number; readonly height: number },
  reference: { readonly width: number; readonly height: number },
): number {
  const fit = reference.width > 0 && reference.height > 0
    ? Math.log2(Math.min(size.width / reference.width, size.height / reference.height))
    : 0
  const fitted = Number.isFinite(fit) ? zoom + fit : zoom
  return Math.min(WORKSPACE_MAP_MAX_ZOOM, Math.max(WORKSPACE_MAP_MIN_ZOOM, fitted))
}

function isBasemapStyle(style: string): style is BasemapStyle {
  return (SETTINGS_BASEMAP_STYLES as readonly string[]).includes(style)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void disposeViewSnapshots()
  })
}
