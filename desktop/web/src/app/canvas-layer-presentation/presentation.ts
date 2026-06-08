import { activeLayerName, contourIntervalMeters, hillshadeOpacity, hillshadeVisible, layerLockState, layerOpacity, layerPanelOpen, layerVisibility } from '../canvas-settings/signals'
import { readSavedLocationPresentation } from '../location'
import { mutateSettingsProjection } from '../settings/projection'
import { locale } from '../settings/state'
import { getCurrentCanvasLayerCommandSurface, currentCanvasQuerySurface } from '../../canvas/session'
import type { BasemapStyle } from '../../generated/contracts'
import { t } from '../../i18n'

const SCENE_LAYER_ROW_IDS = ['annotations', 'plants', 'zones'] as const
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
  readonly panelOpen: boolean
  readonly rows: readonly CanvasLayerPresentationRow[]
  readonly mapSurface: CanvasLayerPresentationMapSurface
  readonly hasVisibleMapLayer: boolean
}

export function readCanvasLayerPresentation(): CanvasLayerPresentation {
  void locale.value

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
      detail: { type: 'hillshade' },
    },
  ]

  const mapSurface = createCanvasLayerPresentationMapSurface(rows, visibility, opacities, hillshadeOn)

  return {
    panelOpen: layerPanelOpen.value,
    rows,
    mapSurface,
    hasVisibleMapLayer: mapSurface.hasVisibleMapLayer,
  }
}

export function setCanvasLayerPresentationPanelOpen(open: boolean): void {
  layerPanelOpen.value = open
}

export function toggleCanvasLayerPresentationPanel(): void {
  layerPanelOpen.value = !layerPanelOpen.value
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

export function toggleCanvasLayerPresentationVisibility(id: string): boolean {
  const row = readCanvasLayerPresentation().rows.find((entry) => entry.id === id)
  if (!row) return false
  return setCanvasLayerPresentationVisibility(id, !row.visible)
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

export function setCanvasLayerPresentationBasemapStyle(style: BasemapStyle): void {
  mutateSettingsProjection((settings) => {
    settings.basemapStyle = style
  }, { persist: 'queued' })
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function createCanvasLayerPresentationMapSurface(
  rows: readonly CanvasLayerPresentationRow[],
  visibility: Record<string, boolean>,
  opacities: Record<string, number>,
  hillshadeOn: boolean,
): CanvasLayerPresentationMapSurface {
  const base = rows.find((row) => row.id === 'base')
  const contours = rows.find((row) => row.id === 'contours')
  const hillshade = rows.find((row) => row.id === 'hillshading')

  const layerVisibility = {
    ...visibility,
    base: base?.visible ?? true,
    contours: contours?.visible ?? false,
  }
  const layerOpacity = {
    ...opacities,
    base: base?.opacity ?? 1,
    contours: contours?.opacity ?? 1,
  }
  const terrain = {
    contourIntervalMeters: contourIntervalMeters.value,
    contoursVisible: contours?.visible ?? false,
    contoursOpacity: contours?.opacity ?? 1,
    hillshadeVisible: hillshade?.visible ?? hillshadeOn,
    hillshadeOpacity: hillshade?.opacity ?? hillshadeOpacity.value,
  }

  return {
    hasVisibleMapLayer: layerVisibility.base || terrain.contoursVisible || terrain.hillshadeVisible,
    layerVisibility,
    layerOpacity,
    terrain,
  }
}
