import { toISODate } from '../../canvas/timeline-math'
import { currentDesign } from '../document-session/store'
import type { PanelTarget, TimelineAction } from '../../types/design'
import {
  clearPlanningHoveredTargets,
  clearPlanningSelectedTargetsForOrigin,
  setPlanningHoveredTargets,
  setPlanningSelectedTargets,
  type TimelineSpeciesOption,
} from '../planning-projection'
import {
  addTimelineAction,
  deleteTimelineAction,
  updateTimelineAction,
} from './controller'
import {
  createTimelineActionFromFormData,
  formDataFromTimelineAction,
  timelineActionPatchFromFormData,
  type TimelineActionFormData,
} from './editing'

const EMPTY_ACTIONS: readonly TimelineAction[] = []
const DEFAULT_ACTION_DURATION_DAYS = 14
const MS_PER_DAY = 86400000

export type TimelineActionPopoverMode = 'add' | 'edit'

export interface TimelineActionPopoverState {
  readonly mode: TimelineActionPopoverMode
  readonly anchorX: number
  readonly anchorY: number
  readonly actionId?: string
  readonly formData: TimelineActionFormData
  readonly speciesList: readonly TimelineSpeciesOption[]
}

export type TimelineActionPendingClick =
  | {
      readonly type: 'add'
      readonly anchorX: number
      readonly anchorY: number
      readonly actionType: string
      readonly date: string
    }
  | {
      readonly type: 'edit'
      readonly anchorX: number
      readonly anchorY: number
      readonly actionId: string
    }

export interface OpenTimelineActionPopoverOptions {
  readonly pendingClick: TimelineActionPendingClick
  readonly speciesList: readonly TimelineSpeciesOption[]
  readonly actions?: readonly TimelineAction[]
}

export interface SaveTimelineActionPopoverOptions {
  readonly popover: TimelineActionPopoverState
  readonly data: TimelineActionFormData
  readonly createId: () => string
}

export interface TimelineActionMutationResult {
  readonly selectedId?: string | null
}

export function setTimelineHoveredPanelTargets(targets: readonly PanelTarget[]): void {
  setPlanningHoveredTargets(targets)
}

export function clearTimelineHoveredPanelTargets(): void {
  clearPlanningHoveredTargets()
}

export function setTimelineSelectedPanelTargets(targets: readonly PanelTarget[]): void {
  setPlanningSelectedTargets('timeline', targets)
}

export function clearTimelineSelectedPanelTargets(): void {
  clearPlanningSelectedTargetsForOrigin('timeline')
}

export function openTimelineActionPopover({
  pendingClick,
  speciesList,
  actions = currentDesign.peek()?.timeline ?? EMPTY_ACTIONS,
}: OpenTimelineActionPopoverOptions): TimelineActionPopoverState | null {
  if (pendingClick.type === 'add') {
    const startDate = pendingClick.date
    return {
      mode: 'add',
      anchorX: pendingClick.anchorX,
      anchorY: pendingClick.anchorY,
      formData: {
        action_type: pendingClick.actionType,
        start_date: startDate,
        end_date: defaultActionEndDate(startDate),
        description: '',
        species_canonical: null,
      },
      speciesList: [...speciesList],
    }
  }

  const action = actions.find((candidate) => candidate.id === pendingClick.actionId)
  if (!action) return null

  return {
    mode: 'edit',
    anchorX: pendingClick.anchorX,
    anchorY: pendingClick.anchorY,
    actionId: pendingClick.actionId,
    formData: formDataFromTimelineAction(action),
    speciesList: [...speciesList],
  }
}

export function saveTimelineActionPopover({
  popover,
  data,
  createId,
}: SaveTimelineActionPopoverOptions): TimelineActionMutationResult {
  if (popover.mode === 'add') {
    const id = createId()
    addTimelineAction(createTimelineActionFromFormData(id, data))
    return { selectedId: id }
  }

  if (popover.actionId) {
    updateTimelineAction(popover.actionId, timelineActionPatchFromFormData(data))
  }
  return {}
}

export function deleteTimelineActionPopover(
  popover: TimelineActionPopoverState,
): TimelineActionMutationResult {
  if (popover.mode !== 'edit' || !popover.actionId) return {}
  return deleteSelectedTimelineAction(popover.actionId)
}

export function deleteSelectedTimelineAction(actionId: string): TimelineActionMutationResult {
  deleteTimelineAction(actionId)
  clearTimelineHoveredPanelTargets()
  clearTimelineSelectedPanelTargets()
  return { selectedId: null }
}

function defaultActionEndDate(startDate: string): string {
  return toISODate(new Date(new Date(startDate).getTime() + DEFAULT_ACTION_DURATION_DAYS * MS_PER_DAY))
}
