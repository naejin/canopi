import { beforeEach, describe, expect, it } from 'vitest'
import { addTimelineAction, deleteTimelineAction, updateTimelineAction } from '../app/timeline/controller'
import { currentDesign, nonCanvasRevision } from '../state/design'

beforeEach(() => {
  nonCanvasRevision.value = 0
  currentDesign.value = {
    version: 2,
    name: 'test',
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
    timeline: [],
    budget: [],
    created_at: '',
    updated_at: '',
    extra: {},
  }
})

describe('timeline controller', () => {
  it('adds actions with incrementing order', () => {
    addTimelineAction({
      id: 'a',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      action_type: 'plant',
      description: 'first',
      completed: false,
      recurrence: null,
      targets: [],
      depends_on: null,
    })
    addTimelineAction({
      id: 'b',
      start_date: '2026-04-03',
      end_date: '2026-04-04',
      action_type: 'water',
      description: 'second',
      completed: false,
      recurrence: null,
      targets: [],
      depends_on: null,
    })

    expect(currentDesign.value?.timeline.map((action) => action.order)).toEqual([0, 1])
    expect(nonCanvasRevision.value).toBe(2)
  })

  it('does not dirty when an update is a no-op', () => {
    addTimelineAction({
      id: 'a',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      action_type: 'plant',
      description: 'first',
      completed: false,
      recurrence: null,
      targets: [],
      depends_on: null,
    })
    nonCanvasRevision.value = 0

    updateTimelineAction('a', { description: 'first' })

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('respects markDirty: false on delete', () => {
    addTimelineAction({
      id: 'a',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      action_type: 'plant',
      description: 'first',
      completed: false,
      recurrence: null,
      targets: [],
      depends_on: null,
    })
    nonCanvasRevision.value = 0

    deleteTimelineAction('a', { markDirty: false })

    expect(currentDesign.value?.timeline).toEqual([])
    expect(nonCanvasRevision.value).toBe(0)
  })
})
