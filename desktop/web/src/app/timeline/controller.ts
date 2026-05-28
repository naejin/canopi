import type { TimelineAction } from '../../types/design'
import { updateDesignArray } from '../document/controller'
import { applyTimelineActionPatch } from './model'

export { applyTimelineActionPatch } from './model'

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

export function deleteTimelineAction(actionId: string): void {
  updateTimeline((timeline) => {
    if (!timeline.some((action) => action.id === actionId)) return timeline
    return timeline.filter((action) => action.id !== actionId)
  })
}
