import type {
  PanelTargetMapOverlayContract,
  PanelTargetMapOverlayFeatureCollection,
  PanelTargetMapOverlayVariant,
} from './panel-target-overlays'

interface MapLibreGeoJsonSource {
  setData(data: PanelTargetMapOverlayFeatureCollection): void
}

export interface MapLibreOverlayMap {
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): MapLibreGeoJsonSource | undefined
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
  setPaintProperty?(layerId: string, name: string, value: unknown): void
}

export function panelTargetMapOverlayIds(variant: PanelTargetMapOverlayVariant) {
  const sourceId = `panel-target-${variant}-source`
  return {
    sourceId,
    layerIds: [
      `panel-target-${variant}-zones-fill`,
      `panel-target-${variant}-zones-casing`,
      `panel-target-${variant}-zones-line`,
      `panel-target-${variant}-plants-halo`,
      `panel-target-${variant}-plants`,
    ] as const,
  }
}

export function clearPanelTargetMapOverlay(
  map: MapLibreOverlayMap,
  variant: PanelTargetMapOverlayVariant,
): void {
  const ids = panelTargetMapOverlayIds(variant)
  for (const layerId of [...ids.layerIds].reverse()) {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
  }
  if (map.getSource(ids.sourceId)) map.removeSource(ids.sourceId)
}

export function syncPanelTargetMapOverlay(
  map: MapLibreOverlayMap,
  overlay: PanelTargetMapOverlayContract,
): void {
  if (!overlay.hasRenderableFeatures) {
    clearPanelTargetMapOverlay(map, overlay.variant)
    return
  }

  const existingSource = map.getSource(overlay.source.id)
  if (existingSource) {
    existingSource.setData(overlay.source.data)
  } else {
    // The id names the source; MapLibre rejects it inside the specification.
    const { id, ...specification } = overlay.source
    map.addSource(id, specification as unknown as Record<string, unknown>)
  }

  for (const layer of overlay.layers) {
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer as unknown as Record<string, unknown>)
      continue
    }
    // The contract reads the current canvas colours; a layer added under
    // another theme or backdrop takes them without being re-added. MapLibre
    // ignores a paint value equal to the current one.
    for (const [name, value] of Object.entries(layer.paint)) map.setPaintProperty?.(layer.id, name, value)
  }
}
