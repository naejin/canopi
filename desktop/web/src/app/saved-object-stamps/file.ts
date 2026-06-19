import type { SavedObjectStampPayload } from '../../canvas/saved-object-stamp-payload'
import type { ObjectGroup, CanopiFile } from '../../types/design'
import type { ScenePoint } from '../../canvas/runtime/scene'

interface ComposeSavedObjectStampCanopiFileOptions {
  readonly name: string
  readonly payload: SavedObjectStampPayload
  readonly now?: Date
}

const STAMP_FILE_LAYERS: CanopiFile['layers'] = [
  { name: 'plants', visible: true, locked: false, opacity: 1 },
  { name: 'zones', visible: true, locked: false, opacity: 1 },
  { name: 'annotations', visible: true, locked: false, opacity: 1 },
]

export function composeSavedObjectStampCanopiFile({
  name,
  payload,
  now = new Date(),
}: ComposeSavedObjectStampCanopiFileOptions): CanopiFile {
  const timestamp = now.toISOString()
  return {
    version: 3,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: STAMP_FILE_LAYERS.map((layer) => ({ ...layer })),
    plants: payload.plants.map((plant) => ({
      id: plant.id,
      locked: false,
      canonical_name: plant.canonicalName,
      common_name: plant.commonName,
      color: plant.color,
      symbol: plant.symbol ?? null,
      position: { ...plant.position },
      rotation: plant.rotationDeg,
      scale: plant.scale,
      notes: null,
      planted_date: null,
      quantity: null,
    })),
    zones: payload.zones.map((zone) => ({
      name: zone.name,
      locked: false,
      zone_type: zone.zoneType,
      points: zone.points.map((point) => ({ ...point })),
      rotation: zone.rotationDeg,
      fill_color: zone.fillColor,
      notes: null,
    })),
    annotations: payload.annotations.map((annotation) => ({
      id: annotation.id,
      locked: false,
      annotation_type: annotation.annotationType,
      position: { ...annotation.position },
      text: annotation.text,
      font_size: annotation.fontSize,
      rotation: annotation.rotationDeg,
    })),
    consortiums: [],
    groups: validCapturedGroups(payload),
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: timestamp,
    updated_at: timestamp,
    extra: {},
  }
}

export function savedObjectStampPayloadFromCanopiFile(file: CanopiFile): SavedObjectStampPayload | null {
  const idMap = new Map<string, string>()
  const plants = layerVisible(file, 'plants')
    ? file.plants
      .filter((plant) => plant.canonical_name.trim().length > 0)
      .map((plant, index) => {
        const id = nonEmptyString(plant.id) ?? `plant-${index + 1}`
        if (nonEmptyString(plant.id)) idMap.set(memberKey({ kind: 'plant', id: plant.id }), id)
        return {
          id,
          canonicalName: plant.canonical_name,
          commonName: plant.common_name,
          color: plant.color ?? null,
          symbol: plant.symbol ?? null,
          position: { ...plant.position },
          rotationDeg: plant.rotation,
          scale: plant.scale,
        }
      })
    : []
  const zones = layerVisible(file, 'zones')
    ? file.zones
      .filter((zone) => zone.name.trim().length > 0 && zone.points.length > 0)
      .map((zone, index) => {
        const id = `zone-${index + 1}`
        idMap.set(memberKey({ kind: 'zone', id: zone.name }), id)
        return {
          id,
          name: zone.name,
          zoneType: zone.zone_type,
          points: zone.points.map((point) => ({ ...point })),
          rotationDeg: zone.rotation,
          fillColor: zone.fill_color,
        }
      })
    : []
  const annotations = layerVisible(file, 'annotations')
    ? file.annotations
      .filter((annotation) => annotation.id.trim().length > 0 && annotation.text.trim().length > 0)
      .map((annotation, index) => {
        const id = annotation.id || `annotation-${index + 1}`
        idMap.set(memberKey({ kind: 'annotation', id: annotation.id }), id)
        return {
          id,
          annotationType: annotation.annotation_type,
          position: { ...annotation.position },
          text: annotation.text,
          fontSize: annotation.font_size,
          rotationDeg: annotation.rotation,
        }
      })
    : []

  if (plants.length + zones.length + annotations.length === 0) return null

  return {
    version: 1,
    anchor: anchorForPayloadObjects(plants, zones, annotations),
    plants,
    zones,
    annotations,
    groups: file.groups
      .map((group, index) => ({
        id: nonEmptyString(group.id) ?? `group-${index + 1}`,
        name: group.name,
        members: group.members
          .map((member) => {
            const id = idMap.get(memberKey(member))
            return id ? { kind: member.kind, id } : null
          })
          .filter((member): member is NonNullable<typeof member> => member !== null),
      }))
      .filter((group) => group.members.length >= 2),
  }
}

export function importedSavedObjectStampName(
  file: CanopiFile,
  payload: SavedObjectStampPayload,
): string {
  return file.name.trim() || fallbackStampName(payload)
}

function validCapturedGroups(payload: SavedObjectStampPayload): ObjectGroup[] {
  const validMemberKeys = new Set<string>([
    ...payload.plants.map((plant) => memberKey({ kind: 'plant', id: plant.id })),
    ...payload.zones.map((zone) => memberKey({ kind: 'zone', id: zone.id })),
    ...payload.annotations.map((annotation) => memberKey({ kind: 'annotation', id: annotation.id })),
  ])

  return payload.groups
    .map((group): ObjectGroup => ({
      id: group.id,
      locked: false,
      name: group.name,
      members: group.members.filter((member) => validMemberKeys.has(memberKey(member))),
    }))
    .filter((group) => group.members.length >= 2)
}

function memberKey(member: { readonly kind: string; readonly id: string }): string {
  return `${member.kind}:${member.id}`
}

function layerVisible(file: CanopiFile, name: string): boolean {
  return file.layers.find((layer) => layer.name === name)?.visible !== false
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function anchorForPayloadObjects(
  plants: SavedObjectStampPayload['plants'],
  zones: SavedObjectStampPayload['zones'],
  annotations: SavedObjectStampPayload['annotations'],
): ScenePoint {
  const points = [
    ...plants.map((plant) => plant.position),
    ...zones.flatMap((zone) => zone.points),
    ...annotations.map((annotation) => annotation.position),
  ]
  if (points.length === 0) return { x: 0, y: 0 }
  const bounds = points.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    minY: Math.min(current.minY, point.y),
    maxX: Math.max(current.maxX, point.x),
    maxY: Math.max(current.maxY, point.y),
  }), {
    minX: points[0]!.x,
    minY: points[0]!.y,
    maxX: points[0]!.x,
    maxY: points[0]!.y,
  })
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

function fallbackStampName(payload: SavedObjectStampPayload): string {
  if (payload.plants.length > 0) {
    const counts = new Map<string, { count: number; firstIndex: number }>()
    payload.plants.forEach((plant, index) => {
      const name = plant.commonName ?? plant.canonicalName
      const current = counts.get(name)
      counts.set(name, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, firstIndex: index })
    })
    return [...counts.entries()]
      .sort(([, left], [, right]) => right.count - left.count || left.firstIndex - right.firstIndex)
      .slice(0, 3)
      .map(([name]) => name)
      .join(', ')
  }

  const zonePart = payload.zones.length === 1 ? '1 zone' : `${payload.zones.length} zones`
  const annotationPart = payload.annotations.length === 1
    ? '1 annotation'
    : `${payload.annotations.length} annotations`
  return `${zonePart}, ${annotationPart}`
}
