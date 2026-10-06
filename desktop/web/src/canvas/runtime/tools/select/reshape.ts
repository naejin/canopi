// canvas/runtime/tools/select/reshape.ts
//
// Owns the reshape handles of the one selected zone under Select: a line's two ends and a polygon's vertices ('vertex'), a rectangle's four corners ('corner') and an ellipse's four
// axis ends ('vertex'), as ToolHandle data the host shows through the handle layer, and the geometry of dragging one
// (a 0.5 m minimum side, a 0.25 m² minimum polygon area). The drag itself is point-handle.ts's, edit type
// 'interaction-zone-control-point'. Each handle's label is translated ('canvas.zoneControlPoint.label').

import type { ToolHandleId } from '../../interaction-types'
import type { CanvasDesignObjectSelectionModel } from '../../runtime'
import { singleEditableTarget } from '../../scene-runtime/selection'
import type { ScenePersistedState, SceneZoneEntity } from '../../scene/types'
import type { WorldPoint } from '../../view/types'
import { getRectangularZoneCorners, polygonArea } from '../../zone-geometry'
import type { ToolHandle } from '../draft'
import type { ToolContext } from '../tool'
import type { PointHandleSubject } from './point-handle'

export type ZoneControlPointKind =
  | 'line-endpoint'
  | 'polygon-vertex'
  | 'rect-corner'
  | 'ellipse-east'
  | 'ellipse-west'
  | 'ellipse-north'
  | 'ellipse-south'

/** One reshape handle: which point of which zone it moves. */
export interface ZoneControlPoint {
  readonly id: ToolHandleId
  readonly zoneId: string
  readonly kind: ZoneControlPointKind
  readonly index: number
  readonly world: WorldPoint
}

const MIN_ZONE_DIMENSION_M = 0.5
const MIN_POLYGON_AREA_M2 = 0.25
const GEOMETRY_EPSILON = 0.000001
/** A 20 px target. */
const POINT_HIT_RADIUS_PX = 10
const RECT_CORNER_NAMES = ['nw', 'ne', 'se', 'sw'] as const
const ELLIPSE_AXIS_NAMES = { 'ellipse-east': 'east', 'ellipse-west': 'west', 'ellipse-north': 'north', 'ellipse-south': 'south' } as const

/** The one selected zone the reshape handles belong to: a single editable zone, nothing locked or blocked. */
export function reshapableZone(
  scene: Readonly<ScenePersistedState>,
  selection: CanvasDesignObjectSelectionModel,
): SceneZoneEntity | null {
  const target = singleEditableTarget(selection, 'zone')
  return target ? scene.zones.find((zone) => zone.id === target.id) ?? null : null
}

/** The zone's reshape points, in the order of their labels' indices. */
export function zoneControlPoints(zone: SceneZoneEntity): ZoneControlPoint[] {
  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return zone.points.slice(0, 2).map((world, index) => point(zone, 'line-endpoint', index, world, `vertex:${zone.id}:${index}`))
  }
  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return zone.points.map((world, index) => point(zone, 'polygon-vertex', index, world, `vertex:${zone.id}:${index}`))
  }
  if (zone.zoneType === 'rect') {
    return getRectangularZoneCorners(zone)?.map((world, index) =>
      point(zone, 'rect-corner', index, world, `rect-corner:${zone.id}:${RECT_CORNER_NAMES[index]}`)) ?? []
  }
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    const axis = (kind: keyof typeof ELLIPSE_AXIS_NAMES, index: number, offset: WorldPoint): ZoneControlPoint =>
      point(zone, kind, index, offsetRotated(center, offset, zone.rotationDeg), `ellipse-axis:${zone.id}:${ELLIPSE_AXIS_NAMES[kind]}`)
    return [
      axis('ellipse-east', 0, { x: Math.abs(radii.x), y: 0 }),
      axis('ellipse-west', 1, { x: -Math.abs(radii.x), y: 0 }),
      axis('ellipse-north', 2, { x: 0, y: -Math.abs(radii.y) }),
      axis('ellipse-south', 3, { x: 0, y: Math.abs(radii.y) }),
    ]
  }
  return []
}

