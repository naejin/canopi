import type { CanvasPrintSnapshot, PrintMarkPath } from '../print'
import { resolvePlantBaseColor, type PlantPresentationContext } from './plant-presentation'
import { resolvePlantSymbolForPlant, type ScenePersistedState } from './scene'
import { getPlantSymbolShapes, plantSymbolShapePath, type PlantSymbolShape } from './plant-symbol-recipes'
import { getRectangularZoneCorners, getZoneWorldBounds } from './zone-geometry'

export function buildCanvasPrintSnapshot(
  scene: ScenePersistedState,
  context: PlantPresentationContext,
): CanvasPrintSnapshot {
  return {
    layers: scene.layers.map(({ name, visible, opacity }) => ({ name, visible, opacity })),
    plants: scene.plants.map((plant) => {
      const symbol = resolvePlantSymbolForPlant(plant, scene.plantSpeciesSymbols)
      return { id: plant.id, canonicalName: plant.canonicalName, speciesCode: scene.plantSpeciesCodes[plant.canonicalName], position: { ...plant.position },
        color: resolvePlantBaseColor(plant, context.speciesCache), symbol,
        mark: getPlantSymbolShapes(symbol, 24).map(markPath),
        smallMark: getPlantSymbolShapes(symbol, 12).map(markPath), pinnedName: plant.pinnedName === true }
    }),
    zones: scene.zones.flatMap((zone) => {
      const bounds = getZoneWorldBounds(zone)
      if (!bounds) return []
      const points = getRectangularZoneCorners(zone) ?? zone.points
      const path = zone.zoneType === 'ellipse' && points.length >= 2
        ? ellipsePath(points[0]!.x, points[0]!.y, Math.abs(points[1]!.x), Math.abs(points[1]!.y), zone.rotationDeg)
        : points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ') + (zone.zoneType === 'line' ? '' : ' Z')
      if (zone.fillColor && !/^(#[\da-f]{3,8}|rgba?\([\d.,\s]+\)|[a-z]+)$/i.test(zone.fillColor)) throw new Error('unsupported-print-color')
      return [{ name: zone.name, path, bounds, fill: zone.zoneType === 'line' ? null : zone.fillColor }]
    }),
    annotations: scene.annotations.map((annotation) => ({ id: annotation.id, position: { ...annotation.position },
      text: annotation.text, fontSize: annotation.fontSize, rotation: annotation.rotationDeg ?? 0 })),
    measurements: scene.measurementGuides.map(({ id, start, end }) => ({ id, start: { ...start }, end: { ...end } })),
  }
}

function markPath(shape: PlantSymbolShape): PrintMarkPath {
  return { d: plantSymbolShapePath(shape), fill: true, stroke: false, strokeWidth: 0 }
}

// Cubic ellipse representation is shared by PDF and preview, including rotation.
function ellipsePath(cx: number, cy: number, rx: number, ry: number, rotation: number): string {
  const k = 0.5522847498307936
  const angle = rotation * Math.PI / 180
  const point = (x: number, y: number) => `${cx + x * rx * Math.cos(angle) - y * ry * Math.sin(angle)} ${cy + x * rx * Math.sin(angle) + y * ry * Math.cos(angle)}`
  return `M${point(1, 0)} C${point(1, k)} ${point(k, 1)} ${point(0, 1)} C${point(-k, 1)} ${point(-1, k)} ${point(-1, 0)} C${point(-1, -k)} ${point(-k, -1)} ${point(0, -1)} C${point(k, -1)} ${point(1, -k)} ${point(1, 0)} Z`
}
