import type {
  Annotation,
  CanopiFile,
  Layer,
  Location,
  ObjectGroup,
  PlacedPlant,
  Zone,
} from '../../../types/design'
import type {
  SceneAnnotationEntity,
  SceneLayerEntity,
  SceneLocation,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  SceneSessionState,
  SceneZoneEntity,
} from './types'

export interface SceneSerializeOptions {
  now?: Date
}

export function hydrateScenePersistedState(file: CanopiFile): ScenePersistedState {
  return {
    version: file.version,
    name: file.name,
    description: file.description,
    location: hydrateLocation(file.location),
    northBearingDeg: file.north_bearing_deg,
    plantSpeciesColors: { ...file.plant_species_colors },
    layers: file.layers.map(hydrateLayerEntity),
    plants: file.plants.map(hydratePlantEntity),
    zones: file.zones.map(hydrateZoneEntity),
    annotations: (file.annotations ?? []).map(hydrateAnnotationEntity),
    groups: (file.groups ?? []).map(hydrateGroupEntity),
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    extra: { ...(file.extra ?? {}) },
  }
}

export function serializeScenePersistedState(
  state: ScenePersistedState,
  options: SceneSerializeOptions = {},
): CanopiFile {
  const now = options.now ?? new Date()

  return {
    version: state.version,
    name: state.name,
    description: state.description,
    location: serializeLocation(state.location),
    north_bearing_deg: state.northBearingDeg,
    plant_species_colors: { ...state.plantSpeciesColors },
    layers: state.layers.map(serializeLayerEntity),
    plants: state.plants.map(serializePlantEntity),
    zones: state.zones.map(serializeZoneEntity),
    annotations: state.annotations.map(serializeAnnotationEntity),
    consortiums: [],
    groups: state.groups.map(serializeGroupEntity),
    timeline: [],
    budget: [],
    created_at: state.createdAt,
    updated_at: now.toISOString(),
    extra: { ...state.extra },
  }
}

export function cloneScenePersistedState(state: ScenePersistedState): ScenePersistedState {
  return {
    ...state,
    location: state.location ? { ...state.location } : null,
    plantSpeciesColors: { ...state.plantSpeciesColors },
    layers: state.layers.map(cloneLayerEntity),
    plants: state.plants.map(clonePlantEntity),
    zones: state.zones.map(cloneZoneEntity),
    annotations: state.annotations.map(cloneAnnotationEntity),
    groups: state.groups.map(cloneGroupEntity),
    extra: { ...state.extra },
  }
}

export function cloneSceneSessionState(state: SceneSessionState): SceneSessionState {
  return {
    ...state,
    selectedEntityIds: new Set(state.selectedEntityIds),
    viewport: { ...state.viewport },
  }
}

function hydrateLocation(location: Location | null): SceneLocation | null {
  if (!location) return null
  return {
    lat: location.lat,
    lon: location.lon,
    altitudeM: location.altitude_m,
  }
}

function serializeLocation(location: SceneLocation | null): Location | null {
  if (!location) return null
  return {
    lat: location.lat,
    lon: location.lon,
    altitude_m: location.altitudeM,
  }
}

function hydrateLayerEntity(layer: Layer): SceneLayerEntity {
  return {
    kind: 'layer',
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  }
}

function serializeLayerEntity(layer: SceneLayerEntity): Layer {
  return {
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  }
}

function cloneLayerEntity(layer: SceneLayerEntity): SceneLayerEntity {
  return {
    ...layer,
  }
}

function hydratePlantEntity(plant: PlacedPlant): ScenePlantEntity {
  return {
    kind: 'plant',
    id: plant.id,
    canonicalName: plant.canonical_name,
    commonName: plant.common_name,
    color: plant.color,
    stratum: null,
    canopySpreadM: plant.scale,
    position: {
      x: plant.position.x,
      y: plant.position.y,
    },
    rotationDeg: plant.rotation,
    scale: plant.scale,
    notes: plant.notes,
    plantedDate: plant.planted_date,
    quantity: plant.quantity,
  }
}

function serializePlantEntity(plant: ScenePlantEntity): PlacedPlant {
  return {
    id: plant.id,
    canonical_name: plant.canonicalName,
    common_name: plant.commonName,
    color: plant.color,
    position: {
      x: plant.position.x,
      y: plant.position.y,
    },
    rotation: plant.rotationDeg,
    scale: plant.canopySpreadM ?? plant.scale,
    notes: plant.notes,
    planted_date: plant.plantedDate,
    quantity: plant.quantity,
  }
}

function clonePlantEntity(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...plant,
    position: { ...plant.position },
  }
}

function hydrateZoneEntity(zone: Zone): SceneZoneEntity {
  return {
    kind: 'zone',
    name: zone.name,
    zoneType: zone.zone_type,
    points: zone.points.map(clonePoint),
    fillColor: zone.fill_color,
    notes: zone.notes,
  }
}

function serializeZoneEntity(zone: SceneZoneEntity): Zone {
  return {
    name: zone.name,
    zone_type: zone.zoneType,
    points: zone.points.map(clonePoint),
    fill_color: zone.fillColor,
    notes: zone.notes,
  }
}

function cloneZoneEntity(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map(clonePoint),
  }
}

function hydrateAnnotationEntity(annotation: Annotation): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id: annotation.id,
    annotationType: annotation.annotation_type,
    position: clonePoint(annotation.position),
    text: annotation.text,
    fontSize: annotation.font_size,
    rotationDeg: annotation.rotation,
  }
}

function serializeAnnotationEntity(annotation: SceneAnnotationEntity): Annotation {
  return {
    id: annotation.id,
    annotation_type: annotation.annotationType,
    position: clonePoint(annotation.position),
    text: annotation.text,
    font_size: annotation.fontSize,
    rotation: annotation.rotationDeg,
  }
}

function cloneAnnotationEntity(annotation: SceneAnnotationEntity): SceneAnnotationEntity {
  return {
    ...annotation,
    position: clonePoint(annotation.position),
  }
}

function hydrateGroupEntity(group: ObjectGroup): SceneObjectGroupEntity {
  return {
    kind: 'group',
    id: group.id,
    name: group.name,
    layer: group.layer,
    position: {
      x: group.position.x,
      y: group.position.y,
    },
    rotationDeg: group.rotation,
    memberIds: [...group.member_ids],
  }
}

function serializeGroupEntity(group: SceneObjectGroupEntity): ObjectGroup {
  return {
    id: group.id,
    name: group.name,
    layer: group.layer,
    position: {
      x: group.position.x,
      y: group.position.y,
    },
    rotation: group.rotationDeg,
    member_ids: [...group.memberIds],
  }
}

function cloneGroupEntity(group: SceneObjectGroupEntity): SceneObjectGroupEntity {
  return {
    ...group,
    position: { ...group.position },
    memberIds: [...group.memberIds],
  }
}


function clonePoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.x,
    y: point.y,
  }
}
