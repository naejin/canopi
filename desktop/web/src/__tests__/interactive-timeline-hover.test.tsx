import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/canvas/useCanvasRenderer', () => ({
  useCanvasRenderer: () => {},
}))

import { InteractiveTimeline } from '../components/canvas/InteractiveTimeline'
import { currentDesign } from '../state/document'
import { hoveredPanelTargets } from '../state/canvas'
import { speciesTarget } from '../panel-targets'
import type { CanopiFile, TimelineAction } from '../types/design'

function makeAction(overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id: 'task-1',
    action_type: 'planting',
    description: 'Plant apple',
    start_date: '2026-04-10',
    end_date: null,
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
    name: 'Timeline hover test',
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
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('InteractiveTimeline hover cleanup', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    currentDesign.value = makeDesign({ timeline: [makeAction()] })
    hoveredPanelTargets.value = []
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    hoveredPanelTargets.value = []
  })

  it('clears panel hover targets when deleting the selected action', async () => {
    const onSelect = vi.fn()
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]

    await act(async () => {
      render(
        <InteractiveTimeline
          granularity="month"
          selectedId="task-1"
          onSelect={onSelect}
          onEditRequest={() => {}}
        />,
        container,
      )
    })

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })

    expect(currentDesign.value?.timeline).toEqual([])
    expect(onSelect).toHaveBeenCalledWith(null)
    expect(hoveredPanelTargets.value).toEqual([])
  })
})
