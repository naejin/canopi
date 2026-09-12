import { activeLayerName, contourIntervalMeters, hillshadeOpacity, hillshadeVisible, layerLockState, layerOpacity, layerVisibility } from '../canvas-settings/signals'
import { readSavedLocationPresentation } from '../location'
import { mutateSettingsProjection } from '../settings/projection'
import { getCurrentCanvasLayerCommandSurface, currentCanvasQuerySurface } from '../../canvas/session'
import { t } from '../../i18n'

const SCENE_LAYER_ROW_IDS = ['annotations', 'plants', 'measurement-guides', 'zones'] as const
const MAP_LAYER_IDS = new Set(['base', 'contours'])

export type CanvasLayerPresentationAuthority = 'scene' | 'map-settings' | 'terrain-settings'

export type CanvasLayerPresentationDetail =
  | { readonly type: 'scene' }
  | {
      readonly type: 'location-map'
      readonly hasLocation: boolean
      readonly locationSummary: string | null
      readonly opacityDisabled: boolean
    }
  | {
      readonly type: 'contours'
      readonly hasLocation: boolean
      readonly contourIntervalMeters: number
    }
  | {
      readonly type: 'hillshade'
      readonly hasLocation: boolean
    }

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

export interface CanvasLayerPresentationMapSurface {
  readonly hasVisibleMapLayer: boolean
  readonly layerVisibility: Readonly<Record<string, boolean>>
  readonly layerOpacity: Readonly<Record<string, number>>
  readonly terrain: {
    readonly contourIntervalMeters: number
    readonly contoursVisible: boolean
    readonly contoursOpacity: number
    readonly hillshadeVisible: boolean
    readonly hillshadeOpacity: number
  }
}

export interface CanvasLayerPresentation {
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly mapSurface: CanvasLayerPresentationMapSurface
  readonly hasVisibleMapLayer: boolean
}

export function readCanvasLayerPresentation(): CanvasLayerPresentation {
  const runtime = currentCanvasQuerySurface.value
  void runtime?.revision.scene.value
  const scene = runtime?.getSceneSnapshot()
  const savedLocation = readSavedLocationPresentation()
  const visibility = layerVisibility.value
  const locks = layerLockState.value
  const opacities = layerOpacity.value
  const active = activeLayerName.value
  const hillshadeOn = hillshadeVisible.value

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
    {
      id: 'base',
      label: t('canvas.layers.basemap'),
      authority: 'map-settings',
      active: active === 'base',
      visible: visibility.base ?? true,
      opacity: opacities.base ?? 1,
      locked: false,
      canLock: false,
      detail: {
        type: 'location-map',
        hasLocation: savedLocation.hasLocation,
        locationSummary: savedLocation.summary,
        opacityDisabled: !savedLocation.hasLocation,
      },
    },
    {
      id: 'contours',
      label: t('canvas.terrain.contours'),
      authority: 'map-settings',
      active: active === 'contours',
      visible: visibility.contours ?? false,
      opacity: opacities.contours ?? 1,
      locked: false,
      canLock: false,
      detail: {
        type: 'contours',
        hasLocation: savedLocation.hasLocation,
        contourIntervalMeters: contourIntervalMeters.value,
      },
    },
    {
      id: 'hillshading',
      label: t('canvas.terrain.hillshade'),
      authority: 'terrain-settings',
      active: active === 'hillshading',
      visible: hillshadeOn,
      opacity: hillshadeOpacity.value,
      locked: false,
      canLock: false,
      detail: { type: 'hillshade', hasLocation: savedLocation.hasLocation },
    },
  ]

  const mapSurface = readCanvasMapLayerPresentation()

  return {
    rows,
    mapSurface,
    hasVisibleMapLayer: mapSurface.hasVisibleMapLayer,
  }
}

export function setCanvasLayerPresentationActiveLayer(id: string): void {
  activeLayerName.value = id
}

export function setCanvasLayerPresentationVisibility(id: string, visible: boolean): boolean {
  if (id === 'base') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.baseVisible = visible
    }, { persist: 'queued' })
    return true
  }
  if (id === 'contours') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.contoursVisible = visible
    }, { persist: 'queued' })
    return true
  }
  if (id === 'hillshading') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.hillshadeVisible = visible
    }, { persist: 'queued' })
    return true
  }

  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerVisibility(id, visible) ?? false
}

export function setCanvasLayerPresentationOpacity(id: string, opacity: number): boolean {
  if (!Number.isFinite(opacity)) return false
  const next = clampUnitInterval(opacity)
  if (id === 'base') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.baseOpacity = next
    }, { persist: 'queued' })
    return true
  }
  if (id === 'contours') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.contoursOpacity = next
    }, { persist: 'queued' })
    return true
  }
  if (id === 'hillshading') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.hillshadeOpacity = next
    }, { persist: 'queued' })
    return true
  }

  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerOpacity(id, next) ?? false
}

export function setCanvasLayerPresentationLocked(id: string, locked: boolean): boolean {
  if (MAP_LAYER_IDS.has(id) || id === 'hillshading') return false
  return getCurrentCanvasLayerCommandSurface()?.setSceneLayerLocked(id, locked) ?? false
}

export function setCanvasLayerPresentationContourIntervalMeters(interval: number): boolean {
  if (!Number.isFinite(interval)) return false
  mutateSettingsProjection((settings) => {
    settings.mapLayers.contourIntervalMeters = interval
  }, { persist: 'queued' })
  return true
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function readCanvasMapLayerPresentation(): CanvasLayerPresentationMapSurface {
  const visibility = layerVisibility.value
  const opacities = layerOpacity.value
  const hillshadeOn = hillshadeVisible.value
  const mapVisibility = {
    ...visibility,
    base: visibility.base ?? true,
    contours: visibility.contours ?? false,
  }
  const mapOpacity = {
    ...opacities,
    base: opacities.base ?? 1,
    contours: opacities.contours ?? 1,
  }
  const terrain = {
    contourIntervalMeters: contourIntervalMeters.value,
    contoursVisible: visibility.contours ?? false,
    contoursOpacity: opacities.contours ?? 1,
    hillshadeVisible: hillshadeOn,
    hillshadeOpacity: hillshadeOpacity.value,
  }

  return {
    hasVisibleMapLayer: mapVisibility.base || terrain.contoursVisible || terrain.hillshadeVisible,
    layerVisibility: mapVisibility,
    layerOpacity: mapOpacity,
    terrain,
  }
}
