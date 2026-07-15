import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteSelectedTimelineAction,
  openTimelineActionPopover,
  saveTimelineActionPopover,
} from '../app/timeline/workbench'
import {
  hoveredPanelTargets,
  selectedPanelTargetOrigin,
  selectedPanelTargets,
} from '../app/panel-targets/state'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'
import { MANUAL_TARGET, speciesTarget } from '../target'
import type { CanopiFile, TimelineAction } from '../types/design'

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'action-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-10',
    end_date: '2026-04-12',
    recurrence: null,
    targets: [speciesTarget('Malus domestica')],
    depends_on: null,
    completed: false,
    order: 0,
    ...overrides,
  }
}

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Timeline workbench test',
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
    timeline: [makeAction()],
    budget: [],
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  designSessionFixture.file = makeDesign()
  designSessionFixture.nonCanvasRevision = 0
  hoveredPanelTargets.value = []
  selectedPanelTargetOrigin.value = null
  selectedPanelTargets.value = []
})

describe('Timeline Action workbench', () => {
  it('opens add popovers and saves new Timeline Actions through one workbench interface', () => {
    const popover = openTimelineActionPopover({
      pendingClick: {
        type: 'add',
        anchorX: 220,
        anchorY: 80,
        actionType: 'maintenance',
        date: '2026-04-10',
      },
      speciesList: [{ canonical_name: 'Malus domestica', display_name: 'Apple' }],
    })

    expect(popover).toMatchObject({
      mode: 'add',
      anchorX: 220,
      anchorY: 80,
      formData: {
        action_type: 'maintenance',
        start_date: '2026-04-10',
        end_date: '2026-04-24',
        description: '',
        species_canonical: null,
      },
    })

    const result = saveTimelineActionPopover({
      popover: popover!,
      data: {
        ...popover!.formData,
        description: 'Mulch apples',
        species_canonical: 'Malus domestica',
      },
      createId: () => 'new-action',
    })

    expect(result).toEqual({ selectedId: 'new-action' })
    expect(currentDesign.value?.timeline).toHaveLength(2)
    expect(currentDesign.value?.timeline[1]).toMatchObject({
      id: 'new-action',
      action_type: 'maintenance',
      description: 'Mulch apples',
      start_date: '2026-04-10',
      end_date: '2026-04-24',
      order: 1,
      targets: [speciesTarget('Malus domestica')],
    })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('opens edit popovers from live Timeline Actions and applies form patches', () => {
    const popover = openTimelineActionPopover({
      pendingClick: {
        type: 'edit',
        anchorX: 180,
        anchorY: 60,
        actionId: 'action-1',
      },
      speciesList: [],
    })

    expect(popover).toMatchObject({
      mode: 'edit',
      actionId: 'action-1',
      formData: {
        action_type: 'planting',
        start_date: '2026-04-10',
        end_date: '2026-04-12',
        description: 'Plant apple',
        species_canonical: 'Malus domestica',
      },
    })

    const result = saveTimelineActionPopover({
      popover: popover!,
      data: {
        ...popover!.formData,
        description: 'Manual planting note',
        species_canonical: null,
      },
      createId: () => 'unused',
    })

    expect(result).toEqual({})
    expect(currentDesign.value?.timeline[0]).toMatchObject({
      id: 'action-1',
      description: 'Manual planting note',
      targets: [MANUAL_TARGET],
    })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('deletes selected Timeline Actions and clears Timeline-owned target presentation', () => {
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    const result = deleteSelectedTimelineAction('action-1')

    expect(result).toEqual({ selectedId: null })
    expect(currentDesign.value?.timeline).toEqual([])
    expect(nonCanvasRevision.value).toBe(1)
    expect(hoveredPanelTargets.value).toEqual([])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })
})
