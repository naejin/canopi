import type * as Contracts from '../generated/contracts'

export type Layer = Contracts.Layer
export type GeoPoint = Contracts.GeoPoint
export type Zone = Contracts.Zone
export type Annotation = Contracts.Annotation
export type MeasurementGuide = Contracts.MeasurementGuide
export type ObjectGroup = Contracts.ObjectGroup
export type PanelTarget = Contracts.PanelTarget
export type SpeciesPanelTarget = Contracts.SpeciesPanelTarget
export type TimelineAction = Contracts.TimelineAction
export type BudgetItem = Contracts.BudgetItem
export type DesignSummary = Contracts.DesignSummary
export type RecentDesignPreview = Contracts.RecentDesignPreview
export type RecentDesignUnreadableReason = Contracts.RecentDesignUnreadableReason
export type RecentDesignSummary = Contracts.RecentDesignSummary
export type DesignSketch = Contracts.DesignSketch
export type DesignNotebookEntry = Contracts.DesignNotebookEntry
export type DesignNotebookSection = Contracts.DesignNotebookSection
export type DesignNotebookSnapshot = Contracts.DesignNotebookSnapshot
export type DesignDraftSummary = Contracts.DesignDraftSummary
export type DesignSaveOutcome = Contracts.DesignSaveOutcome
export type DesignLoadFailure = Contracts.DesignLoadFailure
export type DesignLoadFailureKind = Contracts.DesignLoadFailureKind
export type Consortium = Contracts.Consortium
export type SavedView = Contracts.SavedView
export type SavedViewCamera = Contracts.SavedViewCamera
export type SavedViewLayers = Contracts.SavedViewLayers
export type SavedViewBackground = Contracts.SavedViewBackground
export type SavedViewHighlight = Contracts.SavedViewHighlight
export type SavedViewObject = Contracts.SavedViewObject
export type RichTextBlock = Contracts.RichTextBlock
export type RichTextSpan = Contracts.RichTextSpan
export type Story = Contracts.Story
export type StoryStep = Contracts.StoryStep
export type StoryImage = Contracts.StoryImage

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

/** A Design read from a file, with the fingerprint its next save must find. */
export interface LoadedDesign {
  file: CanopiFile
  fingerprint: string
  /** The file's format version when it was older and upgraded in memory (ADR 0013). */
  migrated_from: number | null
}
