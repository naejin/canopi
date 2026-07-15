import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useCanvasRendererMock = vi.hoisted(() => vi.fn())

vi.mock('../components/canvas/useCanvasRenderer', () => ({
  useCanvasRenderer: useCanvasRendererMock,
}))

import { InteractiveTimeline } from '../components/canvas/InteractiveTimeline'
import { TimelineTab } from '../components/canvas/TimelineTab'
import { hoveredPanelTargets, selectedPanelTargetOrigin, selectedPanelTargets } from '../app/panel-targets/state'
import {
  designSessionFixture,
  currentDesign,
} from './support/design-session-state'
import { speciesTarget } from '../target'
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
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

function latestRendererDeps(): readonly unknown[] | undefined {
  const calls = useCanvasRendererMock.mock.calls
  return calls[calls.length - 1]?.[2] as readonly unknown[] | undefined
}

describe('InteractiveTimeline hover cleanup', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    useCanvasRendererMock.mockClear()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    designSessionFixture.file = makeDesign({ timeline: [makeAction()] })
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
    hoveredPanelTargets.value = []
    selectedPanelTargetOrigin.value = null
    selectedPanelTargets.value = []
  })

  it('emits selected panel targets when clicking an action without mutating hover', async () => {
    await act(async () => {
      render(<InteractiveTimeline />, container)
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

    expect(selectedPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(selectedPanelTargetOrigin.value).toBe('timeline')
    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('clears panel hover targets when deleting the selected action', async () => {
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]
    selectedPanelTargetOrigin.value = 'timeline'
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    await act(async () => {
      render(<InteractiveTimeline />, container)
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

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })

    expect(currentDesign.value?.timeline).toEqual([])
    expect(hoveredPanelTargets.value).toEqual([])
    expect(selectedPanelTargets.value).toEqual([])
    expect(selectedPanelTargetOrigin.value).toBeNull()
  })

  it('clears timeline-owned selected panel targets when TimelineTab unmounts', async () => {
    designSessionFixture.file = makeDesign({ timeline: [] })
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
    designSessionFixture.file = makeDesign({ timeline: [] })
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

  it('cleans up Timeline-owned hover targets when the canvas host unmounts', async () => {
    await act(async () => {
      render(<InteractiveTimeline />, container)
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
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 262,
        clientY: 40,
        bubbles: true,
      }))
    })

    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])

    await act(async () => {
      render(null, container)
    })

    expect(hoveredPanelTargets.value).toEqual([])
  })

  it('keeps renderer dependencies stable for tooltip-only moves over the same action', async () => {
    await act(async () => {
      render(<InteractiveTimeline />, container)
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
    const depsAfterInitialRender = latestRendererDeps()
    expect(depsAfterInitialRender).toBeTruthy()

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 262,
        clientY: 40,
        bubbles: true,
      }))
    })

    const depsAfterHoverIdentity = latestRendererDeps()
    expect(depsAfterHoverIdentity).toBeTruthy()
    expect(depsAfterHoverIdentity).not.toBe(depsAfterInitialRender)
    expect(depsAfterHoverIdentity!.some((dependency, index) => (
      dependency !== depsAfterInitialRender![index]
    ))).toBe(true)

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 264,
        clientY: 40,
        bubbles: true,
      }))
    })

    const depsAfterTooltipMove = latestRendererDeps()
    expect(depsAfterTooltipMove).toBeTruthy()
    expect(depsAfterTooltipMove).not.toBe(depsAfterHoverIdentity)
    expect(depsAfterTooltipMove).toHaveLength(depsAfterHoverIdentity!.length)
    depsAfterTooltipMove!.forEach((dependency, index) => {
      expect(dependency).toBe(depsAfterHoverIdentity![index])
    })
  })

  it('saves an edit popover through the Timeline canvas host model', async () => {
    await act(async () => {
      render(<InteractiveTimeline />, container)
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
      document.dispatchEvent(new MouseEvent('mouseup', {
        button: 0,
        clientX: 262,
        clientY: 40,
        bubbles: true,
      }))
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLDivElement | null
    expect(dialog).toBeTruthy()

    const notesInput = dialog!.querySelector('textarea') as HTMLTextAreaElement | null
    expect(notesInput).toBeTruthy()
    expect(notesInput?.rows).toBe(4)
    expect(dialog!.querySelector('input[type="text"]')).toBeNull()

    await act(async () => {
      notesInput!.value = 'Water deeply\nCheck mulch after settling'
      notesInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const buttons = Array.from(dialog!.querySelectorAll('button'))
    const saveButton = buttons[buttons.length - 1] as HTMLButtonElement | undefined
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(currentDesign.value?.timeline[0]?.description).toBe('Water deeply\nCheck mulch after settling')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes the timeline popover when the scroll container moves', async () => {
    designSessionFixture.file = makeDesign({ timeline: [] })

    await act(async () => {
      render(<InteractiveTimeline />, container)
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
        clientX: 220,
        clientY: 40,
        bubbles: true,
      }))
      document.dispatchEvent(new MouseEvent('mouseup', {
        button: 0,
        clientX: 220,
        clientY: 40,
        bubbles: true,
      }))
    })

    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()

    const scrollHost = container.firstElementChild as HTMLDivElement
    await act(async () => {
      scrollHost.dispatchEvent(new Event('scroll'))
    })

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('recomputes hover hit-testing after the timeline scroll container moves', async () => {
    await act(async () => {
      render(<InteractiveTimeline />, container)
    })

    const canvas = container.querySelector('canvas')!
    let rectTop = 100
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: rectTop,
      right: 400,
      bottom: rectTop + 200,
      width: 400,
      height: 200,
      x: 0,
      y: rectTop,
      toJSON: () => ({}),
    })

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 262,
        clientY: 140,
        bubbles: true,
      }))
    })

    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])

    const scrollHost = container.firstElementChild as HTMLDivElement
    rectTop = 0
    await act(async () => {
      scrollHost.dispatchEvent(new Event('scroll'))
    })

    expect(hoveredPanelTargets.value).toEqual([])

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: 262,
        clientY: 40,
        bubbles: true,
      }))
    })

    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
  })
})
