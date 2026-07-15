import type {
  Annotation,
  CanopiFile,
  Layer,
  MeasurementGuide,
  ObjectGroup,
  PlacedPlant,
  Zone,
} from '../../../types/design'
import { CURRENT_CANOPI_FILE_VERSION } from '../../../generated/canopi-design-format'
import { DEFAULT_BUDGET_CURRENCY } from '../../../generated/known-canopi-keys'
import type {
  SceneAnnotationEntity,
  SceneGuide,
  SceneLayerEntity,
  SceneMeasurementGuideEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  SceneSessionState,
  SceneZoneEntity,
} from './types'
import { cloneSceneObjectGroupMembers } from './group-members'

export interface SceneSerializeOptions {
  now?: Date
}

export function hydrateScenePersistedState(file: CanopiFile): ScenePersistedState {
  return {
    plantSpeciesColors: { ...file.plant_species_colors },
    plantSpeciesSymbols: { ...(file.plant_species_symbols ?? {}) },
    layers: file.layers.map(hydrateLayerEntity),
    plants: file.plants.map(hydratePlantEntity),
    zones: file.zones.map(hydrateZoneEntity),
    annotations: (file.annotations ?? []).map(hydrateAnnotationEntity),
    measurementGuides: (file.measurement_guides ?? []).map(hydrateMeasurementGuideEntity),
    groups: (file.groups ?? []).map(hydrateGroupEntity),
    guides: hydrateGuides(file.extra?.guides),
  }
}

export function serializeScenePersistedState(
  state: ScenePersistedState,
  options: SceneSerializeOptions = {},
): CanopiFile {
  const now = options.now ?? new Date()

  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Untitled',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: { ...state.plantSpeciesColors },
    plant_species_symbols: { ...state.plantSpeciesSymbols },
    layers: state.layers.map(serializeLayerEntity),
    plants: state.plants.map(serializePlantEntity),
    zones: state.zones.map(serializeZoneEntity),
    annotations: state.annotations.map(serializeAnnotationEntity),
    measurement_guides: (state.measurementGuides ?? []).map(serializeMeasurementGuideEntity),
    consortiums: [],
    groups: state.groups.map(serializeGroupEntity),
    timeline: [],
    budget: [],
    budget_currency: DEFAULT_BUDGET_CURRENCY,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    extra: state.guides.length > 0 ? { guides: state.guides.map(cloneGuide) } : {},
  }
}

export function cloneScenePersistedState(state: ScenePersistedState): ScenePersistedState {
  return {
    ...state,
    plantSpeciesColors: { ...state.plantSpeciesColors },
    plantSpeciesSymbols: { ...state.plantSpeciesSymbols },
    layers: state.layers.map(cloneLayerEntity),
    plants: state.plants.map(clonePlantEntity),
    zones: state.zones.map(cloneZoneEntity),
    annotations: state.annotations.map(cloneAnnotationEntity),
    measurementGuides: (state.measurementGuides ?? []).map(cloneMeasurementGuideEntity),
    groups: state.groups.map(cloneGroupEntity),
    guides: state.guides.map(cloneGuide),
  }
}

export function cloneSceneSessionState(state: SceneSessionState): SceneSessionState {
  return {
    ...state,
    selectedEntityIds: new Set(state.selectedEntityIds),
    viewport: { ...state.viewport },
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
    locked: plant.locked ?? false,
    canonicalName: plant.canonical_name,
    commonName: plant.common_name,
    color: plant.color,
    symbol: plant.symbol ?? null,
    pinnedName: plant.pinned_name ?? false,
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
  const serialized: PlacedPlant = {
    id: plant.id,
    locked: plant.locked,
    canonical_name: plant.canonicalName,
    common_name: plant.commonName,
    color: plant.color,
    pinned_name: plant.pinnedName === true,
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
  if (plant.symbol != null) {
    serialized.symbol = plant.symbol
  }
  return serialized
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
    locked: zone.locked ?? false,
    zoneType: zone.zone_type,
    points: zone.points.map(clonePoint),
    rotationDeg: zone.rotation ?? 0,
    fillColor: zone.fill_color,
    notes: zone.notes,
  }
}

function serializeZoneEntity(zone: SceneZoneEntity): Zone {
  return {
    name: zone.name,
    locked: zone.locked,
    zone_type: zone.zoneType,
    points: zone.points.map(clonePoint),
    rotation: zone.rotationDeg,
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
    locked: annotation.locked ?? false,
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
    locked: annotation.locked,
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

function hydrateMeasurementGuideEntity(
  guide: MeasurementGuide,
  index: number,
): SceneMeasurementGuideEntity {
  return {
    kind: 'measurement-guide',
    id: guide.id || `measurement-guide-${index + 1}`,
    locked: guide.locked ?? false,
    start: clonePoint(guide.start),
    end: clonePoint(guide.end),
  }
}

function serializeMeasurementGuideEntity(guide: SceneMeasurementGuideEntity): MeasurementGuide {
  return {
    id: guide.id,
    locked: guide.locked,
    start: clonePoint(guide.start),
    end: clonePoint(guide.end),
  }
}

function cloneMeasurementGuideEntity(
  guide: SceneMeasurementGuideEntity,
): SceneMeasurementGuideEntity {
  return {
    ...guide,
    start: clonePoint(guide.start),
    end: clonePoint(guide.end),
  }
}

function hydrateGroupEntity(group: ObjectGroup): SceneObjectGroupEntity {
  return {
    kind: 'group',
    id: group.id,
    locked: group.locked ?? false,
    name: group.name,
    members: cloneSceneObjectGroupMembers(group.members),
  }
}

function serializeGroupEntity(group: SceneObjectGroupEntity): ObjectGroup {
  return {
    id: group.id,
    locked: group.locked,
    name: group.name,
    members: cloneSceneObjectGroupMembers(group.members),
  }
}

function cloneGroupEntity(group: SceneObjectGroupEntity): SceneObjectGroupEntity {
  return {
    ...group,
    members: cloneSceneObjectGroupMembers(group.members),
  }
}

function hydrateGuides(raw: unknown): SceneGuide[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((guide): guide is SceneGuide => {
      if (!guide || typeof guide !== 'object') return false
      const candidate = guide as Partial<SceneGuide>
      return (
        typeof candidate.id === 'string'
        && (candidate.axis === 'h' || candidate.axis === 'v')
        && typeof candidate.position === 'number'
      )
    })
    .map(cloneGuide)
}

function cloneGuide(guide: SceneGuide): SceneGuide {
  return {
    id: guide.id,
    axis: guide.axis,
    position: guide.position,
  }
}

function clonePoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.x,
    y: point.y,
  }
}
