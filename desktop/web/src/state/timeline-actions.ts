import type { TimelineAction } from '../types/design'
import { panelTargetsEqual } from '../panel-targets'
import { updateDesignArray } from './document-mutations'

interface TimelineUpdateOptions {
  markDirty?: boolean
}

function updateTimeline(
  updater: (timeline: TimelineAction[]) => TimelineAction[],
  options: TimelineUpdateOptions = {},
): void {
  updateDesignArray('timeline', updater, options)
}

export function addTimelineAction(action: Omit<TimelineAction, 'order'>): void {
  updateTimeline((timeline) => {
    let maxOrder = -1
    for (const a of timeline) if (a.order > maxOrder) maxOrder = a.order
    return [...timeline, { ...action, order: maxOrder + 1 }]
  })
}

export function updateTimelineAction(
  actionId: string,
  patch: Partial<TimelineAction>,
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline(
    (timeline) => {
      const idx = timeline.findIndex((a) => a.id === actionId)
      if (idx === -1) return timeline
      const existing = timeline[idx]!
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
      ) return timeline
      const updated = [...timeline]
      updated[idx] = next
      return updated
    },
    options,
  )
}

export function deleteTimelineAction(
  actionId: string,
  options: TimelineUpdateOptions = {},
): void {
  updateTimeline((timeline) => {
    if (!timeline.some((a) => a.id === actionId)) return timeline
    return timeline.filter((a) => a.id !== actionId)
  }, options)
}
