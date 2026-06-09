import { snapToDay, toISODate } from '../../canvas/timeline-math'
import { MANUAL_TARGET, getTimelineSpeciesTarget, speciesTarget } from '../../target'
import type { PanelTarget, TimelineAction } from '../../types/design'
import { beginDesignArrayEdit, editDesignArray, type DesignArrayEditTransaction } from './core'
import { applyTimelineActionPatch } from '../timeline/model'

const MS_PER_DAY = 86400000

export type TimelineActionEditSession = TimelineMoveEditSession | TimelineResizeEditSession

interface TimelineActionEditSessionBase {
  readonly actionId: string
  readonly hasMutated: boolean
  applyPixelDelta(totalPxDelta: number): void
  commit(): void
  abort(): void
}

export interface TimelineMoveEditSession extends TimelineActionEditSessionBase {
  readonly type: 'move'
}

export interface TimelineResizeEditSession extends TimelineActionEditSessionBase {
  readonly type: 'resize'
  readonly edge: 'left' | 'right'
}

export type BeginTimelineActionEditOptions =
  | {
      readonly type: 'move'
      readonly actionId: string
      readonly originalStartMs: number
      readonly durationMs: number | null
      readonly pxPerDaySnapshot: number
    }
  | {
      readonly type: 'resize'
      readonly actionId: string
      readonly edge: 'left' | 'right'
      readonly originalStartMs: number
      readonly originalEndMs: number | null
      readonly pxPerDaySnapshot: number
    }

export interface TimelineActionFormData {
  action_type: string
  start_date: string
  end_date: string
  description: string
  species_canonical: string | null
}

export function addTimelineAction(action: Omit<TimelineAction, 'order'>): void {
  editDesignArray('timeline', (timeline) => {
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
  editDesignArray('timeline', (timeline) => applyTimelineActionPatch(timeline, actionId, patch))
}

export function deleteTimelineAction(actionId: string): void {
  editDesignArray('timeline', (timeline) => {
    if (!timeline.some((action) => action.id === actionId)) return timeline
    return timeline.filter((action) => action.id !== actionId)
  })
}

export function beginTimelineActionEdit(
  options: BeginTimelineActionEditOptions,
): TimelineActionEditSession {
  if (options.type === 'move') return new TimelineMoveEdit(options)
  return new TimelineResizeEdit(options)
}

export function formDataFromTimelineAction(action: TimelineAction): TimelineActionFormData {
  return {
    action_type: action.action_type,
    start_date: action.start_date ?? '',
    end_date: action.end_date ?? '',
    description: action.description,
    species_canonical: getTimelineSpeciesTarget(action)?.canonical_name ?? null,
  }
}

export function targetsFromTimelineActionFormData(
  data: TimelineActionFormData,
): PanelTarget[] {
  return data.species_canonical
    ? [speciesTarget(data.species_canonical)]
    : [MANUAL_TARGET]
}

export function createTimelineActionFromFormData(
  id: string,
  data: TimelineActionFormData,
): Omit<TimelineAction, 'order'> {
  return {
    id,
    action_type: data.action_type,
    description: data.description,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    recurrence: null,
    targets: targetsFromTimelineActionFormData(data),
    depends_on: null,
    completed: false,
  }
}

export function timelineActionPatchFromFormData(
  data: TimelineActionFormData,
): Partial<TimelineAction> {
  return {
    action_type: data.action_type,
    description: data.description,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    targets: targetsFromTimelineActionFormData(data),
  }
}

abstract class TimelineActionEditSessionImpl implements TimelineActionEditSessionBase {
  protected readonly edit: DesignArrayEditTransaction<'timeline'>
  protected lastDates: { start: string; end: string | null } = { start: '', end: null }

  constructor(
    readonly actionId: string,
    protected readonly pxPerDaySnapshot: number,
  ) {
    this.edit = beginDesignArrayEdit('timeline')
  }

  get hasMutated(): boolean {
    return this.edit.hasMutated
  }

  abstract applyPixelDelta(totalPxDelta: number): void

  commit(): void {
    this.edit.commit()
  }

  abort(): void {
    this.edit.abort()
  }

  protected dayDelta(totalPxDelta: number): number {
    return totalPxDelta / this.pxPerDaySnapshot
  }

  protected previewDates(start: string, end: string | null): boolean {
    if (start === this.lastDates.start && end === this.lastDates.end) return false
    this.lastDates = { start, end }
    return true
  }
}

class TimelineMoveEdit extends TimelineActionEditSessionImpl implements TimelineMoveEditSession {
  readonly type = 'move'

  constructor(private readonly options: Extract<BeginTimelineActionEditOptions, { type: 'move' }>) {
    super(options.actionId, options.pxPerDaySnapshot)
  }

  applyPixelDelta(totalPxDelta: number): void {
    const deltaMs = this.dayDelta(totalPxDelta) * MS_PER_DAY
    const start = snapToDay(new Date(this.options.originalStartMs + deltaMs))
    const startStr = toISODate(start)
    const endStr = this.options.durationMs != null
      ? toISODate(new Date(start.getTime() + this.options.durationMs))
      : null
    if (!this.previewDates(startStr, endStr)) return
    this.edit.preview((timeline) => applyTimelineActionPatch(
      timeline,
      this.actionId,
      { start_date: startStr, end_date: endStr },
    ))
  }
}

class TimelineResizeEdit extends TimelineActionEditSessionImpl implements TimelineResizeEditSession {
  readonly type = 'resize'
  readonly edge: 'left' | 'right'

  constructor(private readonly options: Extract<BeginTimelineActionEditOptions, { type: 'resize' }>) {
    super(options.actionId, options.pxPerDaySnapshot)
    this.edge = options.edge
  }

  applyPixelDelta(totalPxDelta: number): void {
    const deltaMs = this.dayDelta(totalPxDelta) * MS_PER_DAY
    if (this.options.edge === 'left') {
      this.applyLeftResize(deltaMs)
    } else {
      this.applyRightResize(deltaMs)
    }
  }

  private applyLeftResize(deltaMs: number): void {
    const maxStartMs = this.options.originalEndMs ?? this.options.originalStartMs + MS_PER_DAY
    const clampedStart = snapToDay(new Date(Math.min(this.options.originalStartMs + deltaMs, maxStartMs)))
    const startStr = toISODate(clampedStart)
    const endStr = this.options.originalEndMs != null
      ? toISODate(new Date(this.options.originalEndMs))
      : null
    if (!this.previewDates(startStr, endStr)) return
    this.edit.preview((timeline) => applyTimelineActionPatch(
      timeline,
      this.actionId,
      { start_date: startStr },
    ))
  }

  private applyRightResize(deltaMs: number): void {
    const originalEnd = this.options.originalEndMs ?? this.options.originalStartMs + MS_PER_DAY
    const clampedEnd = snapToDay(new Date(Math.max(originalEnd + deltaMs, this.options.originalStartMs)))
    const endStr = toISODate(clampedEnd)
    const startStr = toISODate(new Date(this.options.originalStartMs))
    if (!this.previewDates(startStr, endStr)) return
    this.edit.preview((timeline) => applyTimelineActionPatch(
      timeline,
      this.actionId,
      { end_date: endStr },
    ))
  }
}
