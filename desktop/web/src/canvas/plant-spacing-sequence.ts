import type { ScenePlantEntity, ScenePoint } from './runtime/scene'

const EXACT_ENDPOINT_TOLERANCE_M = 0.000001

interface PlantSpacingPositionOptions {
  limit?: number
}

export function computePlantSpacingCount(
  source: ScenePoint,
  endpoint: ScenePoint,
  intervalM: number,
): number {
  if (!Number.isFinite(intervalM) || intervalM <= 0) return 0

  const length = Math.hypot(endpoint.x - source.x, endpoint.y - source.y)
  if (!Number.isFinite(length) || length <= EXACT_ENDPOINT_TOLERANCE_M) return 0
  if (length + EXACT_ENDPOINT_TOLERANCE_M < intervalM) return 0

  const count = Math.floor((length + EXACT_ENDPOINT_TOLERANCE_M) / intervalM)
  return count > 0 ? count : 0
}

export function computePlantSpacingPositions(
  source: ScenePoint,
  endpoint: ScenePoint,
  intervalM: number,
  options: PlantSpacingPositionOptions = {},
): ScenePoint[] {
  const dx = endpoint.x - source.x
  const dy = endpoint.y - source.y
  const length = Math.hypot(dx, dy)
  const count = computePlantSpacingCount(source, endpoint, intervalM)
  if (count <= 0) return []

  const ux = dx / length
  const uy = dy / length
  const positions: ScenePoint[] = []
  const materializedCount = normalizeMaterializedCount(count, options.limit)

  for (let index = 1; index <= materializedCount; index += 1) {
    const distance = intervalM * index
    const exactEndpoint = index === count
      && Math.abs(length - distance) <= EXACT_ENDPOINT_TOLERANCE_M
    positions.push(exactEndpoint
      ? { ...endpoint }
      : {
          x: source.x + ux * distance,
          y: source.y + uy * distance,
        })
  }

  return positions
}

function normalizeMaterializedCount(count: number, limit: number | undefined): number {
  if (limit === undefined) return count
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.min(count, Math.floor(limit))
}

export function createPlantSpacingGeneratedPlants(
  source: ScenePlantEntity,
  positions: readonly ScenePoint[],
  createId: (index: number) => string,
): ScenePlantEntity[] {
  return positions.map((position, index) => ({
    kind: 'plant',
    id: createId(index),
    locked: false,
    canonicalName: source.canonicalName,
    commonName: source.commonName,
    color: source.color,
    ...(source.symbol != null ? { symbol: source.symbol } : {}),
    pinnedName: false,
    stratum: source.stratum,
    canopySpreadM: source.canopySpreadM,
    position: { ...position },
    rotationDeg: source.rotationDeg,
    scale: source.scale,
    notes: null,
    plantedDate: null,
    quantity: 1,
  }))
}
