import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarPanel } from '../components/panels/CalendarPanel'
import { disposePlanningViewState, readPlanningViewState } from '../app/planning-view/state'
import { locale } from '../app/settings/state'
import { sidePanel } from '../app/shell/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { speciesTarget } from '../target'
import type { CanopiFile, PlacedPlant, TimelineAction } from '../types/design'
import { currentDesign, designSessionFixture } from './support/design-session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { dropdownTrigger } from './support/dropdown-trigger'

const plants: PlacedPlant[] = [
  plant('apple', 'Malus domestica', 'Apple'),
  plant('lavender', 'Lavandula angustifolia', 'English lavender'),
]

function plant(id: string, canonicalName: string, commonName: string): PlacedPlant {
  return {
    id,
    canonical_name: canonicalName,
    common_name: commonName,
    color: null,
    position: { lon: 13, lat: 23 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}

function action(): TimelineAction {
  return {
    id: 'prune-apple',
    action_type: 'pruning',
    description: 'Prune apple\nLeave branch notes intact',
    start_date: '2026-09-08',
    end_date: '2026-09-11',
    recurrence: null,
    targets: [speciesTarget('Malus domestica')],
    depends_on: null,
    completed: false,
    order: 0,
  }
}

function design(): CanopiFile {
  return {
    version: 7,
    name: 'Calendar editor test',
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [action()],
    budget: [],
    budget_currency: 'EUR',
    extra: {},
    created_at: '',
    updated_at: '',
  }
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === name)
  if (!result) throw new Error(`Missing button: ${name}`)
  return result
}

describe('Calendar action editor', () => {
  let container: HTMLDivElement

  beforeEach(async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('scrollTo', () => {})
    if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {}
    container = document.createElement('div')
    document.body.appendChild(container)
    locale.value = 'en'
    disposePlanningViewState()
    readPlanningViewState().calendarMonth.value = '2026-09-01'
    designSessionFixture.file = design()
    designSessionFixture.nonCanvasRevision = 0
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({
        plants,
        localizedNames: new Map([
          ['Malus domestica', 'Apple'],
          ['Lavandula angustifolia', 'English lavender'],
        ]),
      }),
    }))
    sidePanel.value = 'calendar'
    await act(async () => { render(<CalendarPanel />, container) })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    designSessionFixture.file = null
    setCurrentCanvasSession(null)
    sidePanel.value = null
    disposePlanningViewState()
    vi.unstubAllGlobals()
  })

  async function openEdit(): Promise<HTMLElement> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-calendar-action]')!.click()
    })
    return container.querySelector<HTMLElement>('[role="dialog"]')!
  }

  it('uses the accepted field hierarchy and explicit schedule modes', async () => {
    const editor = await openEdit()
    const text = editor.textContent ?? ''

    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(document.activeElement).toBe(editor.querySelector('[data-calendar-description]'))
    expect(text.indexOf('Description')).toBeLessThan(text.indexOf('Action type'))
    expect(text.indexOf('Targets')).toBeLessThan(text.indexOf('Completed'))
    expect(button(editor, 'Range').getAttribute('aria-pressed')).toBe('true')
    expect(button(editor, 'One day').getAttribute('aria-pressed')).toBe('false')
    expect(button(editor, 'Unscheduled').getAttribute('aria-pressed')).toBe('false')
    expect(editor.querySelector('[data-calendar-date-fields]')?.textContent).toContain('End inclusive')
    expect(editor.querySelector('[data-calendar-completed] input[type="checkbox"]')).not.toBeNull()

    await act(async () => { button(editor, 'One day').click() })
    expect(editor.querySelector('[data-calendar-date-fields]')?.textContent).not.toContain('End inclusive')
    await act(async () => { button(editor, 'Save').click() })
    expect(currentDesign.value?.timeline[0]?.end_date).toBeNull()
    expect(currentDesign.value?.timeline[0]?.description).toBe('Prune apple\nLeave branch notes intact')

    const reopened = await openEdit()
    await act(async () => { button(reopened, 'Unscheduled').click() })
    expect(reopened.querySelector('[data-calendar-date-fields]')).toBeNull()
    await act(async () => { button(reopened, 'Save').click() })
    expect(currentDesign.value?.timeline[0]).toMatchObject({ start_date: null, end_date: null })
  })

  it('keeps selected species visible while searching and supports explicit add and removal', async () => {
    const editor = await openEdit()
    const search = editor.querySelector<HTMLInputElement>('input[type="search"]')!

    expect(editor.querySelector('[data-calendar-selected-target="Malus domestica"]')).not.toBeNull()
    await act(async () => {
      search.value = 'lavender'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(editor.querySelector('[data-calendar-selected-target="Malus domestica"]')).not.toBeNull()

    await act(async () => {
      editor.querySelector<HTMLButtonElement>('[data-calendar-species-option="Lavandula angustifolia"]')!.click()
    })
    expect(editor.querySelector('[data-calendar-selected-target="Lavandula angustifolia"]')).not.toBeNull()
    await act(async () => {
      editor.querySelector<HTMLButtonElement>('[aria-label="Remove Apple"]')!.click()
    })
    await act(async () => { button(editor, 'Save').click() })

    expect(currentDesign.value?.timeline[0]?.targets).toEqual([
      speciesTarget('Lavandula angustifolia'),
    ])
  })

  it('moves focus into the editor and restores its trigger on Escape', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('button[data-calendar-add]')!
    await act(async () => { trigger.click() })

    expect(document.activeElement).toBe(container.querySelector('[data-calendar-description]'))
    await act(async () => {
      container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }))
      await Promise.resolve()
    })
    expect(document.activeElement).toBe(container.querySelector('button[data-calendar-add]'))
  })

  it('keeps date and target popups outside the bounded editor scroll region', async () => {
    const editor = await openEdit()
    const targetTrigger = dropdownTrigger(editor, 'Targets')!

    await act(async () => { targetTrigger.click() })
    const targetMenu = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Targets"]')!
    expect(targetMenu).not.toBeNull()
    expect(editor.contains(targetMenu)).toBe(false)
    const selectionOption = [...targetMenu.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.startsWith('Current selection'))
    expect(selectionOption?.disabled).toBe(true)
    await act(async () => {
      targetMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(targetTrigger)

    const startTrigger = editor.querySelector<HTMLButtonElement>('button[aria-label="Start"]')!
    await act(async () => { startTrigger.click() })
    const dateDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find((candidate) => candidate !== editor)!
    expect(dateDialog).not.toBeNull()
    expect(editor.contains(dateDialog)).toBe(false)
    await act(async () => {
      dateDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(startTrigger)
  })

  it('dismisses action type and date popups as part of committing a choice', async () => {
    const editor = await openEdit()
    const typeTrigger = dropdownTrigger(editor, 'Action type')!

    await act(async () => { typeTrigger.click() })
    let typeMenu = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Action type"]')!
    expect(editor.contains(typeMenu)).toBe(false)
    await act(async () => { button(typeMenu, 'Pruning').click() })
    expect(document.querySelector('[role="listbox"][aria-label="Action type"]')).toBeNull()
    expect(document.activeElement).toBe(typeTrigger)

    await act(async () => { typeTrigger.click() })
    typeMenu = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Action type"]')!
    await act(async () => { button(typeMenu, 'Harvest').click() })
    expect(document.querySelector('[role="listbox"][aria-label="Action type"]')).toBeNull()
    expect(document.activeElement).toBe(typeTrigger)

    const startTrigger = editor.querySelector<HTMLButtonElement>('button[aria-label="Start"]')!
    await act(async () => { startTrigger.click() })
    const dateDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find((candidate) => candidate !== editor)!
    await act(async () => {
      dateDialog.querySelector<HTMLButtonElement>('button[data-day="9"]')!.click()
    })
    expect([...document.querySelectorAll<HTMLElement>('[role="dialog"]')]).toEqual([editor])
    expect(document.activeElement).toBe(startTrigger)

    const endTrigger = editor.querySelector<HTMLButtonElement>('button[aria-label="End inclusive"]')!
    await act(async () => { endTrigger.click() })
    const endDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find((candidate) => candidate !== editor)!
    await act(async () => {
      endDialog.querySelector<HTMLButtonElement>('button[data-day="10"]')!.click()
    })
    expect([...document.querySelectorAll<HTMLElement>('[role="dialog"]')]).toEqual([editor])
    expect(document.activeElement).toBe(endTrigger)
  })
})
