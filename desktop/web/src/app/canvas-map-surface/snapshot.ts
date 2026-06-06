import {
  layerOpacity,
  layerVisibility,
} from '../canvas-settings/signals'
import { readSavedLocationPresentation } from '../location'
import { basemapStyle, theme } from '../settings/state'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { northBearingDeg } from '../../canvas/scene-metadata-state'
import type { CanvasMapSurfaceSnapshot } from './lifecycle'

export type CanvasMapSurfaceCoreSnapshot = Pick<
  CanvasMapSurfaceSnapshot,
  | 'runtime'
  | 'location'
  | 'northBearingDeg'
  | 'basemapStyle'
  | 'layerVisibility'
  | 'layerOpacity'
  | 'theme'
>

export function readCanvasMapSurfaceCoreSnapshot(): CanvasMapSurfaceCoreSnapshot {
  const runtime = currentCanvasQuerySurface.value
  void runtime?.revision.scene.value
  void runtime?.revision.viewport.value

  const location = readSavedLocationPresentation().location

  return {
    runtime,
    location: location ? { lat: location.lat, lon: location.lon } : null,
    northBearingDeg: northBearingDeg.value,
    basemapStyle: basemapStyle.value,
    layerVisibility: { ...layerVisibility.value },
    layerOpacity: { ...layerOpacity.value },
    theme: theme.value,
  }
}