/** The handles the host draws for `points`. */
export function zoneControlPointHandles(points: readonly ZoneControlPoint[], translate: ToolContext['translate']): ToolHandle[] {
  return points.map((entry) => ({
    id: entry.id,
    anchor: entry.world,
    hitRadiusPx: POINT_HIT_RADIUS_PX,
    glyph: entry.kind === 'rect-corner' ? 'corner' : 'vertex',
    label: translate('canvas.zoneControlPoint.label', { index: entry.index + 1 }),
  }))
}

/** What dragging `controlPoint` edits. */
export function zoneReshapeSubject(zone: SceneZoneEntity, controlPoint: ZoneControlPoint): PointHandleSubject<SceneZoneEntity> {
  return {
    editType: 'interaction-zone-control-point',
    entityId: zone.id,
    start: cloneZone(zone),
    reshape: (start, dragged) => reshapeZone(start, controlPoint, dragged),
    equal: zonesEqual,
    write(draft, zoneId, next) {
      draft.zones = draft.zones.map((entry) => entry.id === zoneId ? next : entry)
    },
  }
}

/** The zone with `controlPoint` at `dragged`, or null where it would be smaller than the minimum. */
function reshapeZone(
  zone: SceneZoneEntity,
  controlPoint: Pick<ZoneControlPoint, 'kind' | 'index'>,
  dragged: WorldPoint,
): SceneZoneEntity | null {
  if (zone.zoneType === 'line') return reshapeLinearZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'polygon') return reshapePolygonalZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'rect') return reshapeRectangularZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'ellipse') return reshapeEllipticalZone(zone, controlPoint.kind, dragged)
  return null
}

function cloneZone(zone: SceneZoneEntity): SceneZoneEntity {
  return { ...zone, points: zone.points.map((entry) => ({ ...entry })) }
}

function zonesEqual(a: SceneZoneEntity, b: SceneZoneEntity): boolean {
  if (a.rotationDeg !== b.rotationDeg || a.points.length !== b.points.length) return false
  return a.points.every((entry, index) => pointsEqual(entry, b.points[index]!))
}

function point(
  zone: SceneZoneEntity,
  kind: ZoneControlPointKind,
  index: number,
  world: WorldPoint,
  id: string,
): ZoneControlPoint {
  return { id: id as ToolHandleId, zoneId: zone.id, kind, index, world }
}

function reshapeLinearZone(zone: SceneZoneEntity, index: number, dragged: WorldPoint): SceneZoneEntity | null {
  if (zone.points.length < 2 || index < 0 || index > 1) return null
  const points = zone.points.map((entry, pointIndex) => (pointIndex === index ? cleanPoint(dragged) : { ...entry }))
  if (distance(points[0]!, points[1]!) < MIN_ZONE_DIMENSION_M) return null
  return { ...zone, points }
}

function reshapePolygonalZone(zone: SceneZoneEntity, index: number, dragged: WorldPoint): SceneZoneEntity | null {
  if (zone.points.length < 3 || index < 0 || index >= zone.points.length) return null
  const points = zone.points.map((entry, pointIndex) => (pointIndex === index ? cleanPoint(dragged) : { ...entry }))
  if (Math.abs(polygonArea(points)) < MIN_POLYGON_AREA_M2) return null
  return { ...zone, points, rotationDeg: 0 }
}

function reshapeRectangularZone(zone: SceneZoneEntity, index: number, dragged: WorldPoint): SceneZoneEntity | null {
  const corners = getRectangularZoneCorners(zone)
  if (!corners || index < 0 || index >= 4) return null
  const anchor = corners[(index + 2) % 4]!
  const localDelta = rotateVector({ x: dragged.x - anchor.x, y: dragged.y - anchor.y }, -zone.rotationDeg)
  const width = Math.abs(localDelta.x)
  const height = Math.abs(localDelta.y)
  if (width < MIN_ZONE_DIMENSION_M || height < MIN_ZONE_DIMENSION_M) return null
  return { ...zone, points: rectPointsAroundCenter(midpoint(anchor, dragged), width, height) }
}

