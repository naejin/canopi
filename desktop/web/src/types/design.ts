import type * as Contracts from '../generated/contracts'

export type Location = Contracts.Location
export type Layer = Contracts.Layer
export type Position = Contracts.Position
export type Zone = Contracts.Zone
export type Annotation = Contracts.Annotation
export type MeasurementGuide = Contracts.MeasurementGuide
export type ObjectGroup = Contracts.ObjectGroup
export type PanelTarget = Contracts.PanelTarget
export type SpeciesPanelTarget = Contracts.SpeciesPanelTarget
export type TimelineAction = Contracts.TimelineAction
export type BudgetItem = Contracts.BudgetItem
export type DesignSummary = Contracts.DesignSummary
export type AutosaveEntry = Contracts.AutosaveEntry
export type Consortium = Contracts.Consortium

export interface PlacedPlant extends Omit<Contracts.PlacedPlant, 'id' | 'color' | 'symbol' | 'pinned_name'> {
  id: string
  color: string | null
  symbol?: string | null
  pinned_name?: boolean
}

export interface CanopiFile extends Omit<
  Contracts.CanopiFile,
  'annotations' | 'measurement_guides' | 'consortiums' | 'groups' | 'timeline' | 'budget' | 'plants' | 'plant_species_symbols'
> {
  plant_species_symbols?: Record<string, string>
  annotations: Annotation[]
  measurement_guides?: MeasurementGuide[]
  consortiums: Consortium[]
  groups: ObjectGroup[]
  timeline: TimelineAction[]
  budget: BudgetItem[]
  plants: PlacedPlant[]
  extra?: Record<string, unknown>
}
