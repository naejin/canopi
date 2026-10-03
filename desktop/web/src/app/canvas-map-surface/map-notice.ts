import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

type MapNoticeTone = 'loading' | 'ready' | 'error'

export interface MapNoticeReadModel {
  readonly visible: boolean
  readonly mapSurfaceVisible: boolean
  readonly tone: MapNoticeTone
  readonly statusText: string
  /** The notice offers Retry. */
  readonly retry: boolean
}

export interface MapNoticeReadModelInput {
  readonly hasDesign: boolean
  readonly mapVisible: boolean
  readonly mapSurface: MapLibreCanvasSurfaceState
  readonly t: (key: string) => string
}

/**
 * Reports the map, basemap and terrain status for the open Design's map canvas. Every notice is a fixed
 * localized sentence, never the engine's error text, so no URL or key can reach it.
 */
export function getMapNoticeReadModel({
  hasDesign,
  mapVisible,
  mapSurface,
  t,
}: MapNoticeReadModelInput): MapNoticeReadModel {
  const mapSurfaceVisible = hasDesign && mapVisible
  const notice = mapSurfaceVisible ? readMapNotice(mapSurface, t) : null
  return {
    visible: notice !== null,
    mapSurfaceVisible,
    tone: notice?.tone ?? getMapStatusTone(mapSurface),
    statusText: notice?.text ?? '',
    retry: notice?.retry ?? false,
  }
}

function getMapStatusTone(mapSurface: MapLibreCanvasSurfaceState): MapNoticeTone {
  if (mapSurface.status === 'error') return 'error'
  if (mapSurface.status === 'ready') return 'ready'
  return 'loading'
}

/** By rank: a map failure, a basemap that couldn't load, loading, then a skipped layer or terrain. */
function readMapNotice(
  mapSurface: MapLibreCanvasSurfaceState,
  t: (key: string) => string,
): { readonly text: string; readonly tone: MapNoticeTone; readonly retry: boolean } | null {
  if (mapSurface.status === 'error') return { text: t('canvas.layers.mapUnavailable'), tone: 'error', retry: false }
  if (mapSurface.basemapStatus === 'failed') return { text: t('canvas.layers.basemapFailed'), tone: 'error', retry: true }
  const tone = getMapStatusTone(mapSurface)
  if (mapSurface.status !== 'ready') return { text: t('canvas.layers.basemapLoading'), tone, retry: false }
  if (mapSurface.terrainStatus === 'error' || mapSurface.layerSkipped) {
    return { text: t('canvas.layers.layerSkipped'), tone, retry: false }
  }
  return null
}
