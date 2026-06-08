import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import type { BasemapStyle } from '../../generated/contracts'
import type { TerrainLayerState } from '../../maplibre/terrain'
import type { PanelTarget } from '../../types/design'

export interface CanvasMapSurfaceSnapshot {
  readonly runtime: CanvasQuerySurface | null
  readonly location: { lat: number; lon: number } | null
  readonly northBearingDeg: number | null
  readonly basemapStyle: BasemapStyle
  readonly hasVisibleMapLayer: boolean
  readonly layerVisibility: Record<string, boolean>
  readonly layerOpacity: Record<string, number>
  readonly terrain: TerrainLayerState
  readonly hoveredTargets: readonly PanelTarget[]
  readonly selectedTargets: readonly PanelTarget[]
  readonly theme: 'light' | 'dark'
}
