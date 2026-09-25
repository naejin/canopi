import { activeLayerName, layerLockState, layerOpacity, layerVisibility } from '../canvas-settings/signals'
import { googleMapsApiKey } from '../settings/state'
import { hasVisibleMapLayer, mapLayers } from '../map-layers/state'
import {
  setMapLayerOpacity,
  setMapLayerVisible,
  setContourIntervalMeters,
  type MapLayerId,
} from '../map-layers/actions'
import type { BasemapStyle, SatelliteProvider } from '../../generated/contracts'
import { SETTINGS_BASEMAP_STYLES, SETTINGS_SATELLITE_PROVIDERS } from '../../generated/settings'
import { getCurrentCanvasLayerCommandSurface, currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'

const SCENE_LAYER_ROW_IDS = ['annotations', 'plants', 'measurement-guides', 'zones'] as const
const MAP_LAYER_ROW_IDS: ReadonlySet<string> = new Set<MapLayerId>(['basemap', 'satellite', 'contours', 'hillshade'])

export type CanvasLayerPresentationAuthority = 'scene' | 'map-layers'

export type CanvasLayerPresentationDetail =
  | { readonly type: 'scene' }
  | {
      readonly type: 'basemap'
      readonly style: BasemapStyle
      readonly styles: readonly BasemapStyle[]
      /** Satellite is on, so the Basemap is not drawn whatever its toggle says. */
      readonly hiddenBySatellite: boolean
    }
  | {
      readonly type: 'satellite'
      readonly provider: SatelliteProvider
      readonly providers: readonly SatelliteProvider[]
      readonly hasGoogleKey: boolean
    }
  | {
      readonly type: 'contours'
      readonly contourIntervalMeters: number
    }
  | { readonly type: 'hillshade' }

export interface CanvasLayerPresentationRow {
  readonly id: string
  readonly label: string
  readonly authority: CanvasLayerPresentationAuthority
  readonly active: boolean
  readonly visible: boolean
  readonly opacity: number
  readonly locked: boolean
  readonly count?: number
  readonly canLock: boolean
  readonly detail: CanvasLayerPresentationDetail
}

export interface CanvasLayerPresentation {
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly hasVisibleMapLayer: boolean
}

export function readCanvasLayerPresentation(): CanvasLayerPresentation {
  const runtime = currentCanvasQuerySurface.value
  void runtime?.revision.scene.value
  const scene = runtime?.getSceneSnapshot()
  const visibility = layerVisibility.value
  const locks = layerLockState.value
  const opacities = layerOpacity.value
  const active = activeLayerName.value
  const layers = mapLayers.value

  const mapRow = (
    id: MapLayerId,
    label: string,
    state: { readonly visible: boolean; readonly opacity: number },
    detail: CanvasLayerPresentationDetail,
  ): CanvasLayerPresentationRow => ({
    id,
    label,
    authority: 'map-layers',
    active: active === id,
    visible: state.visible,
    opacity: state.opacity,
    locked: false,
    canLock: false,
    detail,
  })

  const rows: CanvasLayerPresentationRow[] = [
    ...SCENE_LAYER_ROW_IDS.map((id) => {
      const sceneLayer = scene?.layers.find((layer) => layer.name === id)
      return {
        id,
        label: t(`canvas.layers.${id}`),
        authority: 'scene' as const,
        count: (id === 'measurement-guides' ? scene?.measurementGuides : scene?.[id])?.length ?? 0,
        active: active === id,
        visible: sceneLayer?.visible ?? visibility[id] ?? true,
        opacity: sceneLayer?.opacity ?? opacities[id] ?? 1,
        locked: sceneLayer?.locked ?? locks[id] ?? false,
        canLock: true,
        detail: { type: 'scene' as const },
      }
    }),
    mapRow('basemap', t('canvas.layers.basemap'), layers.basemap, {
      type: 'basemap',
      style: layers.basemap.style,
      styles: SETTINGS_BASEMAP_STYLES,
      hiddenBySatellite: layers.satellite.visible,
    }),
    mapRow('satellite', t('canvas.layers.satellite'), layers.satellite, {
      type: 'satellite',
      provider: layers.satellite.provider,
      providers: SETTINGS_SATELLITE_PROVIDERS,
      hasGoogleKey: Boolean(googleMapsApiKey.value?.trim()),
    }),
    mapRow('contours', t('canvas.terrain.contours'), layers.contours, {
      type: 'contours',
      contourIntervalMeters: layers.contours.intervalMeters,
    }),
    mapRow('hillshade', t('canvas.terrain.hillshade'), layers.hillshade, { type: 'hillshade' }),
  ]

  return { rows, hasVisibleMapLayer: hasVisibleMapLayer(layers) }
}

export function setCanvasLayerPresentationActiveLayer(id: string): void {
  activeLayerName.value = id
}

export function setCanvasLayerPresentationVisibility(id: string, visible: boolean): boolean {
  if (MAP_LAYER_ROW_IDS.has(id)) {
    setMapLayerVisible(id as MapLayerId, visible)
    return true
  }
  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerVisibility(id, visible) ?? false
}

export function setCanvasLayerPresentationOpacity(id: string, opacity: number): boolean {
  if (!Number.isFinite(opacity)) return false
  const next = Math.min(1, Math.max(0, opacity))
  if (MAP_LAYER_ROW_IDS.has(id)) {
    setMapLayerOpacity(id as MapLayerId, next)
    return true
  }
  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerOpacity(id, next) ?? false
}

export function setCanvasLayerPresentationLocked(id: string, locked: boolean): boolean {
  if (MAP_LAYER_ROW_IDS.has(id)) return false
  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerLocked(id, locked) ?? false
}

export function setCanvasLayerPresentationContourIntervalMeters(interval: number): boolean {
  if (!Number.isFinite(interval) || interval < 0) return false
  setContourIntervalMeters(interval)
  return true
}
