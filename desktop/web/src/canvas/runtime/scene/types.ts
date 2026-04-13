import type { ColorByAttribute, PlantSizeMode } from '../../plant-display-state'

export const SCENE_LAYER_NAMES = [
  'base',
  'contours',
  'climate',
  'zones',
  'water',
  'plants',
  'annotations',
] as const

export type SceneLayerName = (typeof SCENE_LAYER_NAMES)[number]
export type ScenePlantSizeMode = PlantSizeMode
export type SceneColorByAttribute = ColorByAttribute

export interface ScenePoint {
  x: number
  y: number
}

export interface SceneLocation {
  lat: number
  lon: number
  altitudeM: number | null
}

export interface SceneLayerEntity {
  kind: 'layer'
  name: string
  visible: boolean
  locked: boolean
  opacity: number
}

export interface ScenePlantEntity {
  kind: 'plant'
  id: string
  canonicalName: string
  commonName: string | null
  color: string | null
  stratum: string | null
  canopySpreadM: number | null
  position: ScenePoint
  rotationDeg: number | null
  // Deprecated persisted compatibility mirror for canopySpreadM.
  scale: number | null
  notes: string | null
  plantedDate: string | null
  quantity: number | null
}

export interface SceneZoneEntity {
  kind: 'zone'
  name: string
  zoneType: string
  points: ScenePoint[]
  fillColor: string | null
  notes: string | null
}

export interface SceneAnnotationEntity {
  kind: 'annotation'
  id: string
  annotationType: string
  position: ScenePoint
  text: string
  fontSize: number
  rotationDeg: number | null
}

export interface SceneObjectGroupEntity {
  kind: 'group'
  id: string
  name: string | null
  layer: string
  position: ScenePoint
  rotationDeg: number | null
  memberIds: string[]
}

export type SceneEntity =
  | SceneLayerEntity
  | ScenePlantEntity
  | SceneZoneEntity
  | SceneAnnotationEntity
  | SceneObjectGroupEntity

export interface ScenePersistedState {
  version: number
  name: string
  description: string | null
  location: SceneLocation | null
  northBearingDeg: number | null
  plantSpeciesColors: Record<string, string>
  layers: SceneLayerEntity[]
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  groups: SceneObjectGroupEntity[]
  createdAt: string
  updatedAt: string
  extra: Record<string, unknown>
}

export interface SceneViewportState {
  x: number
  y: number
  scale: number
}

export interface SceneSessionState {
  selectedEntityIds: ReadonlySet<string>
  hoveredEntityId: string | null
  activeEntityId: string | null
  activeLayerName: string | null
  plantSizeMode: ScenePlantSizeMode
  plantColorByAttr: SceneColorByAttribute | null
  viewport: SceneViewportState
  documentRevision: number
}

export interface SceneState {
  persisted: ScenePersistedState
  session: SceneSessionState
}
