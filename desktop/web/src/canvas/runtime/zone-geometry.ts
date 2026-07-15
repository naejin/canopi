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

export function getZoneRadialExtentMeters(zone: SceneZoneEntity): number | null {
  const ellipticalExtent = getEllipticalZoneRadialExtent(zone)
  if (ellipticalExtent !== null) return ellipticalExtent

  const physicalPoints = getRectangularZoneCorners(zone) ?? zone.points
  if (physicalPoints.length === 0) return null
  return physicalPoints.reduce(
    (extent, point) => Math.max(extent, Math.hypot(point.x, point.y)),
    0,
  )
}

function getEllipticalZoneRadialExtent(zone: SceneZoneEntity): number | null {
  if (zone.zoneType !== 'ellipse' || zone.points.length < 2) return null
  const center = zone.points[0]!
  const radii = zone.points[1]!
  const rotationRad = degreesToRadians(zone.rotationDeg)
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const localCenter = {
    x: center.x * cos + center.y * sin,
    y: -center.x * sin + center.y * cos,
  }
  return axisAlignedEllipseRadialExtent(
    localCenter,
    Math.abs(radii.x),
    Math.abs(radii.y),
  )
}

function axisAlignedEllipseRadialExtent(
  center: ScenePoint,
  radiusX: number,
  radiusY: number,
): number {
  const magnitudeScale = Math.max(
    Math.abs(center.x),
    Math.abs(center.y),
    radiusX,
    radiusY,
  )
  if (magnitudeScale === 0) return 0
  if (!Number.isFinite(magnitudeScale)) return magnitudeScale
  return magnitudeScale * axisAlignedEllipseRadialExtentNormalized(
    {
      x: center.x / magnitudeScale,
      y: center.y / magnitudeScale,
    },
    radiusX / magnitudeScale,
    radiusY / magnitudeScale,
  )
}

function axisAlignedEllipseRadialExtentNormalized(
  center: ScenePoint,
  radiusX: number,
  radiusY: number,
): number {
  if (radiusX === radiusY) return Math.hypot(center.x, center.y) + radiusX

  const xIsMajor = radiusX > radiusY
  const majorRadius = xIsMajor ? radiusX : radiusY
  const minorRadius = xIsMajor ? radiusY : radiusX
  const majorCenter = xIsMajor ? center.x : center.y
  const minorCenter = xIsMajor ? center.y : center.x
  const majorSquared = majorRadius ** 2
  const minorSquared = minorRadius ** 2
  const majorLinear = majorRadius * majorCenter
  const minorLinear = minorRadius * minorCenter
  const computationScale = Math.max(
    1,
    majorSquared,
    Math.abs(majorLinear),
    Math.abs(minorLinear),
  )

  // The farthest-point problem is a two-dimensional trust-region problem.
  // When the center has no component on the major axis, its maximum can lie
  // between the ellipse's cardinal points (the trust-region "hard case").
  if (Math.abs(majorLinear) <= Number.EPSILON * 32 * computationScale) {
    const minorCoordinate = minorLinear / (majorSquared - minorSquared)
    if (Math.abs(minorCoordinate) <= 1) {
      const majorCoordinate = (
        Math.sign(majorLinear) || 1
      ) * Math.sqrt(Math.max(0, 1 - minorCoordinate ** 2))
      return Math.hypot(
        majorCenter + majorRadius * majorCoordinate,
        minorCenter + minorRadius * minorCoordinate,
      )
    }
    return Math.hypot(
      majorCenter,
      minorCenter + minorRadius * Math.sign(minorLinear),
    )
  }

  const squaredRadiusDifference = majorSquared - minorSquared
  const constraint = (delta: number): number => (
    (majorLinear / delta) ** 2
    + (minorLinear / (delta + squaredRadiusDifference)) ** 2
  )
  // Solving for the offset above the major squared radius avoids subtracting
  // nearly equal values when the solution is close to the hard case.
  let lower = 0
  let span = Math.max(
    Math.hypot(majorLinear, minorLinear),
    Number.EPSILON * computationScale * 64,
  )
  let upper = span
  while (constraint(upper) > 1) {
    span *= 2
    upper = span
  }

  for (let iteration = 0; iteration < 128; iteration += 1) {
    const delta = lower + (upper - lower) / 2
    if (delta === lower || delta === upper) break
    if (constraint(delta) > 1) lower = delta
    else upper = delta
  }

  const majorCoordinate = majorLinear / upper
  const minorCoordinate = minorLinear / (upper + squaredRadiusDifference)
  return Math.hypot(
    majorCenter + majorRadius * majorCoordinate,
    minorCenter + minorRadius * minorCoordinate,
  )
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
