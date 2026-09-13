import type { PanelTarget, PlacedPlant, TimelineAction } from '../../types/design'
import { normalizeSearchText } from '../../utils/normalize-search'
import type { CalendarCompletionFilter } from '../planning-view/state'
import {
  buildCivilMonthGrid,
  civilDateInRange,
  compareCivilDates,
  endOfCivilMonth,
  formatCivilDate,
  localToday,
  parseCivilDate,
  startOfCivilMonth,
  type CivilDate,
} from '../timeline/civil-date'

export interface CalendarTargetLabel {
  readonly target: PanelTarget
  readonly kind: PanelTarget['kind']
  readonly label: string
  readonly unavailable: boolean
}

export interface CalendarPlanningAction {
  readonly id: string
  readonly actionType: string
  readonly description: string
  readonly startDate: string | null
  readonly endDate: string | null
  readonly parsedStart: CivilDate | null
  readonly parsedEnd: CivilDate | null
  readonly invalidStart: boolean
  readonly invalidEnd: boolean
  readonly invalidRange: boolean
  readonly completed: boolean
  readonly order: number
  readonly recurrence: string | null
  readonly targets: readonly PanelTarget[]
  readonly targetLabels: readonly CalendarTargetLabel[]
  readonly searchText: string
}

export interface CalendarDayProjection {
  readonly date: CivilDate
  readonly dateKey: string
  readonly inMonth: boolean
  readonly actions: readonly CalendarPlanningAction[]
}

export interface CalendarAgendaGroup {
  readonly date: CivilDate
  readonly dateKey: string
  readonly actions: readonly CalendarPlanningAction[]
}

export interface CalendarPlanningProjection {
  readonly month: CivilDate
  readonly weeks: readonly (readonly CalendarDayProjection[])[]
  readonly agenda: readonly CalendarAgendaGroup[]
  readonly unscheduled: readonly CalendarPlanningAction[]
  readonly filteredCount: number
}

export function buildCalendarPlanningProjection(options: {
  readonly actions: readonly TimelineAction[]
  readonly plants: readonly PlacedPlant[]
  readonly localizedNames?: ReadonlyMap<string, string | null>
  readonly zoneNames?: readonly string[]
  readonly month: string
  readonly search: string
  readonly actionType: string
  readonly completion: CalendarCompletionFilter
  readonly locale: string
}): CalendarPlanningProjection {
  const month = startOfCivilMonth(parseCivilDate(options.month) ?? localToday())
  const monthStart = startOfCivilMonth(month)
  const monthEnd = endOfCivilMonth(month)
  const projected = options.actions.map((action) => projectCalendarAction(
    action,
    options.plants,
    options.localizedNames,
    options.zoneNames ?? [],
  ))
  const needle = normalizeSearchText(options.search.trim())
  const filtered = projected.filter((action) => {
    if (options.actionType !== 'all' && action.actionType !== options.actionType) return false
    if (options.completion === 'open' && action.completed) return false
    if (options.completion === 'completed' && !action.completed) return false
    return needle === '' || action.searchText.includes(needle)
  })
  const unscheduled = filtered
    .filter((action) => action.parsedStart === null)
    .sort(compareCalendarActions)
  const scheduled = filtered.filter((action) => action.parsedStart !== null)
  const agendaBuckets = new Map<string, CalendarPlanningAction[]>()

  for (const action of scheduled) {
    const start = action.parsedStart!
    const end = effectiveCalendarEnd(action)
    if (compareCivilDates(start, monthEnd) > 0 || compareCivilDates(end, monthStart) < 0) continue
    const clippedStart = compareCivilDates(start, monthStart) < 0 ? monthStart : start
    const dateKey = formatCivilDate(clippedStart)
    const bucket = agendaBuckets.get(dateKey) ?? []
    bucket.push(action)
    agendaBuckets.set(dateKey, bucket)
  }

  const agenda = [...agendaBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, actions]) => ({
      date: parseCivilDate(dateKey)!,
      dateKey,
      actions: actions.sort(compareCalendarActions),
    }))

  const weeks = buildCivilMonthGrid(month, options.locale).map((week) => week.map((date) => {
    const actions = scheduled
      .filter((action) => civilDateInRange(date, action.parsedStart!, effectiveCalendarEnd(action)))
      .sort(compareCalendarActions)
    return {
      date,
      dateKey: formatCivilDate(date),
      inMonth: date.month === month.month && date.year === month.year,
      actions,
    }
  }))

  return {
    month,
    weeks,
    agenda,
    unscheduled,
    filteredCount: filtered.length,
  }
}

