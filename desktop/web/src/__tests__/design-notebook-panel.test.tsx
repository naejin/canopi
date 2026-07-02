import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignNotebookWorkbench } from '../app/design-notebook/workbench'
import { DesignNotebookPanel } from '../components/panels/DesignNotebookPanel'

describe('DesignNotebookPanel', () => {
  let container: HTMLDivElement

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
            section_id: null,
          },
          {
            path: '/designs/forest-edge.canopi',
            name: 'Forest Edge',
            updated_at: '2026-06-22T08:00:00.000Z',
            plant_count: 7,
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
})
