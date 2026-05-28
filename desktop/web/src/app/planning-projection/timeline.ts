import { getTimelineSpeciesTarget } from '../../panel-targets'
import type { PanelTarget, PlacedPlant, TimelineAction } from '../../types/design'

export type ActionType = 'planting' | 'pruning' | 'harvest' | 'watering' | 'fertilising' | 'other'
export const ACTION_TYPES: readonly ActionType[] = ['planting', 'pruning', 'harvest', 'watering', 'fertilising', 'other']

export interface TimelinePlanningAction {
  readonly id: string
  readonly actionType: string
  readonly description: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly targets: readonly PanelTarget[]
  readonly speciesCanonical: string | null
}

export interface TimelineActionTypeRow {
  readonly actionType: string
  readonly actions: readonly TimelinePlanningAction[]
}

export interface TimelineActionLayout {
  readonly rowIndex: number
  readonly subLane: number
  readonly totalSubLanes: number
}

export interface TimelineSpeciesOption {
  readonly canonical_name: string
  readonly display_name: string
}

export interface TimelinePlanningProjection {
  readonly rows: readonly TimelineActionTypeRow[]
  readonly layout: ReadonlyMap<string, TimelineActionLayout>
  readonly speciesList: readonly TimelineSpeciesOption[]
  readonly originMs: number
}

export interface BuildTimelinePlanningProjectionOptions {
  readonly actions: readonly TimelineAction[]
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
  readonly fallbackOriginMs: number
  readonly locale: string
}

export function buildTimelinePlanningProjection({
  actions,
  plants,
  localizedNames,
  fallbackOriginMs,
  locale,
}: BuildTimelinePlanningProjectionOptions): TimelinePlanningProjection {
  const rows = groupTimelineActionsByType(actions)
  return {
    rows,
    layout: computeTimelineActionLayout(rows),
    speciesList: buildTimelineSpeciesOptions(plants, localizedNames, locale),
    originMs: computeTimelineOriginMs(actions, fallbackOriginMs),
  }
}

export function projectTimelineAction(action: TimelineAction): TimelinePlanningAction {
  const speciesTarget = getTimelineSpeciesTarget(action)
  return {
    id: action.id,
    actionType: action.action_type,
    description: action.description,
    startDate: action.start_date,
    endDate: action.end_date,
    targets: action.targets,
    speciesCanonical: speciesTarget?.canonical_name ?? null,
  }
}

/**
 * Group actions by action type into fixed rows.
 * Always returns the same row order, even if a row has no actions.
 */
export function groupTimelineActionsByType(
  actions: readonly TimelineAction[],
): TimelineActionTypeRow[] {
  const buckets = new Map<string, TimelinePlanningAction[]>()
  for (const type of ACTION_TYPES) buckets.set(type, [])

  for (const action of actions) {
    const bucket = buckets.get(action.action_type) ?? buckets.get('other')!
    bucket.push(projectTimelineAction(action))
  }

  return ACTION_TYPES.map((type) => ({
    actionType: type,
    actions: buckets.get(type)!,
  }))
}

export function computeTimelineActionLayout(
  rows: readonly TimelineActionTypeRow[],
): Map<string, TimelineActionLayout> {
  const layout = new Map<string, TimelineActionLayout>()

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!
    const sorted = [...row.actions].sort((left, right) => {
      const leftStart = left.startDate ? new Date(left.startDate).getTime() : Infinity
      const rightStart = right.startDate ? new Date(right.startDate).getTime() : Infinity
      return leftStart - rightStart
    })

    const laneEnds: number[] = []

    for (const action of sorted) {
      const startMs = action.startDate ? new Date(action.startDate).getTime() : Infinity
      const endMs = action.endDate ? new Date(action.endDate).getTime() : (isFinite(startMs) ? startMs + 86400000 : Infinity)

      let assigned = -1
      for (let i = 0; i < laneEnds.length; i++) {
        if (startMs >= laneEnds[i]!) {
          assigned = i
          laneEnds[i] = endMs
          break
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length
        laneEnds.push(endMs)
      }

      layout.set(action.id, {
        rowIndex,
        subLane: assigned,
        totalSubLanes: 0,
      })
    }

    const totalSubLanes = Math.max(laneEnds.length, 1)
    for (const action of sorted) {
      const entry = layout.get(action.id)!
      layout.set(action.id, {
        ...entry,
        totalSubLanes,
      })
    }
  }

  return layout
}

export function buildTimelineSpeciesOptions(
  plants: readonly PlacedPlant[],
  localizedNames: ReadonlyMap<string, string | null> | undefined,
  locale: string,
): TimelineSpeciesOption[] {
  const seen = new Set<string>()
  const result: TimelineSpeciesOption[] = []

  for (const plant of plants) {
    if (seen.has(plant.canonical_name)) continue
    seen.add(plant.canonical_name)
    result.push({
      canonical_name: plant.canonical_name,
      display_name: localizedNames?.get(plant.canonical_name) ?? plant.common_name ?? plant.canonical_name,
    })
  }

  result.sort((left, right) => left.display_name.localeCompare(right.display_name, locale))
  return result
}

export function computeTimelineOriginMs(
  actions: readonly TimelineAction[],
  fallbackMs: number,
): number {
  let earliest = Infinity
  for (const action of actions) {
    if (!action.start_date) continue
    const ms = new Date(action.start_date).getTime()
    if (ms < earliest) earliest = ms
  }
  return (isFinite(earliest) ? earliest : fallbackMs) - 30 * 86400000
}
