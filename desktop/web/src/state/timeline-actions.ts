import { currentDesign, nonCanvasRevision } from './design'
import type { PlacedPlant, TimelineAction } from '../types/design'

interface TimelineUpdateOptions {
  markDirty?: boolean
}

function updateTimeline(
  updater: (timeline: TimelineAction[]) => TimelineAction[],
  options: TimelineUpdateOptions = {},
): void {
  const design = currentDesign.value
  if (!design) return
  currentDesign.value = {
    ...design,
    timeline: updater(design.timeline),
  }
  if (options.markDirty !== false) {
    nonCanvasRevision.value += 1
  }
}

export function addTimelineAction(action: TimelineAction): void {
  updateTimeline((timeline) => [...timeline, action])
}

export function updateTimelineAction(
  actionId: string,
  patch: Partial<TimelineAction>,
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline(
    (timeline) => timeline.map((action) => (action.id === actionId ? { ...action, ...patch } : action)),
    options,
  )
}

export function replaceTimelineAction(
  actionId: string,
  next: TimelineAction,
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline(
    (timeline) => timeline.map((action) => (action.id === actionId ? next : action)),
    options,
  )
}

export function replaceTimelineActions(
  actions: TimelineAction[],
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline(() => actions, options)
}

export function deleteTimelineAction(
  actionId: string,
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline((timeline) => timeline.filter((action) => action.id !== actionId), options)
}

export function toggleTimelineActionCompleted(actionId: string): void {
  updateTimeline((timeline) =>
    timeline.map((action) =>
      action.id === actionId ? { ...action, completed: !action.completed } : action,
    ),
  )
}

export function appendAutoTimelineActions(actions: TimelineAction[]): void {
  if (actions.length === 0) return
  updateTimeline((timeline) => [...timeline, ...actions])
}

export function markTimelineDirty(): void {
  nonCanvasRevision.value += 1
}

export function buildDefaultTimelineActions(
  plants: PlacedPlant[],
  existing: TimelineAction[],
  plantingLabel: string,
  harvestLabel: string,
): TimelineAction[] {
  const existingKeys = new Set(existing.map((action) => `${action.plants?.[0] ?? ''}-${action.action_type}`))
  const year = new Date().getFullYear()
  const nextActions: TimelineAction[] = []

  for (const plant of plants) {
    const canonical = plant.canonical_name
    const displayName = plant.common_name || canonical
    const plantingKey = `${canonical}-planting`
    const harvestKey = `${canonical}-harvest`

    if (!existingKeys.has(plantingKey)) {
      nextActions.push({
        id: crypto.randomUUID(),
        action_type: 'planting',
        description: `${plantingLabel} - ${displayName}`,
        start_date: `${year}-03-15`,
        end_date: `${year}-04-15`,
        recurrence: null,
        plants: [canonical],
        zone: null,
        depends_on: null,
        completed: false,
        order: existing.length + nextActions.length,
      })
      existingKeys.add(plantingKey)
    }

    if (!existingKeys.has(harvestKey)) {
      nextActions.push({
        id: crypto.randomUUID(),
        action_type: 'harvest',
        description: `${harvestLabel} - ${displayName}`,
        start_date: `${year}-08-01`,
        end_date: `${year}-09-30`,
        recurrence: null,
        plants: [canonical],
        zone: null,
        depends_on: null,
        completed: false,
        order: existing.length + nextActions.length,
      })
      existingKeys.add(harvestKey)
    }
  }

  return nextActions
}
