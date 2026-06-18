import { rectsIntersect, type SimpleRect } from '../../operations'
import { getAnnotationWorldCorners, isPointInAnnotationText } from '../annotation-layout'
import {
  getPlantWorldBounds,
  hitTestPlant,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneZoneEntity,
} from '../scene'
import {
  getSceneGroupedMemberKeys,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberLayerName,
  sceneTargetKey,
  type SceneConcreteDesignObjectTarget,
} from '../scene'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  getEllipticalZonePolygon,
  getRectangularZoneCorners,
} from '../zone-geometry'

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
  return hitTestTopLevelWithLayerFilter(
    scene,
    point,
    viewportScale,
    speciesCache,
    getPlantContext,
    isLayerInteractive,
  )
}

export function hitTestVisibleTopLevel(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): TopLevelTarget | null {
  return hitTestTopLevelWithLayerFilter(
    scene,
    point,
    viewportScale,
    speciesCache,
    getPlantContext,
    isLayerVisible,
  )
}

function hitTestTopLevelWithLayerFilter(
  scene: ScenePersistedState,
  point: ScenePoint,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
  isLayerHitEligible: (scene: ScenePersistedState, layerName: string) => boolean,
): TopLevelTarget | null {
  const groupedMemberKeys = getSceneGroupedMemberKeys(scene)

  for (let i = scene.groups.length - 1; i >= 0; i -= 1) {
    const group = scene.groups[i]!
    const members = resolveSceneObjectGroupMembers(scene, group)
    if (!isGroupLayerHitEligible(scene, group, isLayerHitEligible, members)) continue
    for (const member of members) {
      const plant = member.kind === 'plant' ? scene.plants.find((entry) => entry.id === member.id) : null
      if (plant && hitTestPlant(plant, point, plantPresentationContext(getPlantContext, viewportScale, speciesCache))) {
        return { kind: 'group', id: group.id }
      }
      const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.name === member.id) : null
      if (zone && hitZone(zone, point, viewportScale)) return { kind: 'group', id: group.id }
      const annotation = member.kind === 'annotation'
        ? scene.annotations.find((entry) => entry.id === member.id)
        : null
      if (annotation && hitAnnotation(annotation, point, viewportScale)) return { kind: 'group', id: group.id }
    }
  }

  for (let i = scene.annotations.length - 1; i >= 0; i -= 1) {
    const annotation = scene.annotations[i]!
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))) continue
    if (!isLayerHitEligible(scene, 'annotations')) continue
    if (hitAnnotation(annotation, point, viewportScale)) return { kind: 'annotation', id: annotation.id }
  }

  for (let i = scene.plants.length - 1; i >= 0; i -= 1) {
    const plant = scene.plants[i]!
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))) continue
    if (!isLayerHitEligible(scene, 'plants')) continue
    if (hitTestPlant(plant, point, plantPresentationContext(getPlantContext, viewportScale, speciesCache))) {
      return { kind: 'plant', id: plant.id }
    }
  }

  for (let i = scene.zones.length - 1; i >= 0; i -= 1) {
    const zone = scene.zones[i]!
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))) continue
    if (!isLayerHitEligible(scene, 'zones')) continue
    if (hitZone(zone, point, viewportScale)) return { kind: 'zone', id: zone.name }
  }

  return null
}

function isGroupLayerHitEligible(
  scene: ScenePersistedState,
  _group: SceneObjectGroupEntity,
  isLayerHitEligible: (scene: ScenePersistedState, layerName: string) => boolean,
  members: readonly SceneConcreteDesignObjectTarget[],
): boolean {
  if (members.length === 0) return false
  return members.every((member) =>
    isLayerHitEligible(scene, sceneObjectGroupMemberLayerName(member)),
  )
}

