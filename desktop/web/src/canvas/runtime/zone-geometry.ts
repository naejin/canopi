import type { ScenePoint, SceneZoneEntity } from './scene'

export interface ZoneWorldBounds {
  x: number
  y: number
  width: number
  height: number
}

export function getZoneWorldBounds(zone: SceneZoneEntity): ZoneWorldBounds | null {
  if (zone.zoneType === 'rect' && zone.points.length >= 4) {
    const corners = getRectangularZoneCorners(zone)
    return corners ? pointsBounds(corners) : null
  }

  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    const rotationRad = degreesToRadians(zone.rotationDeg)
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)
    const halfWidth = Math.sqrt((Math.abs(radii.x) * cos) ** 2 + (Math.abs(radii.y) * sin) ** 2)
    const halfHeight = Math.sqrt((Math.abs(radii.x) * sin) ** 2 + (Math.abs(radii.y) * cos) ** 2)
    return {
      x: cleanMetric(center.x - halfWidth),
      y: cleanMetric(center.y - halfHeight),
      width: cleanMetric(halfWidth * 2),
      height: cleanMetric(halfHeight * 2),
    }
  }

  if (zone.points.length === 0) return null
  return pointsBounds(zone.points)
}

export function getRectangularZoneCorners(zone: SceneZoneEntity): ScenePoint[] | null {
  if (zone.zoneType !== 'rect' || zone.points.length < 4) return null
  const bounds = pointsBounds(zone.points.slice(0, 4))
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ]
  const rotationRad = degreesToRadians(zone.rotationDeg)
  if (Math.abs(rotationRad) < 0.000001) return corners
  return corners.map((point) => rotatePointAround(point, center, rotationRad))
}

export function pointInEllipticalZone(zone: SceneZoneEntity, point: ScenePoint): boolean {
  if (zone.zoneType !== 'ellipse' || zone.points.length < 2) return false
  const center = zone.points[0]!
  const radii = zone.points[1]!
  const local = rotatePointAround(point, center, -degreesToRadians(zone.rotationDeg))
  const nx = (local.x - center.x) / Math.max(Math.abs(radii.x), 0.001)
  const ny = (local.y - center.y) / Math.max(Math.abs(radii.y), 0.001)
  return nx * nx + ny * ny <= 1
}

export function getEllipticalZonePolygon(zone: SceneZoneEntity, segmentCount = 48): ScenePoint[] | null {
  if (zone.zoneType !== 'ellipse' || zone.points.length < 2) return null
  const center = zone.points[0]!
  const radii = zone.points[1]!
  const rotationRad = degreesToRadians(zone.rotationDeg)
  const points: ScenePoint[] = []
  for (let index = 0; index < segmentCount; index += 1) {
    const theta = (index / segmentCount) * Math.PI * 2
    const local = {
      x: center.x + Math.cos(theta) * Math.abs(radii.x),
      y: center.y + Math.sin(theta) * Math.abs(radii.y),
    }
    points.push(rotatePointAround(local, center, rotationRad))
  }
  return points
}

function rotatePointAround(point: ScenePoint, center: ScenePoint, radians: number): ScenePoint {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: cleanMetric(center.x + dx * cos - dy * sin),
    y: cleanMetric(center.y + dx * sin + dy * cos),
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function pointsBounds(points: readonly ScenePoint[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    x: cleanMetric(minX),
    y: cleanMetric(minY),
    width: cleanMetric(maxX - minX),
    height: cleanMetric(maxY - minY),
  }
}

function cleanMetric(value: number): number {
  return Math.abs(value) < 0.0000001 ? 0 : value
}
