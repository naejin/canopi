import { allocateSpeciesCodes } from '../species-key'
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
import { DEFAULT_NEW_DESIGN_VIEW, sessionPlaneOriginForPoints, type GeoPosition } from '../../session-plane'
import {
  createSceneGeoFrame,
  hydrateGeoEllipse,
  hydrateGeoLatitude,
  hydrateGeoLongitude,
  hydrateGeoPoint,
  serializeGeoEllipse,
  serializeGeoLatitude,
  serializeGeoLongitude,
  serializeGeoPoint,
  type SceneGeoFrame,
} from './geo-frame'
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
import {
  cloneSceneDesignObjectTarget,
  normalizeSceneDesignObjectTargets,
} from './design-object-targets'
import { cloneSceneObjectGroupMembers } from './group-members'

export interface SceneSerializeOptions {
  now?: Date
}

export interface SceneHydration {
  readonly persisted: ScenePersistedState
  readonly geo: SceneGeoFrame
}

// Every stored lon/lat of a Design, used to centre its session plane.
export function designGeoPositions(file: CanopiFile): GeoPosition[] {
  const positions: GeoPosition[] = []
  for (const plant of file.plants) positions.push(plant.position)
  for (const zone of file.zones) positions.push(...zone.points)
  for (const annotation of file.annotations ?? []) positions.push(annotation.position)
  for (const guide of file.measurement_guides ?? []) positions.push(guide.start, guide.end)
  return positions
}

// Builds the session plane at the centre of the Design's objects (or at
// `emptyOrigin` for a Design without objects) and hydrates plane metres.
export function hydrateSceneFromDesign(
  file: CanopiFile,
  emptyOrigin: GeoPosition = DEFAULT_NEW_DESIGN_VIEW,
): SceneHydration {
  const geo = createSceneGeoFrame(sessionPlaneOriginForPoints(designGeoPositions(file), emptyOrigin))
  return { persisted: hydrateScenePersistedStateInFrame(file, geo), geo }
}

export function hydrateScenePersistedState(file: CanopiFile): ScenePersistedState {
  return hydrateSceneFromDesign(file).persisted
}

export function hydrateScenePersistedStateInFrame(file: CanopiFile, geo: SceneGeoFrame): ScenePersistedState {
  return {
    plantSpeciesColors: { ...file.plant_species_colors },
    plantSpeciesSymbols: { ...(file.plant_species_symbols ?? {}) },
    plantSpeciesCodes: allocateSpeciesCodes(file.plant_species_codes ?? {}, file.plants.map((plant) => plant.canonical_name)),
    layers: file.layers.map(hydrateLayerEntity),
    plants: file.plants.map((plant) => hydratePlantEntity(plant, geo)),
    zones: file.zones.map((zone) => hydrateZoneEntity(zone, geo)),
    annotations: (file.annotations ?? []).map((annotation) => hydrateAnnotationEntity(annotation, geo)),
    measurementGuides: (file.measurement_guides ?? []).map((guide, index) => hydrateMeasurementGuideEntity(guide, index, geo)),
    groups: (file.groups ?? []).map(hydrateGroupEntity),
    guides: hydrateGuides(file.extra?.guides, geo),
  }
}

export function serializeScenePersistedState(
  state: ScenePersistedState,
  geo: SceneGeoFrame,
  options: SceneSerializeOptions = {},
): CanopiFile {
  const now = options.now ?? new Date()

  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name: 'Untitled',
    description: null,
    plant_species_colors: { ...state.plantSpeciesColors },
    plant_species_symbols: { ...state.plantSpeciesSymbols },
    plant_species_codes: { ...state.plantSpeciesCodes },
    layers: state.layers.map(serializeLayerEntity),
    plants: state.plants.map((plant) => serializePlantEntity(plant, geo)),
    zones: state.zones.map((zone) => serializeZoneEntity(zone, geo)),
    annotations: state.annotations.map((annotation) => serializeAnnotationEntity(annotation, geo)),
    measurement_guides: state.measurementGuides.map((guide) => serializeMeasurementGuideEntity(guide, geo)),
    consortiums: [],
    groups: state.groups.map(serializeGroupEntity),
    timeline: [],
    budget: [],
    budget_currency: DEFAULT_BUDGET_CURRENCY,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    extra: state.guides.length > 0 ? { guides: state.guides.map((guide) => serializeGuide(guide, geo)) } : {},
  }
}

export function cloneScenePersistedState(state: ScenePersistedState): ScenePersistedState {
  return {
    ...state,
    plantSpeciesColors: { ...state.plantSpeciesColors },
    plantSpeciesSymbols: { ...state.plantSpeciesSymbols },
    plantSpeciesCodes: allocateSpeciesCodes(state.plantSpeciesCodes, state.plants.map((plant) => plant.canonicalName)),
    layers: state.layers.map(cloneLayerEntity),
    plants: state.plants.map(clonePlantEntity),
    zones: state.zones.map(cloneZoneEntity),
    annotations: state.annotations.map(cloneAnnotationEntity),
    measurementGuides: state.measurementGuides.map(cloneMeasurementGuideEntity),
    groups: state.groups.map(cloneGroupEntity),
    guides: state.guides.map(cloneGuide),
  }
}