export function queryRectTopLevel(
  scene: ScenePersistedState,
  rect: SimpleRect,
  viewportScale: number,
  speciesCache: ReadonlyMap<string, SpeciesCacheEntry>,
  getPlantContext: (viewportScale: number) => PlantPresentationContext,
): TopLevelTarget[] {
  const targets: TopLevelTarget[] = []
  const groupedMemberKeys = getSceneGroupedMemberKeys(scene)

  for (const group of scene.groups) {
    const members = resolveSceneObjectGroupMembers(scene, group)
    if (!isGroupLayerHitEligible(scene, group, isLayerInteractive, members)) continue
    const hit = members.some((member) => {
      const plant = member.kind === 'plant' ? scene.plants.find((entry) => entry.id === member.id) : null
      if (plant && rectsIntersect(rect, plantBounds(plant, viewportScale, speciesCache, getPlantContext))) return true
      const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.name === member.id) : null
      if (zone && zoneIntersectsRect(zone, rect)) return true
      const annotation = member.kind === 'annotation'
        ? scene.annotations.find((entry) => entry.id === member.id)
        : null
      return annotation ? annotationIntersectsRect(annotation, rect, viewportScale) : false
    })
    if (hit) targets.push({ kind: 'group', id: group.id })
  }

  for (const plant of scene.plants) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))) continue
    if (!isLayerInteractive(scene, 'plants')) continue
    if (rectsIntersect(rect, plantBounds(plant, viewportScale, speciesCache, getPlantContext))) {
      targets.push({ kind: 'plant', id: plant.id })
    }
  }

  for (const zone of scene.zones) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name }))) continue
    if (!isLayerInteractive(scene, 'zones')) continue
    if (zoneIntersectsRect(zone, rect)) targets.push({ kind: 'zone', id: zone.name })
  }

  for (const annotation of scene.annotations) {
    if (groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id }))) continue
    if (!isLayerInteractive(scene, 'annotations')) continue
    if (annotationIntersectsRect(annotation, rect, viewportScale)) {
      targets.push({ kind: 'annotation', id: annotation.id })
    }
  }

  return targets
}

const LINE_HIT_TOLERANCE_PX = 6
const ELLIPSE_BOUNDARY_MAX_SAGITTA_PX = LINE_HIT_TOLERANCE_PX / 2
const MIN_ELLIPSE_BOUNDARY_SEGMENTS = 48

function hitZone(zone: SceneZoneEntity, point: ScenePoint, viewportScale: number): boolean {
  const toleranceWorld = LINE_HIT_TOLERANCE_PX / Math.max(viewportScale, 1e-6)

  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? pointNearPolygonBoundary(point, corners, toleranceWorld) : false
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const polygon = getEllipticalZonePolygon(zone, ellipseBoundarySegmentCount(zone, viewportScale))
    return polygon ? pointNearPolygonBoundary(point, polygon, toleranceWorld) : false
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return pointNearPolygonBoundary(point, zone.points, toleranceWorld)
  }

  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return pointNearSegment(point, zone.points[0]!, zone.points[1]!, toleranceWorld)
  }

  const bounds = zoneBounds(zone)
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

function zoneIntersectsRect(zone: SceneZoneEntity, rect: SimpleRect): boolean {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? polygonIntersectsRect(corners, rect) : false
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const polygon = getEllipticalZonePolygon(zone)
    return polygon ? polygonIntersectsRect(polygon, rect) : false
  }

  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return segmentIntersectsRect(zone.points[0]!, zone.points[1]!, rect)
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return polygonIntersectsRect(zone.points, rect)
  }

  return rectsIntersect(rect, zoneBounds(zone))
}

function ellipseBoundarySegmentCount(zone: SceneZoneEntity, viewportScale: number): number {
  const radii = zone.points[1]!
  const maxRadiusPx = Math.max(Math.abs(radii.x), Math.abs(radii.y)) * Math.max(viewportScale, 1e-6)
  if (maxRadiusPx <= ELLIPSE_BOUNDARY_MAX_SAGITTA_PX) return MIN_ELLIPSE_BOUNDARY_SEGMENTS
  const halfAngle = Math.acos(1 - (ELLIPSE_BOUNDARY_MAX_SAGITTA_PX / maxRadiusPx))
  if (!Number.isFinite(halfAngle) || halfAngle <= 0) return MIN_ELLIPSE_BOUNDARY_SEGMENTS
  return Math.max(MIN_ELLIPSE_BOUNDARY_SEGMENTS, Math.ceil(Math.PI / halfAngle))
}

function polygonIntersectsRect(polygon: readonly ScenePoint[], rect: SimpleRect): boolean {
  if (!rectsIntersect(rect, pointsBounds(polygon))) return false

  const rectPoint = rect.width <= GEOMETRY_EPSILON && rect.height <= GEOMETRY_EPSILON
  if (rectPoint) return pointInOrOnPolygon({ x: rect.x, y: rect.y }, polygon)

  if (polygon.some((point) => pointInRect(point, rect))) return true

  const corners = rectCorners(rect)
  if (corners.some((corner) => pointInOrOnPolygon(corner, polygon))) return true

  const rectEdges = rectEdgeSegments(corners)
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    if (rectEdges.some(([rectStart, rectEnd]) => segmentsIntersect(start, end, rectStart, rectEnd))) return true
  }

  return false
}

