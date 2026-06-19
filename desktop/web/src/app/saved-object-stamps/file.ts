import type { SavedObjectStampPayload } from '../../canvas/saved-object-stamp-payload'
import type { ObjectGroup, CanopiFile } from '../../types/design'

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
