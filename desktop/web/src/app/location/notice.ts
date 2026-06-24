import type { MapLibreCanvasSurfaceState } from '../../maplibre/canvas-surface-state'
import type { SavedLocationPresentation } from './workbench'

export type LocationNoticeTone = 'loading' | 'ready' | 'error'

export interface LocationNoticeReadModel {
  readonly visible: boolean
  readonly mapSurfaceVisible: boolean
  readonly tone: LocationNoticeTone
  readonly statusText: string
  readonly locationKey: string | null
}

export interface LocationNoticeReadModelInput {
  readonly saved: SavedLocationPresentation
  readonly mapVisible: boolean
  readonly mapSurface: MapLibreCanvasSurfaceState
  readonly t: (key: string) => string
}

export function getLocationNoticeReadModel({
  saved,
  mapVisible,
  mapSurface,
  t,
}: LocationNoticeReadModelInput): LocationNoticeReadModel {
  const mapSurfaceVisible = saved.hasDesign && saved.hasLocation && mapVisible
  const tone = getLocationNoticeTone(mapSurface)
  const statusText = mapSurfaceVisible ? getLocationNoticeStatusText(mapSurface, t) : ''

  return {
    visible: mapSurfaceVisible && statusText !== '',
    mapSurfaceVisible,
    tone,
    statusText,
    locationKey: saved.key,
  }
}

function getLocationNoticeTone(mapSurface: MapLibreCanvasSurfaceState): LocationNoticeTone {
  if (mapSurface.status === 'error') return 'error'
  if (mapSurface.status === 'ready') return 'ready'
  return 'loading'
}

function getLocationNoticeStatusText(mapSurface: MapLibreCanvasSurfaceState, t: (key: string) => string): string {
  if (mapSurface.status === 'error') {
    return `${t('canvas.layers.basemapError')}: ${mapSurface.errorMessage ?? ''}`.trim()
  }

  if (mapSurface.status !== 'ready') {
    return t('canvas.layers.basemapLoading')
  }

  const messages = [
    mapSurface.terrainStatus === 'error'
      ? `${t('canvas.layers.mapSection')}: ${mapSurface.terrainErrorMessage ?? ''}`.trim()
      : '',
    mapSurface.precisionWarning ? t('canvas.layers.precisionWarning') : '',
  ].filter(Boolean)

  return messages.join(' • ')
}
