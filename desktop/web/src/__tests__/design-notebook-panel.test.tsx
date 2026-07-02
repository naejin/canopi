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

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders a searchable All Designs ledger and opens rows through the workbench', async () => {
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
            pinned: false,
            section_id: null,
          },
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            pinned: false,
            section_id: null,
          },
        ],
      }),
      openDesign,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('[aria-label="Design Notebook"]')).not.toBeNull()
    expect(container.textContent).toContain('Terrace Guild')
    expect(container.textContent).toContain('Forest Edge')
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Terrace Guild')

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search designs"]')
    if (!search) throw new Error('Missing notebook search input')

    await act(async () => {
      search.value = 'forest'
      search.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    expect(container.textContent).not.toContain('Terrace Guild')
    expect(container.textContent).toContain('Forest Edge')

    const row = container.querySelector<HTMLButtonElement>('button[data-design-path="/designs/forest-edge.canopi"]')
    if (!row) throw new Error('Missing Forest Edge row')

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openDesign).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Forest Edge')
  })

  it('creates, renames, deletes sections and moves rows between them', async () => {
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [],
        entries: [
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            pinned: false,
            section_id: null,
          },
        ],
      }),
      openDesign: vi.fn(),
      createSection: vi.fn().mockResolvedValue({
        id: 'section-client',
        name: 'Client work',
        created_at: '2026-06-22T08:00:00.000Z',
        updated_at: '2026-06-22T08:00:00.000Z',
      }),
      renameSection: vi.fn().mockResolvedValue(undefined),
      deleteSection: vi.fn().mockResolvedValue(undefined),
      moveEntryToSection: vi.fn().mockResolvedValue(undefined),
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
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

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Move Forest Edge to section"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
        .find((button) => button.textContent?.includes('Client work'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(workbench.view.value.entries[0]?.section_id).toBe('section-client')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename section Client work"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Section name"]')
    if (!renameInput) throw new Error('Missing rename input')

    await act(async () => {
      renameInput.value = 'Consulting'
      renameInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Save section name"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Consulting')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete section Consulting"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Consulting')
    expect(workbench.view.value.entries[0]?.section_id).toBeNull()
  })

  it('filters to pinned designs and pins rows from the ledger', async () => {
    const setEntryPinned = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [],
        entries: [
          {
            path: '/designs/home.canopi',
            name: 'Home',
            updated_at: '2026-06-20T08:00:00.000Z',
            plant_count: 3,
            pinned: true,
            section_id: null,
          },
          {
            path: '/designs/client.canopi',
            name: 'Client',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
            pinned: false,
            section_id: null,
          },
        ],
      }),
      openDesign: vi.fn(),
      setEntryPinned,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Pinned designs"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('Home')
    expect(container.textContent).not.toContain('Client')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="All designs"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Pin Client"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Pinned designs"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(setEntryPinned).toHaveBeenCalledWith('/designs/client.canopi', true)
    expect(container.textContent).toContain('Client')
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
            pinned: false,
            section_id: null,
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

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
})
