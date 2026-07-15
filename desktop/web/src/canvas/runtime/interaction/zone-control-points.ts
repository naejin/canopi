import type { CameraController } from '../camera'
import type { CanvasDesignObjectSelectionModel } from '../runtime'
import type { ScenePoint, SceneStateReader, SceneZoneEntity } from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { getRectangularZoneCorners } from '../zone-geometry'
import {
  createControlPointOverlay,
  type ControlPointOverlayAdapter,
  type ControlPointOverlayController,
  type ControlPointOverlayPoint,
} from './control-point-overlay'

interface ZoneControlPointOptions {
  readonly container: HTMLElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStateReader
  readonly getSelection: () => CanvasDesignObjectSelectionModel
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly render: (kind: 'scene' | 'viewport') => void
  readonly refreshSelectionDependent: () => void
  readonly beginDragPresentation: () => void
  readonly endDragPresentation: () => void
}

export type ZoneControlPointController = ControlPointOverlayController

type ZoneControlPointKind =
  | 'line-endpoint'
  | 'polygon-vertex'
  | 'rect-corner'
  | 'ellipse-east'
  | 'ellipse-west'
  | 'ellipse-north'
  | 'ellipse-south'

interface ZoneControlPoint extends ControlPointOverlayPoint {
  readonly zoneId: string
  readonly kind: ZoneControlPointKind
  readonly index: number
}

const MIN_ZONE_DIMENSION_M = 0.5
const MIN_POLYGON_AREA_M2 = 0.25
const GEOMETRY_EPSILON = 0.000001

export function createZoneControlPoints(
  options: ZoneControlPointOptions,
): ZoneControlPointController {
  const adapter: ControlPointOverlayAdapter<SceneZoneEntity, ZoneControlPoint> = {
    editType: 'interaction-zone-control-point',
    rootDataAttribute: 'zoneControlPoints',
    activeDataAttribute: 'zoneControlPointActive',
    getEligibleEntity: eligibleSelectedZone,
    getEntityId: (zone) => zone.name,
    ownsControlPoint: (zone, point) => zone.name === point.zoneId,
    cloneEntity: cloneZone,
    createControlPoints: createZoneControlPointsForZone,
    reshape: reshapeZone,
    entitiesEqual: zonesEqual,
    writeDraft(draft, zoneId, nextZone) {
      draft.zones = draft.zones.map((zone) => zone.name === zoneId ? nextZone : zone)
    },
    decorateHandle(handle, point, screen) {
      handle.dataset.zoneControlPoint = point.id
      handle.dataset.zoneControlPointKind = point.kind
      handle.dataset.zoneControlPointIndex = String(point.index)
      handle.dataset.zoneControlPointScreenX = String(screen.x)
      handle.dataset.zoneControlPointScreenY = String(screen.y)
      handle.setAttribute('role', 'button')
      handle.setAttribute('aria-label', `Zone control point ${point.index + 1}`)
    },
  }

  return createControlPointOverlay(options, adapter)

  function eligibleSelectedZone(): SceneZoneEntity | null {
    const selection = options.getSelection()
    if (
      selection.editableTargets.length !== 1
      || (selection.lockedTargets?.length ?? 0) > 0
      || selection.blockedTargets.length > 0
    ) return null
    const target = selection.editableTargets[0]
    if (target?.kind !== 'zone') return null
    return options.getSceneStore().persisted.zones.find((zone) => zone.name === target.id) ?? null
  }
}

function createZoneControlPointsForZone(zone: SceneZoneEntity): ZoneControlPoint[] {
  if (zone.zoneType === 'line' && zone.points.length >= 2) {
    return zone.points.slice(0, 2).map((point, index) => ({
      id: `${zone.name}:line:${index}`,
      zoneId: zone.name,
      kind: 'line-endpoint',
      index,
      world: point,
    }))
  }

  if (zone.zoneType === 'polygon' && zone.points.length >= 3) {
    return zone.points.map((point, index) => ({
      id: `${zone.name}:polygon:${index}`,
      zoneId: zone.name,
      kind: 'polygon-vertex',
      index,
      world: point,
    }))
  }

  if (zone.zoneType === 'rect') {
    const corners = getRectangularZoneCorners(zone)
    return corners?.map((point, index) => ({
      id: `${zone.name}:rect:${index}`,
      zoneId: zone.name,
      kind: 'rect-corner',
      index,
      world: point,
    })) ?? []
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return [
      {
        id: `${zone.name}:ellipse:east`,
        zoneId: zone.name,
        kind: 'ellipse-east',
        index: 0,
        world: offsetRotated(center, { x: Math.abs(radii.x), y: 0 }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:west`,
        zoneId: zone.name,
        kind: 'ellipse-west',
        index: 1,
        world: offsetRotated(center, { x: -Math.abs(radii.x), y: 0 }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:north`,
        zoneId: zone.name,
        kind: 'ellipse-north',
        index: 2,
        world: offsetRotated(center, { x: 0, y: -Math.abs(radii.y) }, zone.rotationDeg),
      },
      {
        id: `${zone.name}:ellipse:south`,
        zoneId: zone.name,
        kind: 'ellipse-south',
        index: 3,
        world: offsetRotated(center, { x: 0, y: Math.abs(radii.y) }, zone.rotationDeg),
      },
    ]
  }

  return []
}

function reshapeZone(
  zone: SceneZoneEntity,
  controlPoint: ZoneControlPoint,
  dragged: ScenePoint,
): SceneZoneEntity | null {
  if (zone.zoneType === 'line') return reshapeLinearZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'polygon') return reshapePolygonalZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'rect') return reshapeRectangularZone(zone, controlPoint.index, dragged)
  if (zone.zoneType === 'ellipse') return reshapeEllipticalZone(zone, controlPoint.kind, dragged)
  return null
}

function reshapeLinearZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  if (zone.points.length < 2 || index < 0 || index > 1) return null
  const points = zone.points.map((point, pointIndex) => (
    pointIndex === index ? cleanPoint(dragged) : { ...point }
  ))
  if (distance(points[0]!, points[1]!) < MIN_ZONE_DIMENSION_M) return null
  return { ...zone, points }
}

function reshapePolygonalZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  if (zone.points.length < 3 || index < 0 || index >= zone.points.length) return null
  const points = zone.points.map((point, pointIndex) => (
    pointIndex === index ? cleanPoint(dragged) : { ...point }
  ))
  if (Math.abs(polygonArea(points)) < MIN_POLYGON_AREA_M2) return null
  return { ...zone, points, rotationDeg: 0 }
}

function reshapeRectangularZone(zone: SceneZoneEntity, index: number, dragged: ScenePoint): SceneZoneEntity | null {
  const corners = getRectangularZoneCorners(zone)
  if (!corners || index < 0 || index >= 4) return null
  const anchor = corners[(index + 2) % 4]!
  const localDelta = rotateVector({
    x: dragged.x - anchor.x,
    y: dragged.y - anchor.y,
  }, -zone.rotationDeg)
  const width = Math.abs(localDelta.x)
  const height = Math.abs(localDelta.y)
  if (width < MIN_ZONE_DIMENSION_M || height < MIN_ZONE_DIMENSION_M) return null
  return {
    ...zone,
    points: rectPointsAroundCenter(midpoint(anchor, dragged), width, height),
  }
}

function reshapeEllipticalZone(
  zone: SceneZoneEntity,
  kind: ZoneControlPointKind,
  dragged: ScenePoint,
): SceneZoneEntity | null {
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
    return {
      ...zone,
      points: [
        cleanPoint(projected.center),
        { x: cleanMetric(radius), y: Math.abs(radii.y) },
      ],
    }
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
    return {
      ...zone,
      points: [
        cleanPoint(projected.center),
        { x: Math.abs(radii.x), y: cleanMetric(radius) },
      ],
    }
  }

  return null
}

function projectPointOnAxisFromAnchor(
  anchor: ScenePoint,
  point: ScenePoint,
  axis: ScenePoint,
): { center: ScenePoint; distanceAlongAxis: number } {
  const distanceAlongAxis = dot({ x: point.x - anchor.x, y: point.y - anchor.y }, axis)
  return {
    distanceAlongAxis,
    center: {
      x: anchor.x + axis.x * distanceAlongAxis / 2,
      y: anchor.y + axis.y * distanceAlongAxis / 2,
    },
  }
}

function offsetRotated(center: ScenePoint, offset: ScenePoint, degrees: number): ScenePoint {
  const rotated = rotateVector(offset, degrees)
  return {
    x: cleanMetric(center.x + rotated.x),
    y: cleanMetric(center.y + rotated.y),
  }
}

function rotateVector(vector: ScenePoint, degrees: number): ScenePoint {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: cleanMetric(vector.x * cos - vector.y * sin),
    y: cleanMetric(vector.x * sin + vector.y * cos),
  }
}

function rectPointsAroundCenter(center: ScenePoint, width: number, height: number): ScenePoint[] {
  const halfWidth = width / 2
  const halfHeight = height / 2
  return [
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y - halfHeight) },
    { x: cleanMetric(center.x + halfWidth), y: cleanMetric(center.y + halfHeight) },
    { x: cleanMetric(center.x - halfWidth), y: cleanMetric(center.y + halfHeight) },
  ]
}

function cloneZone(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map((point) => ({ ...point })),
  }
}

function zonesEqual(a: SceneZoneEntity, b: SceneZoneEntity): boolean {
  if (a.rotationDeg !== b.rotationDeg || a.points.length !== b.points.length) return false
  return a.points.every((point, index) => pointsEqual(point, b.points[index]!))
}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < GEOMETRY_EPSILON
    && Math.abs(a.y - b.y) < GEOMETRY_EPSILON
}

function cleanPoint(point: ScenePoint): ScenePoint {
  return {
    x: cleanMetric(point.x),
    y: cleanMetric(point.y),
  }
}

function midpoint(a: ScenePoint, b: ScenePoint): ScenePoint {
  return {
    x: cleanMetric((a.x + b.x) / 2),
    y: cleanMetric((a.y + b.y) / 2),
  }
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function polygonArea(points: readonly ScenePoint[]): number {
  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    sum += current.x * next.y - next.x * current.y
  }
  return sum / 2
}

function dot(a: ScenePoint, b: ScenePoint): number {
  return a.x * b.x + a.y * b.y
}

function cleanMetric(value: number): number {
  return Math.abs(value) < GEOMETRY_EPSILON ? 0 : value
}
