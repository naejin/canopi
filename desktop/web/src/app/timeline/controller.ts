import type { TimelineAction } from '../../types/design'
import { panelTargetsEqual } from '../../panel-targets'
import { updateDesignArray } from '../document/controller'

function updateTimeline(
  updater: (timeline: TimelineAction[]) => TimelineAction[],
): void {
  updateDesignArray('timeline', updater)
}

export function addTimelineAction(action: Omit<TimelineAction, 'order'>): void {
  updateTimeline((timeline) => {
    let maxOrder = -1
    for (const existing of timeline) {
      if (existing.order > maxOrder) maxOrder = existing.order
    }
    return [...timeline, { ...action, order: maxOrder + 1 }]
  })
}

export function updateTimelineAction(
  actionId: string,
  patch: Partial<TimelineAction>,
): void {
  updateTimeline((timeline) => applyTimelineActionPatch(timeline, actionId, patch))
}

export function applyTimelineActionPatch(
  timeline: TimelineAction[],
  actionId: string,
  patch: Partial<TimelineAction>,
): TimelineAction[] {
  const index = timeline.findIndex((action) => action.id === actionId)
  if (index === -1) return timeline
  const existing = timeline[index]!
  const next = { ...existing, ...patch }
  if (
    next.start_date === existing.start_date &&
    next.end_date === existing.end_date &&
    next.action_type === existing.action_type &&
    next.description === existing.description &&
    next.order === existing.order &&
    next.completed === existing.completed &&
    next.recurrence === existing.recurrence &&
    panelTargetsEqual(next.targets, existing.targets) &&
    next.depends_on === existing.depends_on
  ) {
    return timeline
  }

  const updated = [...timeline]
  updated[index] = next
  return updated
}

export function deleteTimelineAction(actionId: string): void {
  updateTimeline((timeline) => {
    if (!timeline.some((action) => action.id === actionId)) return timeline
    return timeline.filter((action) => action.id !== actionId)
  })
}