export function projectCalendarAction(
  action: TimelineAction,
  plants: readonly PlacedPlant[],
  localizedNames: ReadonlyMap<string, string | null> | undefined,
  zoneNames: readonly string[],
): CalendarPlanningAction {
  const parsedStart = parseCivilDate(action.start_date)
  const parsedEnd = parseCivilDate(action.end_date)
  const targetLabels = action.targets.map((target) => projectCalendarTargetLabel(
    target,
    plants,
    localizedNames,
    zoneNames,
  ))
  return {
    id: action.id,
    actionType: action.action_type,
    description: action.description,
    startDate: action.start_date,
    endDate: action.end_date,
    parsedStart,
    parsedEnd,
    invalidStart: action.start_date !== null && parsedStart === null,
    invalidEnd: action.end_date !== null && parsedEnd === null,
    invalidRange: parsedStart !== null && parsedEnd !== null
      && compareCivilDates(parsedStart, parsedEnd) > 0,
    completed: action.completed,
    order: action.order,
    recurrence: action.recurrence,
    targets: action.targets,
    targetLabels,
    searchText: normalizeSearchText(
      `${action.description} ${targetLabels.map((target) => target.label).join(' ')}`,
    ),
  }
}

export function compareCalendarActions(
  left: CalendarPlanningAction,
  right: CalendarPlanningAction,
): number {
  const leftDate = left.parsedStart ? formatCivilDate(left.parsedStart) : ''
  const rightDate = right.parsedStart ? formatCivilDate(right.parsedStart) : ''
  return leftDate.localeCompare(rightDate) || left.order - right.order || left.id.localeCompare(right.id)
}

function effectiveCalendarEnd(action: CalendarPlanningAction): CivilDate {
  if (
    action.parsedEnd
    && action.parsedStart
    && compareCivilDates(action.parsedEnd, action.parsedStart) >= 0
  ) return action.parsedEnd
  return action.parsedStart!
}

function projectCalendarTargetLabel(
  target: PanelTarget,
  plants: readonly PlacedPlant[],
  localizedNames: ReadonlyMap<string, string | null> | undefined,
  zoneNames: readonly string[],
): CalendarTargetLabel {
  switch (target.kind) {
    case 'manual':
      return { target, kind: target.kind, label: '', unavailable: false }
    case 'none':
      return { target, kind: target.kind, label: '', unavailable: false }
    case 'species': {
      const plant = plants.find((candidate) => candidate.canonical_name === target.canonical_name)
      return {
        target,
        kind: target.kind,
        label: localizedNames?.get(target.canonical_name)
          ?? plant?.common_name
          ?? target.canonical_name,
        unavailable: plant === undefined,
      }
    }
    case 'placed_plant': {
      const plant = plants.find((candidate) => candidate.id === target.plant_id)
      return {
        target,
        kind: target.kind,
        label: plant
          ? localizedNames?.get(plant.canonical_name) ?? plant.common_name ?? plant.canonical_name
          : target.plant_id,
        unavailable: plant === undefined,
      }
    }
    case 'zone':
      return {
        target,
        kind: target.kind,
        label: target.zone_name,
        unavailable: !zoneNames.includes(target.zone_name),
      }
  }
}
