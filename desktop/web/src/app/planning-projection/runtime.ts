import { useMemo } from 'preact/hooks'
import { currentCanvasQuerySurface, currentCanvasSelection } from '../../canvas/session'
import { buildSpeciesKey, type SpeciesKeyEntry } from '../../canvas/runtime/species-key'
import { locale } from '../settings/state'
import { DEFAULT_BUDGET_CURRENCY } from '../contracts/document'
import { currentDesign, designName } from '../document-session/store'
import type { BudgetItem, Consortium, PlacedPlant, TimelineAction } from '../../types/design'
import { buildBudgetPlanningProjection, type BudgetPlanningProjection } from './budget'
import { buildConsortiumPlanningProjection, type ConsortiumPlanningProjection } from './consortium'
import { buildTimelineSpeciesOptions, type TimelineSpeciesOption } from './timeline'
import { buildCalendarPlanningProjection, type CalendarPlanningProjection } from './calendar'

const EMPTY_PLANTS: readonly PlacedPlant[] = []
const EMPTY_NAMES: ReadonlyMap<string, string | null> = new Map()
const EMPTY_BUDGET: readonly BudgetItem[] = []
const EMPTY_TIMELINE: readonly TimelineAction[] = []
const EMPTY_CONSORTIUMS: readonly Consortium[] = []

export interface PlanningProjectionCanvasSnapshot {
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames: ReadonlyMap<string, string | null>
  readonly speciesKey: readonly SpeciesKeyEntry[]
  readonly zoneNames: readonly string[]
  readonly selectedPlantIds: readonly string[]
}

export interface BudgetPlanningSurface {
  readonly projection: BudgetPlanningProjection
  readonly currency: string
  readonly designName: string
  readonly activeLocale: string
}

export interface CalendarPlanningSurface {
  readonly actions: readonly TimelineAction[]
  readonly projection: CalendarPlanningProjection
  readonly activeLocale: string
  readonly selectedPlantIds: readonly string[]
  readonly readSelectedPlantIds: () => readonly string[]
  readonly zoneNames: readonly string[]
  readonly speciesList: readonly TimelineSpeciesOption[]
}

export interface ConsortiumPlanningSurface {
  readonly consortiums: readonly Consortium[]
  readonly projection: ConsortiumPlanningProjection
  readonly activeLocale: string
}

export function usePlanningProjectionCanvasSnapshot(): PlanningProjectionCanvasSnapshot {
  const session = currentCanvasQuerySurface.value
  const sceneRevision = session?.revision.scene.value ?? 0
  const plantNamesRevision = session?.revision.plantNames.value ?? 0
  const selection = currentCanvasSelection.value
  const activeLocale = locale.value

  return useMemo(() => ({
    plants: session?.getPlacedPlants() ?? EMPTY_PLANTS,
    localizedNames: session?.getLocalizedCommonNames() ?? EMPTY_NAMES,
    speciesKey: session
      ? buildSpeciesKey(session.getSceneSnapshot(), session.getLocalizedCommonNames())
      : [],
    zoneNames: session?.getSceneSnapshot().zones.map((zone) => zone.name) ?? [],
    selectedPlantIds: session?.getSelectedPlantColorContext().plantIds ?? [],
  }), [session, sceneRevision, plantNamesRevision, selection, activeLocale])
}

export function useBudgetPlanningProjection({
  budget,
  currency,
  locale,
}: {
  readonly budget: readonly BudgetItem[]
  readonly currency: string
  readonly locale: string
}): BudgetPlanningProjection {
  const snapshot = usePlanningProjectionCanvasSnapshot()

  return useMemo(() => buildBudgetPlanningProjection({
    plants: snapshot.plants,
    localizedNames: snapshot.localizedNames,
    budget,
    currency,
    locale,
    speciesKey: snapshot.speciesKey,
  }), [snapshot.plants, snapshot.localizedNames, snapshot.speciesKey, budget, currency, locale])
}

export function useBudgetPlanningSurface(): BudgetPlanningSurface {
  const design = currentDesign.value
  const budget = design?.budget ?? EMPTY_BUDGET
  const currency = design?.budget_currency ?? DEFAULT_BUDGET_CURRENCY
  const activeLocale = locale.value
  const projection = useBudgetPlanningProjection({
    budget,
    currency,
    locale: activeLocale,
  })

  return {
    projection,
    currency,
    designName: designName.value,
    activeLocale,
  }
}

export function useCalendarPlanningSurface(options: {
  readonly month: string
  readonly search: string
  readonly actionType: string
  readonly completion: import('../planning-view/state').CalendarCompletionFilter
}): CalendarPlanningSurface {
  const actions = currentDesign.value?.timeline ?? EMPTY_TIMELINE
  const activeLocale = locale.value
  const snapshot = usePlanningProjectionCanvasSnapshot()
  const projection = useMemo(() => buildCalendarPlanningProjection({
    actions,
    plants: snapshot.plants,
    localizedNames: snapshot.localizedNames,
    zoneNames: snapshot.zoneNames,
    month: options.month,
    search: options.search,
    actionType: options.actionType,
    completion: options.completion,
    locale: activeLocale,
  }), [
    actions,
    activeLocale,
    options.actionType,
    options.completion,
    options.month,
    options.search,
    snapshot.localizedNames,
    snapshot.plants,
    snapshot.zoneNames,
  ])
  return {
    actions,
    projection,
    activeLocale,
    selectedPlantIds: snapshot.selectedPlantIds,
    readSelectedPlantIds: () => (
      currentCanvasQuerySurface.peek()?.getSelectedPlantColorContext().plantIds ?? []
    ),
    zoneNames: snapshot.zoneNames,
    speciesList: buildTimelineSpeciesOptions(snapshot.plants, snapshot.localizedNames, activeLocale),
  }
}

export function useConsortiumPlanningProjection({
  consortiums,
}: {
  readonly consortiums: readonly Consortium[]
}): ConsortiumPlanningProjection {
  const snapshot = usePlanningProjectionCanvasSnapshot()

  return useMemo(() => buildConsortiumPlanningProjection({
    consortiums,
    plants: snapshot.plants,
    localizedNames: snapshot.localizedNames,
    speciesKey: snapshot.speciesKey,
  }), [snapshot.plants, snapshot.localizedNames, snapshot.speciesKey, consortiums])
}

export function useConsortiumPlanningSurface(): ConsortiumPlanningSurface {
  const consortiums = currentDesign.value?.consortiums ?? EMPTY_CONSORTIUMS
  const activeLocale = locale.value
  const projection = useConsortiumPlanningProjection({ consortiums })

  return {
    consortiums,
    projection,
    activeLocale,
  }
}
