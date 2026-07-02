import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignNotebookWorkbench } from '../app/design-notebook/workbench'
import { DesignNotebookPanel } from '../components/panels/DesignNotebookPanel'
import type { CanopiFile } from '../types/design'

describe('DesignNotebookPanel', () => {
  let container: HTMLDivElement

  function testDesign(): CanopiFile {
    return {
      version: 1,
      name: 'Current Design',
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
      created_at: '',
      updated_at: '',
      extra: {},
    }
  }

  async function flushEffects(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  }

  function setElementRect(element: HTMLElement, top: number, height = 40): void {
    element.getBoundingClientRect = () => ({
      width: 260,
      height,
      top,
      right: 260,
      bottom: top + height,
      left: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
  }

  function dispatchPointer(
    target: EventTarget,
    type: string,
    init: {
      readonly clientX?: number
      readonly clientY?: number
      readonly pointerId?: number
      readonly button?: number
    } = {},
  ): PointerEvent {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      pointerId: init.pointerId ?? 1,
      button: init.button ?? 0,
    })
    target.dispatchEvent(event)
    return event
  }

  function preparePointerTarget(target: HTMLElement): void {
    target.setPointerCapture = vi.fn()
    target.releasePointerCapture = vi.fn()
  }

  function notebookRow(path: string): HTMLElement {
    const row = container.querySelector<HTMLElement>(`[data-notebook-entry-row="${path}"]`)
    if (!row) throw new Error(`Missing notebook row ${path}`)
    return row
  }

  function notebookSection(sectionId: string): HTMLElement {
    const section = container.querySelector<HTMLElement>(`[data-notebook-section-id="${sectionId}"]`)
    if (!section) throw new Error(`Missing notebook section ${sectionId}`)
    return section
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders a minimal sectioned ledger and opens rows through the workbench', async () => {
    const activePath = signal<string | null>('/designs/terrace.canopi')
    const openDesign = vi.fn().mockImplementation(async (path: string) => {
      activePath.value = path
    })
    const workbench = createDesignNotebookWorkbench({
      activePath,
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [],
        entries: [
          {
            path: '/designs/terrace.canopi',
            name: 'Terrace Guild',
            updated_at: '2026-06-20T08:00:00.000Z',
            plant_count: 12,
            section_id: null,
            sort_order: 0,
          },
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            section_id: null,
            sort_order: 1,
          },
        ],
      }),
      openDesign,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    expect(container.querySelector('[aria-label="Design Notebook"]')).not.toBeNull()
    expect(container.textContent).toContain('Terrace Guild')
    expect(container.textContent).toContain('Forest Edge')
    expect(container.textContent).not.toContain('All Designs')
    expect(container.textContent).not.toContain('Pinned designs')
    expect(container.querySelector('input[aria-label="Search designs"]')).toBeNull()
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Terrace Guild')

    const row = container.querySelector<HTMLButtonElement>('button[data-design-path="/designs/forest-edge.canopi"]')
    if (!row) throw new Error('Missing Forest Edge row')

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openDesign).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Forest Edge')
  })

  it('creates, double-click renames, and deletes sections', async () => {
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [],
        entries: [
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            section_id: null,
            sort_order: 0,
          },
        ],
      }),
      openDesign: vi.fn(),
      createSection: vi.fn().mockResolvedValue({
        id: 'section-client',
        name: 'Client work',
        sort_order: 0,
        created_at: '2026-06-22T08:00:00.000Z',
        updated_at: '2026-06-22T08:00:00.000Z',
      }),
      renameSection: vi.fn().mockResolvedValue(undefined),
      deleteSection: vi.fn().mockResolvedValue(undefined),
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="New section"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const sectionName = container.querySelector<HTMLInputElement>('input[aria-label="New section name"]')
    if (!sectionName) throw new Error('Missing section name input')

    await act(async () => {
      sectionName.value = 'Client work'
      sectionName.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Create section"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Client work')

    const sectionTitle = container.querySelector<HTMLElement>('[data-notebook-section-id="section-client"] h3')
    if (!sectionTitle) throw new Error('Missing section title')
    await act(async () => {
      sectionTitle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Section name"]')
    if (!renameInput) throw new Error('Missing rename input')

    await act(async () => {
      renameInput.value = 'Consulting'
      renameInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await act(async () => {
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Consulting')
    expect(container.querySelector('button[aria-label="Rename section Client work"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete section Consulting"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Consulting')
  })

  it('removes a Design reference from a direct row delete button', async () => {
    const removeEntry = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [],
        entries: [
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            section_id: null,
            sort_order: 0,
          },
        ],
      }),
      openDesign: vi.fn(),
      removeEntry,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    expect(container.querySelector('button[aria-label="More actions for Forest Edge"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Pin Forest Edge"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove Forest Edge from Notebook"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(removeEntry).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(container.textContent).not.toContain('Forest Edge')
  })

  it('shows an add-current affordance that saves before adding an unsaved Design', async () => {
    const activePath = signal<string | null>(null)
    const currentDesign = signal<CanopiFile | null>(testDesign())
    const saveAsCurrent = vi.fn().mockImplementation(async () => {
      activePath.value = '/designs/current.canopi'
    })
    const loadNotebook = vi.fn()
      .mockResolvedValueOnce({ sections: [], entries: [] })
      .mockResolvedValueOnce({
        sections: [],
        entries: [
          {
            path: '/designs/current.canopi',
            name: 'Current Design',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 0,
            section_id: null,
            sort_order: 0,
          },
        ],
      })
    const workbench = createDesignNotebookWorkbench({
      activePath,
      currentDesign,
      loadNotebook,
      openDesign: vi.fn(),
      saveAsCurrent,
      saveCurrent: vi.fn(),
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    const addButton = container.querySelector<HTMLButtonElement>('button[aria-label="Add current design to notebook"]')
    if (!addButton) throw new Error('Missing add-current button')

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveAsCurrent).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Current Design')
    expect(container.querySelector('button[aria-label="Add current design to notebook"]')).toBeNull()
  })

  it('drags Notebook Sections directly by title', async () => {
    const reorderSections = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [
          {
            id: 'section-first',
            name: 'First Section',
            sort_order: 0,
            created_at: '2026-06-20T08:00:00.000Z',
            updated_at: '2026-06-20T08:00:00.000Z',
          },
          {
            id: 'section-second',
            name: 'Second Section',
            sort_order: 1,
            created_at: '2026-06-21T08:00:00.000Z',
            updated_at: '2026-06-21T08:00:00.000Z',
          },
        ],
        entries: [
          {
            path: '/designs/first.canopi',
            name: 'First Design',
            updated_at: '2026-06-20T08:00:00.000Z',
            plant_count: 1,
            section_id: 'section-first',
            sort_order: 0,
          },
        ],
      }),
      openDesign: vi.fn(),
      reorderSections,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    const firstSection = notebookSection('section-first')
    const secondSection = notebookSection('section-second')
    const secondTitle = secondSection.querySelector<HTMLElement>('h3')
    if (!secondTitle) throw new Error('Missing second section title')
    preparePointerTarget(secondTitle)
    setElementRect(firstSection, 100, 80)
    setElementRect(secondSection, 180, 80)

    await act(async () => {
      dispatchPointer(secondTitle, 'pointerdown', { pointerId: 8, clientX: 12, clientY: 200 })
      dispatchPointer(document, 'pointermove', { pointerId: 8, clientX: 12, clientY: 120 })
      dispatchPointer(document, 'pointerup', { pointerId: 8, clientX: 12, clientY: 120 })
      await flushEffects()
    })

    expect(reorderSections).toHaveBeenCalledWith(['section-second', 'section-first'])
  })

  it('drags Design rows directly within a section and into another section without opening the row', async () => {
    const moveEntryToSection = vi.fn().mockResolvedValue(undefined)
    const reorderEntries = vi.fn().mockResolvedValue(undefined)
    const openDesign = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [
          {
            id: 'section-client',
            name: 'Client work',
            sort_order: 0,
            created_at: '2026-06-20T08:00:00.000Z',
            updated_at: '2026-06-20T08:00:00.000Z',
          },
          {
            id: 'section-home',
            name: 'Home',
            sort_order: 1,
            created_at: '2026-06-21T08:00:00.000Z',
            updated_at: '2026-06-21T08:00:00.000Z',
          },
        ],
        entries: [
          {
            path: '/designs/first.canopi',
            name: 'First Design',
            updated_at: '2026-06-20T08:00:00.000Z',
            plant_count: 1,
            section_id: 'section-client',
            sort_order: 0,
          },
          {
            path: '/designs/second.canopi',
            name: 'Second Design',
            updated_at: '2026-06-21T08:00:00.000Z',
            plant_count: 2,
            section_id: 'section-client',
            sort_order: 1,
          },
          {
            path: '/designs/home.canopi',
            name: 'Home Design',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 3,
            section_id: 'section-home',
            sort_order: 2,
          },
        ],
      }),
      openDesign,
      moveEntryToSection,
      reorderEntries,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(flushEffects)

    const firstRow = notebookRow('/designs/first.canopi')
    const secondRow = notebookRow('/designs/second.canopi')
    const firstRowBody = firstRow.querySelector<HTMLElement>('button[data-design-path="/designs/first.canopi"]')
    if (!firstRowBody) throw new Error('Missing first row body')
    preparePointerTarget(firstRowBody)
    setElementRect(firstRow, 100)
    setElementRect(secondRow, 140)

    await act(async () => {
      dispatchPointer(firstRowBody, 'pointerdown', { pointerId: 9, clientX: 12, clientY: 110 })
      dispatchPointer(document, 'pointermove', { pointerId: 9, clientX: 12, clientY: 175 })
      dispatchPointer(document, 'pointerup', { pointerId: 9, clientX: 12, clientY: 175 })
      firstRowBody.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(openDesign).not.toHaveBeenCalled()
    expect(moveEntryToSection).not.toHaveBeenCalled()
    expect(reorderEntries).toHaveBeenCalledWith([
      '/designs/second.canopi',
      '/designs/first.canopi',
      '/designs/home.canopi',
    ])

    const firstRowAfterReorder = notebookRow('/designs/first.canopi')
    const homeRow = notebookRow('/designs/home.canopi')
    const firstRowBodyAfterReorder = firstRowAfterReorder.querySelector<HTMLElement>('button[data-design-path="/designs/first.canopi"]')
    if (!firstRowBodyAfterReorder) throw new Error('Missing first row body after reorder')
    preparePointerTarget(firstRowBodyAfterReorder)
    setElementRect(homeRow, 220)

    await act(async () => {
      dispatchPointer(firstRowBodyAfterReorder, 'pointerdown', { pointerId: 10, clientX: 12, clientY: 150 })
      dispatchPointer(document, 'pointermove', { pointerId: 10, clientX: 12, clientY: 260 })
      dispatchPointer(document, 'pointerup', { pointerId: 10, clientX: 12, clientY: 260 })
      firstRowBodyAfterReorder.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushEffects()
    })

    expect(openDesign).not.toHaveBeenCalled()
    expect(moveEntryToSection).toHaveBeenCalledWith('/designs/first.canopi', 'section-home')
    expect(reorderEntries).toHaveBeenLastCalledWith([
      '/designs/second.canopi',
      '/designs/home.canopi',
      '/designs/first.canopi',
    ])
  })
})
