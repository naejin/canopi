import { rectsIntersect, type SimpleRect } from '../../operations'
import { getAnnotationWorldBounds } from '../annotation-layout'
import {
  getPlantWorldBounds,
  hitTestPlant,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  SceneAnnotationEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'

export type TopLevelTarget =
  | { kind: 'plant'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'annotation'; id: string }
  | { kind: 'group'; id: string }

export function hitTestTopLevel(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): TopLevelTarget | null {
  const groupedMembers = new Set(scene.groups.flatMap((group) => group.memberIds))

  for (let i = scene.groups.length - 1; i >= 0; i -= 1) {
    const group = scene.groups[i]!
    if (!isLayerInteractive(scene, group.layer)) continue
    for (const memberId of group.memberIds) {
      const plant = scene.plants.find((entry) => entry.id === memberId)
      if (plant && hitTestPlant(plant, point, plantPresentationContext(getPlantContext, viewportScale, speciesCache))) {
        return { kind: 'group', id: group.id }
      }
      const zone = scene.zones.find((entry) => entry.name === memberId)
      if (zone && hitZone(zone, point)) return { kind: 'group', id: group.id }
      const annotation = scene.annotations.find((entry) => entry.id === memberId)
      if (annotation && hitAnnotation(annotation, point, viewportScale)) return { kind: 'group', id: group.id }
    }
  }

  for (let i = scene.annotations.length - 1; i >= 0; i -= 1) {
    const annotation = scene.annotations[i]!
    if (groupedMembers.has(annotation.id)) continue
    if (!isLayerInteractive(scene, 'annotations')) continue
    if (hitAnnotation(annotation, point, viewportScale)) return { kind: 'annotation', id: annotation.id }
  }

  for (let i = scene.plants.length - 1; i >= 0; i -= 1) {
    const plant = scene.plants[i]!
    if (groupedMembers.has(plant.id)) continue
    if (!isLayerInteractive(scene, 'plants')) continue
    if (hitTestPlant(plant, point, plantPresentationContext(getPlantContext, viewportScale, speciesCache))) {
      return { kind: 'plant', id: plant.id }
    }
  }

  for (let i = scene.zones.length - 1; i >= 0; i -= 1) {
    const zone = scene.zones[i]!
    if (groupedMembers.has(zone.name)) continue
    if (!isLayerInteractive(scene, 'zones')) continue
    if (hitZone(zone, point)) return { kind: 'zone', id: zone.name }
  }

  return null
}

export function queryRectTopLevel(
  scene: ScenePersistedState,
  rect: SimpleRect,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): TopLevelTarget[] {
  const targets: TopLevelTarget[] = []
  const groupedMembers = new Set(scene.groups.flatMap((group) => group.memberIds))

  for (const group of scene.groups) {
    if (!isLayerInteractive(scene, group.layer)) continue
    const hit = group.memberIds.some((memberId) => {
      const plant = scene.plants.find((entry) => entry.id === memberId)
      if (plant && rectsIntersect(rect, plantBounds(plant, viewportScale, speciesCache, getPlantContext))) return true
      const zone = scene.zones.find((entry) => entry.name === memberId)
      if (zone && rectsIntersect(rect, zoneBounds(zone))) return true
      const annotation = scene.annotations.find((entry) => entry.id === memberId)
      return annotation ? rectsIntersect(rect, annotationBounds(annotation, viewportScale)) : false
    })
    if (hit) targets.push({ kind: 'group', id: group.id })
  }

  for (const plant of scene.plants) {
    if (groupedMembers.has(plant.id)) continue
    if (!isLayerInteractive(scene, 'plants')) continue
    if (rectsIntersect(rect, plantBounds(plant, viewportScale, speciesCache, getPlantContext))) {
      targets.push({ kind: 'plant', id: plant.id })
    }
  }

  for (const zone of scene.zones) {
    if (groupedMembers.has(zone.name)) continue
    if (!isLayerInteractive(scene, 'zones')) continue
    if (rectsIntersect(rect, zoneBounds(zone))) targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of scene.annotations) {
    if (groupedMembers.has(annotation.id)) continue
    if (!isLayerInteractive(scene, 'annotations')) continue
    if (rectsIntersect(rect, annotationBounds(annotation, viewportScale))) {
      targets.push({ kind: 'annotation', id: annotation.id })
    }
  }

  return targets
}

function hitZone(zone: SceneZoneEntity, point: ScenePoint): boolean {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const bounds = zoneBounds(zone)
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    const nx = (point.x - center.x) / Math.max(radii.x, 0.001)
    const ny = (point.y - center.y) / Math.max(radii.y, 0.001)
    return nx * nx + ny * ny <= 1
  }

  const bounds = zoneBounds(zone)
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

function plantBounds(
  plant: ScenePlantEntity,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): SimpleRect {
  return getPlantWorldBounds(plant, plantPresentationContext(getPlantContext, viewportScale, speciesCache))
}

function zoneBounds(zone: SceneZoneEntity): SimpleRect {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return {
      x: center.x - radii.x,
      y: center.y - radii.y,
      width: radii.x * 2,
      height: radii.y * 2,
    }
  }

  const xs = zone.points.map((point) => point.x)
  const ys = zone.points.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function hitAnnotation(annotation: SceneAnnotationEntity, point: ScenePoint, viewportScale: number): boolean {
  const bounds = getAnnotationWorldBounds(annotation, viewportScale)
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

function annotationBounds(annotation: SceneAnnotationEntity, viewportScale: number): SimpleRect {
  return getAnnotationWorldBounds(annotation, viewportScale)
}

function isLayerInteractive(scene: ScenePersistedState, layerName: string): boolean {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return layer?.visible !== false && layer?.locked !== true
}

function plantPresentationContext(
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry> = new Map(),
): PlantPresentationContext {
  const base = getPlantContext(viewportScale)
  return {
    ...base,
    viewport: {
      ...base.viewport,
      x: 0,
      y: 0,
      scale: viewportScale,
    },
    speciesCache,
  }
}
