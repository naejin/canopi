import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDesignNotebookWorkbench } from '../app/design-notebook/workbench'

describe('design notebook workbench', () => {
  it('loads a searchable saved-design ledger and opens rows through the document seam', async () => {
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

    await workbench.load()

    expect(workbench.view.value.entries.map((entry) => entry.path)).toEqual([
      '/designs/terrace.canopi',
      '/designs/forest-edge.canopi',
    ])
    expect(workbench.view.value.activePath).toBe('/designs/terrace.canopi')

    workbench.setSearchQuery('forest')

    expect(workbench.view.value.visibleEntries.map((entry) => entry.name)).toEqual(['Forest Edge'])

    await workbench.openEntry('/designs/forest-edge.canopi')

    expect(openDesign).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(workbench.view.value.activePath).toBe('/designs/forest-edge.canopi')
  })

  it('treats load failures as an empty ledger with an error state', async () => {
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockRejectedValue(new Error('unavailable')),
      openDesign: vi.fn(),
    })

    await workbench.load()

    expect(workbench.view.value.entries).toEqual([])
    expect(workbench.view.value.loadError).toBe(true)
  })

  it('manages Notebook Sections and one-section entry membership', async () => {
    const createSection = vi.fn().mockResolvedValue({
      id: 'section-client',
      name: 'Client work',
      created_at: '2026-06-22T08:00:00.000Z',
      updated_at: '2026-06-22T08:00:00.000Z',
    })
    const renameSection = vi.fn().mockResolvedValue(undefined)
    const deleteSection = vi.fn().mockResolvedValue(undefined)
    const moveEntryToSection = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [
          {
            id: 'section-home',
            name: 'Home',
            created_at: '2026-06-20T08:00:00.000Z',
            updated_at: '2026-06-20T08:00:00.000Z',
          },
        ],
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
      createSection,
      renameSection,
      deleteSection,
      moveEntryToSection,
    })

    await workbench.load()
    await workbench.createSection(' Client work ')
    await workbench.moveEntryToSection('/designs/forest-edge.canopi', 'section-client')
    await workbench.renameSection('section-client', 'Consulting')
    await workbench.deleteSection('section-client')

    expect(createSection).toHaveBeenCalledWith('Client work')
    expect(moveEntryToSection).toHaveBeenCalledWith('/designs/forest-edge.canopi', 'section-client')
    expect(renameSection).toHaveBeenCalledWith('section-client', 'Consulting')
    expect(deleteSection).toHaveBeenCalledWith('section-client')
    expect(workbench.view.value.sections.map((section) => section.id)).toEqual(['section-home'])
    expect(workbench.view.value.entries[0]?.section_id).toBeNull()
  })

  it('filters the Pinned view and updates pinned state locally after persistence', async () => {
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

    await workbench.load()
    workbench.setViewMode('pinned')

    expect(workbench.view.value.visibleEntries.map((entry) => entry.name)).toEqual(['Home'])

    await workbench.setEntryPinned('/designs/client.canopi', true)

    expect(setEntryPinned).toHaveBeenCalledWith('/designs/client.canopi', true)
    expect(workbench.view.value.visibleEntries.map((entry) => entry.name)).toEqual(['Home', 'Client'])
  })
})
