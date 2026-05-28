import { useMemo } from 'preact/hooks'
import { plantNamesRevision, sceneEntityRevision } from '../../canvas/runtime-mirror-state'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { locale } from '../settings/state'
import type { BudgetItem, Consortium, PlacedPlant, TimelineAction } from '../../types/design'
import { buildBudgetPlanningProjection, type BudgetPlanningProjection } from './budget'
import { buildConsortiumPlanningProjection, type ConsortiumPlanningProjection } from './consortium'
import { buildTimelinePlanningProjection, type TimelinePlanningProjection } from './timeline'

const EMPTY_PLANTS: readonly PlacedPlant[] = []
const EMPTY_NAMES: ReadonlyMap<string, string | null> = new Map()

export interface PlanningProjectionCanvasSnapshot {
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames: ReadonlyMap<string, string | null>
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
