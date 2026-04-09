import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/canvas/useCanvasRenderer', () => ({
  useCanvasRenderer: () => {},
}))

import { InteractiveTimeline } from '../components/canvas/InteractiveTimeline'
import { TimelineTab } from '../components/canvas/TimelineTab'
import { currentDesign } from '../state/document'
import { hoveredPanelTargets, selectedPanelTargetOrigin, selectedPanelTargets } from '../state/canvas'
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
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

  it('emits selected panel targets when clicking an action without mutating hover', async () => {
    const onSelect = vi.fn()

    await act(async () => {
      render(
        <InteractiveTimeline
          selectedId={null}
          onSelect={onSelect}
        />,
        container,
      )
    })

    const canvas = container.querySelector('canvas')!
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        button: 0,
        clientX: 262,
        clientY: 40,
        bubbles: true,
      }))
    })

    expect(onSelect).toHaveBeenCalledWith('task-1')
    expect(selectedPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('timeline')
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('clears panel hover targets when deleting the selected action', async () => {
    const onSelect = vi.fn()
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    await act(async () => {
      render(
        <InteractiveTimeline
          selectedId="task-1"
          onSelect={onSelect}
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
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('clears timeline-owned selected panel targets when TimelineTab unmounts without a canvas child', async () => {
    currentDesign.value = makeDesign({ timeline: [] })
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    await act(async () => {
      render(<TimelineTab />, container)
    })

    await act(async () => {
      render(null, container)
    })

    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('does not clear budget-owned selected panel targets when TimelineTab unmounts', async () => {
    currentDesign.value = makeDesign({ timeline: [] })
    selectedPanelTargetOrigin.value = 'budget'
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    await act(async () => {
      render(<TimelineTab />, container)
    })

    await act(async () => {
      render(null, container)
    })

    expect(selectedPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('budget')
  })
})
