import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'

export type MapNoticeTone = 'loading' | 'ready' | 'error'

export interface MapNoticeReadModel {
  readonly visible: boolean
  readonly mapSurfaceVisible: boolean
  readonly tone: MapNoticeTone
  readonly statusText: string
}

export interface MapNoticeReadModelInput {
  readonly hasDesign: boolean
  readonly mapVisible: boolean
  readonly mapSurface: MapLibreCanvasSurfaceState
  readonly t: (key: string) => string
}

/** Reports basemap and terrain readiness for the open Design's map canvas. */
export function getMapNoticeReadModel({
  hasDesign,
  mapVisible,
  mapSurface,
  t,
}: MapNoticeReadModelInput): MapNoticeReadModel {
  const mapSurfaceVisible = hasDesign && mapVisible
  const statusText = mapSurfaceVisible ? getMapNoticeStatusText(mapSurface, t) : ''
  return {
    visible: mapSurfaceVisible && statusText !== '',
    mapSurfaceVisible,
    tone: getMapNoticeTone(mapSurface),
    statusText,
  }
}

function getMapNoticeTone(mapSurface: MapLibreCanvasSurfaceState): MapNoticeTone {
  if (mapSurface.status === 'error') return 'error'
  if (mapSurface.status === 'ready') return 'ready'
  return 'loading'
}

function getMapNoticeStatusText(mapSurface: MapLibreCanvasSurfaceState, t: (key: string) => string): string {
  if (mapSurface.status === 'error') {
    return `${t('canvas.layers.mapUnavailable')}: ${mapSurface.errorMessage ?? ''}`.trim()
  }
  if (mapSurface.status !== 'ready') return t('canvas.layers.basemapLoading')
  return mapSurface.terrainStatus === 'error'
    ? `${t('canvas.layers.mapSection')}: ${mapSurface.terrainErrorMessage ?? ''}`.trim()
    : ''
}