export function cloneSceneSessionState(state: SceneSessionState): SceneSessionState {
  return {
    ...state,
    selectedTargets: normalizeSceneDesignObjectTargets(state.selectedTargets),
    speciesFocus: { ...state.speciesFocus },
    hoveredTarget: state.hoveredTarget
      ? cloneSceneDesignObjectTarget(state.hoveredTarget)
      : null,
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

function hydratePlantEntity(plant: PlacedPlant, geo: SceneGeoFrame): ScenePlantEntity {
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
    position: hydrateGeoPoint(geo, plant.position),
    rotationDeg: plant.rotation,
    notes: plant.notes,
    plantedDate: plant.planted_date,
    quantity: plant.quantity,
  }
}

function serializePlantEntity(plant: ScenePlantEntity, geo: SceneGeoFrame): PlacedPlant {
  const serialized: PlacedPlant = {
    id: plant.id,
    locked: plant.locked,
    canonical_name: plant.canonicalName,
    common_name: plant.commonName,
    color: plant.color,
    pinned_name: plant.pinnedName === true,
    position: serializeGeoPoint(geo, plant.position),
    rotation: plant.rotationDeg,
    // The file's `scale` field is the plant's canopy spread in metres.
    scale: plant.canopySpreadM,
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

function hydrateZoneEntity(zone: Zone, geo: SceneGeoFrame): SceneZoneEntity {
  return {
    kind: 'zone',
    name: zone.name,
    locked: zone.locked ?? false,
    zoneType: zone.zone_type,
    points: zone.zone_type === 'ellipse' && zone.points.length >= 2
      ? hydrateGeoEllipse(geo, [zone.points[0]!, zone.points[1]!])
      : zone.points.map((point) => hydrateGeoPoint(geo, point)),
    rotationDeg: zone.rotation ?? 0,
    fillColor: zone.fill_color,
    notes: zone.notes,
  }
}

function serializeZoneEntity(zone: SceneZoneEntity, geo: SceneGeoFrame): Zone {
  return {
    name: zone.name,
    locked: zone.locked,
    zone_type: zone.zoneType,
    points: zone.zoneType === 'ellipse' && zone.points.length >= 2
      ? serializeGeoEllipse(geo, zone.points[0]!, zone.points[1]!)
      : zone.points.map((point) => serializeGeoPoint(geo, point)),
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

function hydrateAnnotationEntity(annotation: Annotation, geo: SceneGeoFrame): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id: annotation.id,
    locked: annotation.locked ?? false,
    annotationType: annotation.annotation_type,
    position: hydrateGeoPoint(geo, annotation.position),
    text: annotation.text,
    fontSize: annotation.font_size,
    rotationDeg: annotation.rotation,
  }
}

function serializeAnnotationEntity(annotation: SceneAnnotationEntity, geo: SceneGeoFrame): Annotation {
  return {
    id: annotation.id,
    locked: annotation.locked,
    annotation_type: annotation.annotationType,
    position: serializeGeoPoint(geo, annotation.position),
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
  geo: SceneGeoFrame,
): SceneMeasurementGuideEntity {
  return {
    kind: 'measurement-guide',
    id: guide.id || `measurement-guide-${index + 1}`,
    locked: guide.locked ?? false,
    start: hydrateGeoPoint(geo, guide.start),
    end: hydrateGeoPoint(geo, guide.end),
  }
}

function serializeMeasurementGuideEntity(guide: SceneMeasurementGuideEntity, geo: SceneGeoFrame): MeasurementGuide {
  return {
    id: guide.id,
    locked: guide.locked,
    start: serializeGeoPoint(geo, guide.start),
    end: serializeGeoPoint(geo, guide.end),
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

// Ruler guides persist in `extra.guides`: a horizontal guide is a latitude and
// a vertical guide a longitude; the runtime holds their plane offsets.
interface StoredGuide {
  id: string
  axis: 'h' | 'v'
  lat?: number
  lon?: number
}

function hydrateGuides(raw: unknown, geo: SceneGeoFrame): SceneGuide[] {
  if (!Array.isArray(raw)) return []
  const guides: SceneGuide[] = []
  for (const candidate of raw as Partial<StoredGuide>[]) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string') continue
    if (candidate.axis === 'h' && Number.isFinite(candidate.lat)) {
      guides.push({ id: candidate.id, axis: 'h', position: hydrateGeoLatitude(geo, candidate.lat!) })
    } else if (candidate.axis === 'v' && Number.isFinite(candidate.lon)) {
      guides.push({ id: candidate.id, axis: 'v', position: hydrateGeoLongitude(geo, candidate.lon!) })
    }
  }
  return guides
}

function serializeGuide(guide: SceneGuide, geo: SceneGeoFrame): StoredGuide {
  return guide.axis === 'h'
    ? { id: guide.id, axis: 'h', lat: serializeGeoLatitude(geo, guide.position) }
    : { id: guide.id, axis: 'v', lon: serializeGeoLongitude(geo, guide.position) }
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
