import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginTimelineActionEdit,
  compensateFrozenTimelineOriginScroll,
  computeTimelineAutoScrollSpeed,
  createTimelineActionFromFormData,
  formDataFromTimelineAction,
  timelineActionPatchFromFormData,
} from '../app/timeline/editing'
import { currentDesign, nonCanvasRevision } from '../state/design'
import { MANUAL_TARGET, speciesTarget } from '../panel-targets'
import type { CanopiFile, TimelineAction } from '../types/design'

const MS_PER_DAY = 86400000

function atDate(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getTime()
}

function action(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'action-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-01',
    end_date: '2026-04-03',
    recurrence: null,
    targets: [speciesTarget('Malus domestica')],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

function design(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Timeline edit test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [action()],
    budget: [],
    extra: {},
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  currentDesign.value = design()
  nonCanvasRevision.value = 0
})

describe('Timeline Action editing', () => {
  it('previews move edits behind one commit-time dirty mark', () => {
    const edit = beginTimelineActionEdit({
      type: 'move',
      actionId: 'action-1',
      originalStartMs: atDate('2026-04-01'),
      durationMs: 2 * MS_PER_DAY,
      pxPerDaySnapshot: 10,
    })

    edit.applyPixelDelta(10)
    edit.applyPixelDelta(10)

    expect(currentDesign.value?.timeline[0]).toMatchObject({
      start_date: '2026-04-02',
      end_date: '2026-04-04',
    })
    expect(edit.hasMutated).toBe(true)
    expect(nonCanvasRevision.value).toBe(0)

    edit.commit()

    expect(nonCanvasRevision.value).toBe(1)
  })

  it('previews resize edits with date clamping', () => {
    const left = beginTimelineActionEdit({
      type: 'resize',
      actionId: 'action-1',
      edge: 'left',
      originalStartMs: atDate('2026-04-01'),
      originalEndMs: atDate('2026-04-03'),
      pxPerDaySnapshot: 10,
    })

    left.applyPixelDelta(40)

    expect(currentDesign.value?.timeline[0]).toMatchObject({
      start_date: '2026-04-03',
      end_date: '2026-04-03',
    })
    left.abort()

    const right = beginTimelineActionEdit({
      type: 'resize',
      actionId: 'action-1',
      edge: 'right',
      originalStartMs: atDate('2026-04-01'),
      originalEndMs: atDate('2026-04-03'),
      pxPerDaySnapshot: 10,
    })

    right.applyPixelDelta(-50)

    expect(currentDesign.value?.timeline[0]).toMatchObject({
      start_date: '2026-04-01',
      end_date: '2026-04-01',
    })
  })

  it('keeps auto-scroll and frozen-origin math behind the edit module', () => {
    expect(computeTimelineAutoScrollSpeed(110, 500, 110)).toBe(-15)
    expect(computeTimelineAutoScrollSpeed(170, 500, 110)).toBe(0)
    expect(computeTimelineAutoScrollSpeed(500, 500, 110)).toBe(15)

    expect(compensateFrozenTimelineOriginScroll({
      frozenOriginMs: atDate('2026-04-10'),
      realOriginMs: atDate('2026-04-08'),
      scrollX: 20,
      pxPerDay: 5,
    })).toBe(30)
  })

  it('maps Timeline Action forms to targets and document patches', () => {
    const form = formDataFromTimelineAction(action())

    expect(form).toEqual({
      action_type: 'planting',
      start_date: '2026-04-01',
      end_date: '2026-04-03',
      description: 'Plant apple',
      species_canonical: 'Malus domestica',
    })

    expect(createTimelineActionFromFormData('new-action', {
      ...form,
      species_canonical: null,
      start_date: '',
      end_date: '',
    })).toMatchObject({
      id: 'new-action',
      start_date: null,
      end_date: null,
      targets: [MANUAL_TARGET],
    })

    expect(timelineActionPatchFromFormData({
      ...form,
      species_canonical: 'Prunus avium',
    })).toMatchObject({
      targets: [speciesTarget('Prunus avium')],
    })
  })
})
