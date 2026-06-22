import type { PlantStampSource } from '../../plant-stamp-source'
import {
  resolvePlantSymbolId,
  type ScenePersistedState,
  type ScenePoint,
  type SceneStore,
} from '../scene'
import { createUuid } from '../../../utils/ids'

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
      rotationDeg: 0,
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
      rotationDeg: 0,
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

export function appendLineZoneToDraft(
  draft: ScenePersistedState,
  start: ScenePoint,
  end: ScenePoint,
): string | null {
  if (!isValidLine(start, end)) return null

  const zoneId = createUuid()
  const zoneName = `zone-${zoneId}`
  draft.zones = [
    ...draft.zones,
    {
      kind: 'zone',
      name: zoneName,
      zoneType: 'line',
      rotationDeg: 0,
      points: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ],
      fillColor: null,
      notes: null,
      locked: false,
    },
  ]
  return zoneName
}

export function appendMeasurementGuideToDraft(
  draft: ScenePersistedState,
  start: ScenePoint,
  end: ScenePoint,
): string | null {
  if (!isValidLine(start, end)) return null

  const guideId = `measurement-guide-${createUuid()}`
  draft.measurementGuides = [
    ...(draft.measurementGuides ?? []),
    {
      kind: 'measurement-guide',
      id: guideId,
      locked: false,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    },
  ]
  return guideId
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
      rotationDeg: 0,
      points: points.map((point) => ({ x: point.x, y: point.y })),
      fillColor: null,
      notes: null,
      locked: false,
    },
  ]
  return zoneName
}

export function appendPlantStampSourceToDraft(
  draft: ScenePersistedState,
  source: PlantStampSource,
  world: ScenePoint,
): string {
  const id = createUuid()
  const hasSpeciesSymbol = Object.prototype.hasOwnProperty.call(
    draft.plantSpeciesSymbols,
    source.canonical_name,
  )
  const speciesSymbol = hasSpeciesSymbol
    ? resolvePlantSymbolId(draft.plantSpeciesSymbols[source.canonical_name])
    : null
  draft.plants = [
    ...draft.plants,
    {
      kind: 'plant',
      id,
      canonicalName: source.canonical_name,
      commonName: source.common_name,
      color: draft.plantSpeciesColors[source.canonical_name] ?? null,
      ...(speciesSymbol ? { symbol: speciesSymbol } : {}),
      stratum: source.stratum,
      canopySpreadM: source.width_max_m,
      position: world,
      rotationDeg: null,
      scale: source.width_max_m,
      notes: null,
      plantedDate: null,
      quantity: 1,
      locked: false,
    },
  ]
  return id
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

function isValidPolygon(points: readonly ScenePoint[]): boolean {
  return points.length >= 3 && Math.abs(polygonArea(points)) >= 0.25
}

function isValidLine(start: ScenePoint, end: ScenePoint): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= 0.5
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
