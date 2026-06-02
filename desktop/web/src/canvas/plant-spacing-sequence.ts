import type { ScenePlantEntity, ScenePoint } from './runtime/scene'

const EXACT_ENDPOINT_TOLERANCE_M = 0.000001

export function computePlantSpacingPositions(
  source: ScenePoint,
  endpoint: ScenePoint,
  intervalM: number,
): ScenePoint[] {
  if (!Number.isFinite(intervalM) || intervalM <= 0) return []

  const dx = endpoint.x - source.x
  const dy = endpoint.y - source.y
  const length = Math.hypot(dx, dy)
  if (!Number.isFinite(length) || length <= EXACT_ENDPOINT_TOLERANCE_M) return []
  if (length + EXACT_ENDPOINT_TOLERANCE_M < intervalM) return []

  const count = Math.floor((length + EXACT_ENDPOINT_TOLERANCE_M) / intervalM)
  if (count <= 0) return []

  const ux = dx / length
  const uy = dy / length
  const positions: ScenePoint[] = []

  for (let index = 1; index <= count; index += 1) {
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

export function createPlantSpacingGeneratedPlants(
  source: ScenePlantEntity,
  positions: readonly ScenePoint[],
  createId: (index: number) => string,
): ScenePlantEntity[] {
  return positions.map((position, index) => ({
    kind: 'plant',
    id: createId(index),
    canonicalName: source.canonicalName,
    commonName: source.commonName,
    color: source.color,
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
