import type * as Contracts from '../generated/contracts'

export type Location = Contracts.Location
export type Layer = Contracts.Layer
export type Position = Contracts.Position
export type Zone = Contracts.Zone
export type Annotation = Contracts.Annotation
export type ObjectGroup = Contracts.ObjectGroup
export type PanelTarget = Contracts.PanelTarget
export type SpeciesPanelTarget = Contracts.SpeciesPanelTarget
export type TimelineAction = Contracts.TimelineAction
export type BudgetItem = Contracts.BudgetItem
export type DesignSummary = Contracts.DesignSummary
export type AutosaveEntry = Contracts.AutosaveEntry
export type Consortium = Contracts.Consortium

export interface PlacedPlant extends Omit<Contracts.PlacedPlant, 'id' | 'color'> {
  id: string
  color: string | null
}

export interface CanopiFile extends Omit<
  Contracts.CanopiFile,
  'annotations' | 'consortiums' | 'groups' | 'timeline' | 'budget' | 'plants'
> {
  annotations: Annotation[]
  consortiums: Consortium[]
  groups: ObjectGroup[]
  timeline: TimelineAction[]
  budget: BudgetItem[]
  plants: PlacedPlant[]
  budget_currency?: string
  extra?: Record<string, unknown>
}
