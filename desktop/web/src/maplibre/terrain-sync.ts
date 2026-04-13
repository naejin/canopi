import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  buildContourPaints,
  buildHillshadePaint,
  createTerrainLayers,
  createTerrainSources,
  type TerrainLayerState,
  type TerrainProtocolSupport,
} from './terrain'

export interface TerrainSyncMap {
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): unknown
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
  setPaintProperty?(layerId: string, property: string, value: unknown): void
}

export type TerrainSyncMode = 'noop' | 'clear' | 'paint' | 'rebuild'

export function clearTerrain(map: TerrainSyncMap): void {
  const terrainLayerIds = [
    ...TERRAIN_CONTOUR_LAYER_IDS,
    TERRAIN_HILLSHADE_LAYER_ID,
  ]
  for (const layerId of terrainLayerIds) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  if (map.getSource(TERRAIN_CONTOUR_SOURCE_ID)) map.removeSource(TERRAIN_CONTOUR_SOURCE_ID)
  if (map.getSource(TERRAIN_DEM_SOURCE_ID)) map.removeSource(TERRAIN_DEM_SOURCE_ID)
}

export function classifyTerrainSync(
  previous: TerrainLayerState | null,
  next: TerrainLayerState,
): TerrainSyncMode {
  const nextVisible = next.contoursVisible || next.hillshadeVisible
  if (!nextVisible) return previous ? 'clear' : 'noop'
  if (!previous) return 'rebuild'

  const contourShapeChanged = next.contoursVisible && (
    !previous.contoursVisible
    || previous.contourIntervalMeters !== next.contourIntervalMeters
  )
  const hillshadeShapeChanged = previous.hillshadeVisible !== next.hillshadeVisible
  const contourVisibilityChangedWithoutSource = previous.contoursVisible !== next.contoursVisible

  if (
    contourShapeChanged
    || hillshadeShapeChanged
    || contourVisibilityChangedWithoutSource
  ) {
    return 'rebuild'
  }

  if (
    previous.contoursOpacity !== next.contoursOpacity
    || previous.hillshadeOpacity !== next.hillshadeOpacity
    || previous.isDark !== next.isDark
  ) {
    return 'paint'
  }

  return 'noop'
}

export function applyTerrainPaintUpdates(
  map: TerrainSyncMap,
  state: TerrainLayerState,
): void {
  if (state.hillshadeVisible && map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
    const paint = buildHillshadePaint(state)
    for (const [property, value] of Object.entries(paint)) {
      map.setPaintProperty?.(TERRAIN_HILLSHADE_LAYER_ID, property, value)
    }
  }

  if (state.contoursVisible) {
    const paints = buildContourPaints(state)
    if (map.getLayer(TERRAIN_CONTOUR_LAYER_IDS[0])) {
      for (const [property, value] of Object.entries(paints.minor)) {
        map.setPaintProperty?.(TERRAIN_CONTOUR_LAYER_IDS[0], property, value)
      }
    }
    if (map.getLayer(TERRAIN_CONTOUR_LAYER_IDS[1])) {
      for (const [property, value] of Object.entries(paints.major)) {
        map.setPaintProperty?.(TERRAIN_CONTOUR_LAYER_IDS[1], property, value)
      }
    }
  }
}

export function rebuildTerrain(
  map: TerrainSyncMap,
  protocols: TerrainProtocolSupport,
  state: TerrainLayerState,
): void {
  clearTerrain(map)

  const terrainSources = createTerrainSources(protocols, state)
  for (const { id, source } of terrainSources) {
    map.addSource(id, source)
  }

  const terrainLayers = createTerrainLayers(state)
  for (const layer of terrainLayers) {
    map.addLayer(layer)
  }
}