function segmentIntersectsRect(start: ScenePoint, end: ScenePoint, rect: SimpleRect): boolean {
  if (!rectsIntersect(pointsBounds([start, end]), rect)) return false

  const rectPoint = rect.width <= GEOMETRY_EPSILON && rect.height <= GEOMETRY_EPSILON
  if (rectPoint) return pointOnSegment({ x: rect.x, y: rect.y }, start, end)

  if (pointInRect(start, rect) || pointInRect(end, rect)) return true

  return rectEdgeSegments(rectCorners(rect))
    .some(([rectStart, rectEnd]) => segmentsIntersect(start, end, rectStart, rectEnd))
}

const GEOMETRY_EPSILON = 0.000001

function pointInOrOnPolygon(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  return pointOnPolygonBoundary(point, polygon) || pointInPolygon(point, polygon)
}

function pointInPolygon(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]!
    const previous = polygon[previousIndex]!
    const crossesY = (current.y > point.y) !== (previous.y > point.y)
    if (!crossesY) continue

    const intersectionX = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (point.x < intersectionX) inside = !inside
  }

  return inside
}

function pointOnPolygonBoundary(point: ScenePoint, polygon: readonly ScenePoint[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!)) return true
  }

  return false
}

function pointNearPolygonBoundary(
  point: ScenePoint,
  polygon: readonly ScenePoint[],
  tolerance: number,
): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointNearSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!, tolerance)) {
      return true
    }
  }

  return false
}

function pointInRect(point: ScenePoint, rect: SimpleRect): boolean {
  return (
    point.x >= rect.x - GEOMETRY_EPSILON &&
    point.x <= rect.x + rect.width + GEOMETRY_EPSILON &&
    point.y >= rect.y - GEOMETRY_EPSILON &&
    point.y <= rect.y + rect.height + GEOMETRY_EPSILON
  )
}

function rectCorners(rect: SimpleRect): ScenePoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
}

function rectEdgeSegments(corners: readonly ScenePoint[]): Array<[ScenePoint, ScenePoint]> {
  return [
    [corners[0]!, corners[1]!],
    [corners[1]!, corners[2]!],
    [corners[2]!, corners[3]!],
    [corners[3]!, corners[0]!],
  ]
}

function segmentsIntersect(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint): boolean {
  if (
    pointOnSegment(a, c, d) ||
    pointOnSegment(b, c, d) ||
    pointOnSegment(c, a, b) ||
    pointOnSegment(d, a, b)
  ) {
    return true
  }

  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)

  const crossesAb = (abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON)
    || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)
  const crossesCd = (cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON)
    || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON)
  return crossesAb && crossesCd
}

function pointOnSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint): boolean {
  const cross = orientation(start, end, point)
  if (Math.abs(cross) > GEOMETRY_EPSILON) return false

  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
  )
}

function pointNearSegment(point: ScenePoint, start: ScenePoint, end: ScenePoint, tolerance: number): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= GEOMETRY_EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const projected = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  }
  return Math.hypot(point.x - projected.x, point.y - projected.y) <= tolerance + GEOMETRY_EPSILON
}

function orientation(a: ScenePoint, b: ScenePoint, c: ScenePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
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

  return pointsBounds(zone.points)
}

function pointsBounds(points: readonly ScenePoint[]): SimpleRect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function hitAnnotation(annotation: SceneAnnotationEntity, point: ScenePoint, viewportScale: number): boolean {
  return isPointInAnnotationText(annotation, point, viewportScale)
}

function annotationIntersectsRect(
  annotation: SceneAnnotationEntity,
  rect: SimpleRect,
  viewportScale: number,
): boolean {
  return polygonIntersectsRect(getAnnotationWorldCorners(annotation, viewportScale), rect)
}

function isLayerInteractive(scene: ScenePersistedState, layerName: string): boolean {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return layer?.visible !== false && layer?.locked !== true
}

function isLayerVisible(scene: ScenePersistedState, layerName: string): boolean {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return layer?.visible !== false
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
