import type { TimelineAction } from '../types/design'
import { mutateCurrentDesign } from './document-mutations'

interface TimelineUpdateOptions {
  markDirty?: boolean
}

function updateTimeline(
  updater: (timeline: TimelineAction[]) => TimelineAction[],
  options: TimelineUpdateOptions = {},
): void {
  mutateCurrentDesign((design) => ({
    ...design,
    timeline: updater(design.timeline ?? []),
  }), { markDirty: options.markDirty !== false })
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
