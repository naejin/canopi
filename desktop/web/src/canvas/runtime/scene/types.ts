import type {
  SceneConcreteDesignObjectTarget,
  SceneDesignObjectSelection,
  SceneDesignObjectTarget,
} from './design-object-targets'

export interface ScenePoint {
  x: number
  y: number
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
  locked: boolean
  canonicalName: string
  commonName: string | null
  color: string | null
  symbol?: string | null
  pinnedName?: boolean
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
  locked: boolean
  zoneType: string
  points: ScenePoint[]
  rotationDeg: number
  fillColor: string | null
  notes: string | null
}

export interface SceneAnnotationEntity {
  kind: 'annotation'
  id: string
  locked: boolean
  annotationType: string
  position: ScenePoint
  text: string
  fontSize: number
  rotationDeg: number | null
}

export interface SceneMeasurementGuideEntity {
  kind: 'measurement-guide'
  id: string
  locked: boolean
  start: ScenePoint
  end: ScenePoint
}

export type SceneObjectGroupMember = SceneConcreteDesignObjectTarget

export interface SceneObjectGroupEntity {
  kind: 'group'
  id: string
  locked: boolean
  name: string | null
  members: SceneObjectGroupMember[]
}

export interface SceneGuide {
  id: string
  axis: 'h' | 'v'
  position: number
}

export interface ScenePersistedState {
  plantSpeciesColors: Record<string, string>
  plantSpeciesSymbols: Record<string, string>
  layers: SceneLayerEntity[]
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  measurementGuides: SceneMeasurementGuideEntity[]
  groups: SceneObjectGroupEntity[]
  guides: SceneGuide[]
}

export interface SceneViewportState {
  x: number
  y: number
  scale: number
}

export interface SceneSessionState {
  selectedTargets: SceneDesignObjectSelection
  hoveredTarget: SceneDesignObjectTarget | null
  documentRevision: number
}
