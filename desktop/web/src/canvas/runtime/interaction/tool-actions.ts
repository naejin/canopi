import type { PlantStampSpecies } from '../../plant-tool-state'
import type { ScenePersistedState, ScenePoint, SceneStore } from '../scene'
import { createUuid } from '../../../utils/ids'

export interface PlantDropPayload {
  canonical_name: string
  common_name: string | null
  stratum: string | null
  width_max_m: number | null
}

export interface SceneRect {
  x: number
  y: number
  width: number
  height: number
}

export function appendRectangleZone(store: SceneStore, rect: SceneRect): string | null {
  if (rect.width < 0.5 || rect.height < 0.5) return null

  let zoneName: string | null = null
  store.updatePersisted((draft) => {
    zoneName = appendRectangleZoneToDraft(draft, rect)
  })
  return zoneName
}

export function appendRectangleZoneToDraft(
  draft: ScenePersistedState,
  rect: SceneRect,
): string | null {
  if (rect.width < 0.5 || rect.height < 0.5) return null

  const zoneId = createUuid()
  const zoneName = `zone-${zoneId}`
  draft.zones = [
    ...draft.zones,
    {
      kind: 'zone',
      name: zoneName,
      zoneType: 'rect',
      points: [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
        { x: rect.x, y: rect.y + rect.height },
      ],
      fillColor: null,
      notes: null,
      locked: false,
    },
  ]
  return zoneName
}

export function appendEllipseZoneToDraft(
  draft: ScenePersistedState,
  rect: SceneRect,
): string | null {
  if (rect.width < 0.5 || rect.height < 0.5) return null

  const zoneId = createUuid()
  const zoneName = `zone-${zoneId}`
  draft.zones = [
    ...draft.zones,
    {
      kind: 'zone',
      name: zoneName,
      zoneType: 'ellipse',
      points: [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        { x: rect.width / 2, y: rect.height / 2 },
      ],
      fillColor: null,
      notes: null,
      locked: false,
    },
  ]
  return zoneName
}

export function appendPolygonZoneToDraft(
  draft: ScenePersistedState,
  points: readonly ScenePoint[],
): string | null {
  if (!isValidPolygon(points)) return null

  const zoneId = createUuid()
  const zoneName = `zone-${zoneId}`
  draft.zones = [
    ...draft.zones,
    {
      kind: 'zone',
      name: zoneName,
      zoneType: 'polygon',
      points: points.map((point) => ({ x: point.x, y: point.y })),
      fillColor: null,
      notes: null,
      locked: false,
    },
  ]
  return zoneName
}

export function appendDroppedPlant(
  store: SceneStore,
  payload: PlantDropPayload,
  world: ScenePoint,
): string {
  let id = ''
  store.updatePersisted((draft) => {
    id = appendDroppedPlantToDraft(draft, payload, world)
  })
  return id
}

export function appendDroppedPlantToDraft(
  draft: ScenePersistedState,
  payload: PlantDropPayload,
  world: ScenePoint,
): string {
  const id = createUuid()
  draft.plants = [
    ...draft.plants,
    {
      kind: 'plant',
      id,
      canonicalName: payload.canonical_name,
      commonName: payload.common_name,
      color: draft.plantSpeciesColors[payload.canonical_name] ?? null,
      stratum: payload.stratum,
      canopySpreadM: payload.width_max_m,
      position: world,
      rotationDeg: null,
      scale: payload.width_max_m,
      notes: null,
      plantedDate: null,
      quantity: 1,
      locked: false,
    },
  ]
  return id
}

export function appendStampedPlant(
  store: SceneStore,
  species: PlantStampSpecies,
  world: ScenePoint,
): string {
  return appendDroppedPlant(store, species, world)
}

export function appendTextAnnotation(
  store: SceneStore,
  position: ScenePoint,
  text: string,
): string {
  let id = ''
  store.updatePersisted((draft) => {
    id = appendTextAnnotationToDraft(draft, position, text)
  })
  return id
}

export function appendTextAnnotationToDraft(
  draft: ScenePersistedState,
  position: ScenePoint,
  text: string,
): string {
  const id = createUuid()
  draft.annotations = [
    ...draft.annotations,
    {
      kind: 'annotation',
      id,
      annotationType: 'text',
      position,
      text,
      fontSize: 16,
      rotationDeg: null,
      locked: false,
    },
  ]
  return id
}

export function parsePlantDropPayload(event: DragEvent): PlantDropPayload | null {
  let raw: string | null = null
  try {
    raw = event.dataTransfer?.getData('text/plain') ?? null
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const data = JSON.parse(raw)
    if (typeof data.canonical_name !== 'string') return null
    return {
      canonical_name: data.canonical_name,
      common_name: typeof data.common_name === 'string' ? data.common_name : null,
      stratum: typeof data.stratum === 'string' ? data.stratum : null,
      width_max_m: typeof data.width_max_m === 'number' ? data.width_max_m : null,
    }
  } catch {
    return null
  }
}

function isValidPolygon(points: readonly ScenePoint[]): boolean {
  return points.length >= 3 && Math.abs(polygonArea(points)) >= 0.25
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