function reshapeEllipticalZone(zone: SceneZoneEntity, kind: ZoneControlPointKind, dragged: WorldPoint): SceneZoneEntity | null {
  if (zone.points.length < 2) return null
  const center = zone.points[0]!
  const radii = zone.points[1]!
  const xAxis = rotateVector({ x: 1, y: 0 }, zone.rotationDeg)
  const yAxis = rotateVector({ x: 0, y: 1 }, zone.rotationDeg)

  if (kind === 'ellipse-east' || kind === 'ellipse-west') {
    const direction = kind === 'ellipse-east' ? 1 : -1
    const anchor = {
      x: center.x - xAxis.x * direction * Math.abs(radii.x),
      y: center.y - xAxis.y * direction * Math.abs(radii.x),
    }
    const projected = projectPointOnAxisFromAnchor(anchor, dragged, xAxis)
    const radius = Math.abs(projected.distanceAlongAxis) / 2
    if (radius < MIN_ZONE_DIMENSION_M / 2) return null
    return { ...zone, points: [cleanPoint(projected.center), { x: cleanMetric(radius), y: Math.abs(radii.y) }] }
  }

  if (kind === 'ellipse-north' || kind === 'ellipse-south') {
    const direction = kind === 'ellipse-south' ? 1 : -1
    const anchor = {
      x: center.x - yAxis.x * direction * Math.abs(radii.y),
      y: center.y - yAxis.y * direction * Math.abs(radii.y),
    }
    const projected = projectPointOnAxisFromAnchor(anchor, dragged, yAxis)
    const radius = Math.abs(projected.distanceAlongAxis) / 2
    if (radius < MIN_ZONE_DIMENSION_M / 2) return null
    return { ...zone, points: [cleanPoint(projected.center), { x: Math.abs(radii.x), y: cleanMetric(radius) }] }
  }

  return null
}

function projectPointOnAxisFromAnchor(
  anchor: WorldPoint,
  target: WorldPoint,
  axis: WorldPoint,
): { center: WorldPoint; distanceAlongAxis: number } {
  const distanceAlongAxis = dot({ x: target.x - anchor.x, y: target.y - anchor.y }, axis)
  return {
    distanceAlongAxis,
    center: { x: anchor.x + axis.x * distanceAlongAxis / 2, y: anchor.y + axis.y * distanceAlongAxis / 2 },
  }
}

function offsetRotated(center: WorldPoint, offset: WorldPoint, degrees: number): WorldPoint {
  const rotated = rotateVector(offset, degrees)
  return { x: cleanMetric(center.x + rotated.x), y: cleanMetric(center.y + rotated.y) }
}

function rotateVector(vector: WorldPoint, degrees: number): WorldPoint {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: cleanMetric(vector.x * cos - vector.y * sin), y: cleanMetric(vector.x * sin + vector.y * cos) }
}

function rectPointsAroundCenter(center: WorldPoint, width: number, height: number): WorldPoint[] {
  const halfWidth = width / 2
  const halfHeight = height / 2
  return [
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y + halfHeight) },
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y + halfHeight) },
  ]
}

function pointsEqual(a: WorldPoint, b: WorldPoint): boolean {
  return Math.abs(a.x - b.x) < GEOMETRY_EPSILON && Math.abs(a.y - b.y) < GEOMETRY_EPSILON
}

function cleanPoint(entry: WorldPoint): WorldPoint {
  return { x: cleanMetric(entry.x), y: cleanMetric(entry.y) }
}

function midpoint(a: WorldPoint, b: WorldPoint): WorldPoint {
  return { x: cleanMetric((a.x + b.x) / 2), y: cleanMetric((a.y + b.y) / 2) }
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function dot(a: WorldPoint, b: WorldPoint): number {
  return a.x * b.x + a.y * b.y
}

function cleanMetric(value: number): number {
  return Math.abs(value) < GEOMETRY_EPSILON ? 0 : value
}
