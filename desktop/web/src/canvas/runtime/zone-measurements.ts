import type { ScenePoint } from './scene'
import { degreesToRadians, polygonArea, rotatePointAround } from './zone-geometry'

type ZoneMeasurementLabelKind = 'edge' | 'dimension' | 'area'

export interface ZoneMeasurementLabel {
  id: string
  kind: ZoneMeasurementLabelKind
  text: string
  worldPosition: ScenePoint
  worldStart?: ScenePoint
  worldEnd?: ScenePoint
}

export function createEllipticalZoneMeasurements(
  center: ScenePoint,
  radii: ScenePoint,
  rotationDeg = 0,
): ZoneMeasurementLabel[] {
  const width = Math.abs(radii.x) * 2
  const height = Math.abs(radii.y) * 2
  if (width < 0.5 || height < 0.5) return []

  const radians = degreesToRadians(rotationDeg)
  const widthPosition = rotatePointAround({ x: center.x, y: center.y - Math.abs(radii.y) }, center, radians)
  const heightPosition = rotatePointAround({ x: center.x + Math.abs(radii.x), y: center.y }, center, radians)

  return [
    {
      id: 'ellipse-width',
      kind: 'dimension',
      text: `W ${formatMetricDistance(width)}`,
      worldPosition: widthPosition,
    },
    {
      id: 'ellipse-height',
      kind: 'dimension',
      text: `H ${formatMetricDistance(height)}`,
      worldPosition: heightPosition,
    },
    {
      id: 'area',
      kind: 'area',
      text: formatMetricArea(Math.PI * Math.abs(radii.x) * Math.abs(radii.y)),
      worldPosition: center,
    },
  ]
}

export function createRectangularZoneMeasurements(points: readonly ScenePoint[]): ZoneMeasurementLabel[] {
  if (points.length < 4) return []
  const corners = points.slice(0, 4)
  return createPolygonalZoneMeasurements(corners)
}

export function createLinearZoneMeasurements(start: ScenePoint, end: ScenePoint): ZoneMeasurementLabel[] {
  if (distance(start, end) < 0.5) return []
  return [createEdgeLabel('edge-0', start, end)]
}

export function createPolygonalZoneDraftMeasurements(
  vertices: readonly ScenePoint[],
  activePoint: ScenePoint | null,
): ZoneMeasurementLabel[] {
  if (vertices.length === 0) return []
  const last = vertices[vertices.length - 1]!
  const previewPoints = activePoint && !pointsEqual(last, activePoint)
    ? [...vertices, activePoint]
    : [...vertices]

  const labels: ZoneMeasurementLabel[] = []
  for (let index = 0; index < previewPoints.length - 1; index += 1) {
    labels.push(createEdgeLabel(`edge-${index}`, previewPoints[index]!, previewPoints[index + 1]!))
  }

  if (previewPoints.length >= 3) {
    const area = Math.abs(polygonArea(previewPoints))
    if (area >= 0.25) {
      labels.push(createEdgeLabel('edge-closing', previewPoints[previewPoints.length - 1]!, previewPoints[0]!))
      labels.push({
        id: 'area',
        kind: 'area',
        text: formatMetricArea(area),
        worldPosition: averagePoint(previewPoints),
      })
    }
  }

  return labels
}

/** A closed polygon's edges and area; none under 0.25 m². */
export function createPolygonalZoneMeasurements(points: readonly ScenePoint[]): ZoneMeasurementLabel[] {
  if (points.length < 3) return []
  const area = Math.abs(polygonArea(points))
  if (area < 0.25) return []

  const labels: ZoneMeasurementLabel[] = []
  for (let index = 0; index < points.length; index += 1) {
    labels.push(createEdgeLabel(`edge-${index}`, points[index]!, points[(index + 1) % points.length]!))
  }

  labels.push({
    id: 'area',
    kind: 'area',
    text: formatMetricArea(area),
    worldPosition: averagePoint(points),
  })

  return labels
}

function createEdgeLabel(id: string, start: ScenePoint, end: ScenePoint): ZoneMeasurementLabel {
  return {
    id,
    kind: 'edge',
    text: formatMetricDistance(distance(start, end)),
    worldPosition: midpoint(start, end),
    worldStart: start,
    worldEnd: end,
  }
}

export function formatMetricDistance(value: number): string {
  const meters = Math.abs(value)
  if (meters < 1) return `${formatMetricNumber(meters * 100)} cm`
  return `${formatMetricNumber(meters)} m`
}

export function formatMetricArea(value: number): string {
  const squareMeters = Math.abs(value)
  if (squareMeters < 1) return `${formatMetricNumber(squareMeters * 10000)} cm²`
  if (squareMeters >= 10000) return `${formatMetricNumber(squareMeters / 10000)} ha`
  return `${formatMetricNumber(squareMeters)} m²`
}

function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function midpoint(a: ScenePoint, b: ScenePoint): ScenePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function averagePoint(points: readonly ScenePoint[]): ScenePoint {
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
  }), { x: 0, y: 0 })
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  }
}

function formatMetricNumber(value: number): string {
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function pointsEqual(a: ScenePoint, b: ScenePoint): boolean {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}
