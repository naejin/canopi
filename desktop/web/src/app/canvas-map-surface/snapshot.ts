import { readCanvasLayerPresentation } from '../canvas-layer-presentation/presentation'
import { readSavedLocationPresentation } from '../location'
import { readPanelTargetOverlaySnapshot } from '../panel-targets/presentation'
import { basemapStyle, theme } from '../settings/state'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { northBearingDeg } from '../../canvas/scene-metadata-state'
import type { CanvasMapSurfaceSnapshot } from './types'

export type CanvasMapSurfaceCoreSnapshot = Pick<
  CanvasMapSurfaceSnapshot,
  | 'runtime'
  | 'location'
  | 'northBearingDeg'
  | 'basemapStyle'
  | 'hasVisibleMapLayer'
  | 'layerVisibility'
  | 'layerOpacity'
  | 'theme'
>

export function readCanvasMapSurfaceCoreSnapshot(): CanvasMapSurfaceCoreSnapshot {
  const runtime = currentCanvasQuerySurface.value
  void runtime?.revision.scene.value
  void runtime?.revision.viewport.value

  const location = readSavedLocationPresentation().location
  const layerPresentation = readCanvasLayerPresentation()

  return {
    runtime,
    location: location ? { lat: location.lat, lon: location.lon } : null,
    northBearingDeg: northBearingDeg.value,
    basemapStyle: basemapStyle.value,
    hasVisibleMapLayer: layerPresentation.mapSurface.hasVisibleMapLayer,
    layerVisibility: { ...layerPresentation.mapSurface.layerVisibility },
    layerOpacity: { ...layerPresentation.mapSurface.layerOpacity },
    theme: theme.value,
  }
}

export function readCanvasMapSurfaceSnapshot(): CanvasMapSurfaceSnapshot {
  const coreSnapshot = readCanvasMapSurfaceCoreSnapshot()
  const { hoveredTargets, selectedTargets } = readPanelTargetOverlaySnapshot()

  return {
    ...coreSnapshot,
    terrain: {
      ...readCanvasLayerPresentation().mapSurface.terrain,
      isDark: coreSnapshot.theme === 'dark',
    },
    hoveredTargets: [...hoveredTargets],
    selectedTargets: [...selectedTargets],
  }
}
