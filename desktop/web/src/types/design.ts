// Mirror of common-types/src/design.rs — keep in sync with Rust types

export interface CanopiFile {
  version: number
  name: string
  description: string | null
  location: Location | null
  north_bearing_deg: number | null
  plant_species_colors: Record<string, string>
  layers: Layer[]
  plants: PlacedPlant[]
  zones: Zone[]
  annotations?: Annotation[]
  consortiums?: Consortium[]
  groups?: ObjectGroup[]
  timeline?: TimelineAction[]
  budget?: BudgetItem[]
  created_at: string
  updated_at: string
  extra?: Record<string, unknown>
}

export interface Location {
  lat: number
  lon: number
  altitude_m: number | null
}

export interface Layer {
  name: string
  visible: boolean
  locked: boolean
  opacity: number
}

export interface PlacedPlant {
  id: string
  canonical_name: string
  common_name: string | null
  color: string | null
  position: Position
  rotation: number | null
  scale: number | null
  notes: string | null
  planted_date: string | null
  quantity: number | null
}

export interface Position {
  x: number
  y: number
}

export interface Zone {
  name: string
  zone_type: string
  points: Position[]
  fill_color: string | null
  notes: string | null
}

export interface Annotation {
  id: string
  annotation_type: string
  position: Position
  text: string
  font_size: number
  rotation: number | null
}

export interface ObjectGroup {
  id: string
  name: string | null
  layer: string
  position: Position
  rotation: number | null
  member_ids: string[]
}

export interface Consortium {
  id: string
  name: string
  plant_ids: string[]
  notes: string | null
}

export interface TimelineAction {
  id: string
  action_type: string
  description: string
  start_date: string | null
  end_date: string | null
  recurrence: string | null
  plants: string[] | null
  zone: string | null
  depends_on: string[] | null
  completed: boolean
  order: number
}

export interface BudgetItem {
  category: string
  description: string
  quantity: number
  unit_cost: number
  currency: string
}

export interface DesignSummary {
  path: string
  name: string
  updated_at: string
  plant_count: number
}

export interface AutosaveEntry {
  path: string
  name: string
  saved_at: string
}
