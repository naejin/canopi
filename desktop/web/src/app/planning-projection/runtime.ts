import { useMemo } from 'preact/hooks'
import { plantSpeciesColorDefaults } from '../../canvas/plant-species-color-defaults'
import { plantNamesRevision, sceneEntityRevision } from '../../canvas/runtime-mirror-state'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { locale } from '../settings/state'
import { DEFAULT_BUDGET_CURRENCY } from '../contracts/document'
import { currentDesign, designName } from '../document-session/store'
import type { BudgetItem, Consortium, PlacedPlant, TimelineAction } from '../../types/design'
import { buildBudgetPlanningProjection, type BudgetPlanningProjection } from './budget'
import { buildConsortiumPlanningProjection, type ConsortiumPlanningProjection } from './consortium'
import { buildTimelinePlanningProjection, type TimelinePlanningProjection } from './timeline'

const EMPTY_PLANTS: readonly PlacedPlant[] = []
const EMPTY_NAMES: ReadonlyMap<string, string | null> = new Map()
const EMPTY_BUDGET: readonly BudgetItem[] = []
const EMPTY_TIMELINE: readonly TimelineAction[] = []
const EMPTY_CONSORTIUMS: readonly Consortium[] = []

export interface PlanningProjectionCanvasSnapshot {
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames: ReadonlyMap<string, string | null>
}

export interface BudgetPlanningSurface {
  readonly projection: BudgetPlanningProjection
  readonly currency: string
  readonly designName: string
  readonly activeLocale: string
}

export interface TimelinePlanningSurface {
  readonly actions: readonly TimelineAction[]
  readonly projection: TimelinePlanningProjection
  readonly activeLocale: string
  readonly speciesColors: Record<string, string>
}

export interface ConsortiumPlanningSurface {
  readonly consortiums: readonly Consortium[]
  readonly projection: ConsortiumPlanningProjection
  readonly activeLocale: string
}

export function usePlanningProjectionCanvasSnapshot(): PlanningProjectionCanvasSnapshot {
  const session = currentCanvasQuerySurface.value
  const sceneRevision = sceneEntityRevision.value
  const namesRevision = plantNamesRevision.value
  const activeLocale = locale.value

  return useMemo(() => ({
    plants: session?.getPlacedPlants() ?? EMPTY_PLANTS,
    localizedNames: session?.getLocalizedCommonNames() ?? EMPTY_NAMES,
  }), [session, sceneRevision, namesRevision, activeLocale])
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
  }), [snapshot.plants, snapshot.localizedNames, budget, currency, locale])
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

export function useTimelinePlanningProjection({
  actions,
  fallbackOriginMs,
  locale,
}: {
  readonly actions: readonly TimelineAction[]
  readonly fallbackOriginMs: number
  readonly locale: string
}): TimelinePlanningProjection {
  const snapshot = usePlanningProjectionCanvasSnapshot()

  return useMemo(() => buildTimelinePlanningProjection({
    actions,
    plants: snapshot.plants,
    localizedNames: snapshot.localizedNames,
    fallbackOriginMs,
    locale,
  }), [snapshot.plants, snapshot.localizedNames, actions, fallbackOriginMs, locale])
}

export function useTimelinePlanningSurface({
  fallbackOriginMs,
}: {
  readonly fallbackOriginMs: number
}): TimelinePlanningSurface {
  const actions = currentDesign.value?.timeline ?? EMPTY_TIMELINE
  const activeLocale = locale.value
  const speciesColors = plantSpeciesColorDefaults.value
  const projection = useTimelinePlanningProjection({
    actions,
    fallbackOriginMs,
    locale: activeLocale,
  })

  return {
    actions,
    projection,
    activeLocale,
    speciesColors,
  }
}

export function useConsortiumPlanningProjection({
  consortiums,
  speciesColors,
}: {
  readonly consortiums: readonly Consortium[]
  readonly speciesColors: Record<string, string>
}): ConsortiumPlanningProjection {
  const snapshot = usePlanningProjectionCanvasSnapshot()

  return useMemo(() => buildConsortiumPlanningProjection({
    consortiums,
    plants: snapshot.plants,
    speciesColors,
    localizedNames: snapshot.localizedNames,
  }), [snapshot.plants, snapshot.localizedNames, consortiums, speciesColors])
}

export function useConsortiumPlanningSurface(): ConsortiumPlanningSurface {
  const consortiums = currentDesign.value?.consortiums ?? EMPTY_CONSORTIUMS
  const speciesColors = plantSpeciesColorDefaults.value
  const activeLocale = locale.value
  const projection = useConsortiumPlanningProjection({
    consortiums,
    speciesColors,
  })

  return {
    consortiums,
    projection,
    activeLocale,
  }
}
