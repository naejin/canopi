import type { PlantStampSpecies } from '../../../state/canvas'
import type { ScenePoint, SceneStore } from '../scene'

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

  const zoneId = crypto.randomUUID()
  const zoneName = `zone-${zoneId}`
  store.updatePersisted((draft) => {
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
      },
    ]
  })
  return zoneName
}

export function appendDroppedPlant(
  store: SceneStore,
  payload: PlantDropPayload,
  world: ScenePoint,
): string {
  const id = crypto.randomUUID()
  store.updatePersisted((draft) => {
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
      },
    ]
  })
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
  const id = crypto.randomUUID()
  store.updatePersisted((draft) => {
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
      },
    ]
  })
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
