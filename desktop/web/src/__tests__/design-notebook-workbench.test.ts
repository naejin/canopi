import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createDesignNotebookWorkbench } from '../app/design-notebook/workbench'
import type { CanopiFile, DesignSummary } from '../types/design'

describe('design notebook workbench', () => {
  function deferred<T>(): {
    readonly promise: Promise<T>
    readonly resolve: (value: T) => void
    readonly reject: (error: unknown) => void
  } {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve
      reject = promiseReject
    })
    return { promise, resolve, reject }
  }

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

  it('loads a saved-design ledger and opens rows through the document seam', async () => {
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

    await workbench.load()

    expect(workbench.view.value.entries.map((entry) => entry.path)).toEqual([
      '/designs/terrace.canopi',
      '/designs/forest-edge.canopi',
    ])
    expect(workbench.view.value.activePath).toBe('/designs/terrace.canopi')
    expect(workbench.view.value.visibleEntries.map((entry) => entry.name)).toEqual([
      'Terrace Guild',
      'Forest Edge',
    ])

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
      sort_order: 1,
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
            sort_order: 0,
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
            section_id: null,
            sort_order: 0,
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

  it('removes a saved Design reference without changing the active Design Session path', async () => {
    const activePath = signal<string | null>('/designs/forest-edge.canopi')
    const removeEntry = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      activePath,
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
          {
            path: '/designs/home.canopi',
            name: 'Home',
            updated_at: '2026-06-20T08:00:00.000Z',
            plant_count: 3,
            section_id: null,
            sort_order: 1,
          },
        ],
      }),
      openDesign: vi.fn(),
      removeEntry,
    })

    await workbench.load()
    await workbench.removeEntry('/designs/forest-edge.canopi')

    expect(removeEntry).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(workbench.view.value.entries.map((entry) => entry.path)).toEqual(['/designs/home.canopi'])
    expect(workbench.view.value.activePath).toBe('/designs/forest-edge.canopi')
  })

  it('loads Recent Designs as a capped menu projection', async () => {
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({ sections: [], entries: [] }),
      loadRecentDesigns: vi.fn().mockResolvedValue([
        { path: '/a.canopi', name: 'A', updated_at: '2026-06-01T00:00:00.000Z', plant_count: 1 },
        { path: '/b.canopi', name: 'B', updated_at: '2026-06-02T00:00:00.000Z', plant_count: 2 },
        { path: '/c.canopi', name: 'C', updated_at: '2026-06-03T00:00:00.000Z', plant_count: 3 },
        { path: '/d.canopi', name: 'D', updated_at: '2026-06-04T00:00:00.000Z', plant_count: 4 },
        { path: '/e.canopi', name: 'E', updated_at: '2026-06-05T00:00:00.000Z', plant_count: 5 },
        { path: '/f.canopi', name: 'F', updated_at: '2026-06-06T00:00:00.000Z', plant_count: 6 },
      ]),
      openDesign: vi.fn(),
    })

    await workbench.loadRecentDesigns()

    expect(workbench.view.value.recentEntries.map((entry) => entry.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('keeps newer Recent Design refreshes when older loads resolve later', async () => {
    const firstLoad = deferred<DesignSummary[]>()
    const secondLoad = deferred<DesignSummary[]>()
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({ sections: [], entries: [] }),
      loadRecentDesigns: vi.fn()
        .mockReturnValueOnce(firstLoad.promise)
        .mockReturnValueOnce(secondLoad.promise),
      openDesign: vi.fn(),
    })

    const firstRefresh = workbench.loadRecentDesigns()
    const secondRefresh = workbench.loadRecentDesigns()

    secondLoad.resolve([
      { path: '/new.canopi', name: 'New', updated_at: '2026-06-02T00:00:00.000Z', plant_count: 2 },
    ])
    await secondRefresh

    expect(workbench.view.value.recentEntries.map((entry) => entry.name)).toEqual(['New'])

    firstLoad.resolve([
      { path: '/old.canopi', name: 'Old', updated_at: '2026-06-01T00:00:00.000Z', plant_count: 1 },
    ])
    await firstRefresh

    expect(workbench.view.value.recentEntries.map((entry) => entry.name)).toEqual(['New'])
  })

  it('saves an unsaved current Design before adding it to a Notebook Section', async () => {
    const activePath = signal<string | null>(null)
    const currentDesign = signal<CanopiFile | null>(testDesign())
    const savedDesign = { ...testDesign(), name: 'Saved Current Design' }
    const saveAsCurrent = vi.fn().mockImplementation(async () => {
      activePath.value = '/designs/current.canopi'
      currentDesign.value = savedDesign
    })
    const addDesignReference = vi.fn().mockResolvedValue(undefined)
    const moveEntryToSection = vi.fn().mockResolvedValue(undefined)
    const loadNotebook = vi.fn()
      .mockResolvedValueOnce({
        sections: [
          {
            id: 'section-client',
            name: 'Client work',
            sort_order: 0,
            created_at: '2026-06-22T08:00:00.000Z',
            updated_at: '2026-06-22T08:00:00.000Z',
          },
        ],
        entries: [],
      })
      .mockResolvedValueOnce({
        sections: [
          {
            id: 'section-client',
            name: 'Client work',
            sort_order: 0,
            created_at: '2026-06-22T08:00:00.000Z',
            updated_at: '2026-06-22T08:00:00.000Z',
          },
        ],
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
      addDesignReference,
      moveEntryToSection,
    })

    await workbench.load()
    const added = await workbench.addCurrentDesignToNotebook('section-client')

    expect(added).toBe(true)
    expect(saveAsCurrent).toHaveBeenCalledTimes(1)
    expect(addDesignReference).toHaveBeenCalledWith('/designs/current.canopi', savedDesign)
    expect(moveEntryToSection).toHaveBeenCalledWith('/designs/current.canopi', 'section-client')
    expect(workbench.view.value.entries[0]?.path).toBe('/designs/current.canopi')
  })

  it('does not move Add Current into a deleted Notebook Section', async () => {
    const activePath = signal<string | null>('/designs/current.canopi')
    const currentDesign = signal<CanopiFile | null>(testDesign())
    const addDesignReference = vi.fn().mockResolvedValue(undefined)
    const deleteSection = vi.fn().mockResolvedValue(undefined)
    const moveEntryToSection = vi.fn().mockResolvedValue(undefined)
    const loadNotebook = vi.fn()
      .mockResolvedValueOnce({
        sections: [
          {
            id: 'section-client',
            name: 'Client work',
            sort_order: 0,
            created_at: '2026-06-22T08:00:00.000Z',
            updated_at: '2026-06-22T08:00:00.000Z',
          },
        ],
        entries: [],
      })
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
      saveCurrent: vi.fn(),
      saveAsCurrent: vi.fn(),
      addDesignReference,
      deleteSection,
      moveEntryToSection,
    })

    await workbench.load()
    await workbench.deleteSection('section-client')
    const added = await workbench.addCurrentDesignToNotebook('section-client')

    expect(added).toBe(true)
    expect(addDesignReference).toHaveBeenCalledWith('/designs/current.canopi', testDesign())
    expect(moveEntryToSection).not.toHaveBeenCalled()
    expect(workbench.view.value.entries[0]?.section_id).toBeNull()
  })

  it('does not create a notebook entry when Save As is cancelled', async () => {
    const activePath = signal<string | null>(null)
    const currentDesign = signal<CanopiFile | null>(testDesign())
    const loadNotebook = vi.fn().mockResolvedValue({ sections: [], entries: [] })
    const workbench = createDesignNotebookWorkbench({
      activePath,
      currentDesign,
      loadNotebook,
      openDesign: vi.fn(),
      saveAsCurrent: vi.fn().mockResolvedValue(undefined),
      saveCurrent: vi.fn(),
      moveEntryToSection: vi.fn(),
    })

    await workbench.load()
    const added = await workbench.addCurrentDesignToNotebook(null)

    expect(added).toBe(false)
    expect(loadNotebook).toHaveBeenCalledTimes(1)
    expect(workbench.view.value.entries).toEqual([])
  })

  it('hides the add-current affordance once the active saved path is listed', async () => {
    const activePath = signal<string | null>('/designs/current.canopi')
    const currentDesign = signal<CanopiFile | null>(testDesign())
    const workbench = createDesignNotebookWorkbench({
      activePath,
      currentDesign,
      loadNotebook: vi.fn().mockResolvedValue({
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
      }),
      openDesign: vi.fn(),
    })

    await workbench.load()

    expect(workbench.view.value.canAddCurrentDesign).toBe(false)
  })

  it('persists manual Notebook Section and row order through public commands', async () => {
    const reorderSections = vi.fn().mockResolvedValue(undefined)
    const reorderEntries = vi.fn().mockResolvedValue(undefined)
    const workbench = createDesignNotebookWorkbench({
      loadNotebook: vi.fn().mockResolvedValue({
        sections: [
          {
            id: 'section-first',
            name: 'First',
            sort_order: 0,
            created_at: '2026-06-20T08:00:00.000Z',
            updated_at: '2026-06-20T08:00:00.000Z',
          },
          {
            id: 'section-second',
            name: 'Second',
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
            section_id: null,
            sort_order: 0,
          },
          {
            path: '/designs/second.canopi',
            name: 'Second Design',
            updated_at: '2026-06-21T08:00:00.000Z',
            plant_count: 2,
            section_id: null,
            sort_order: 1,
          },
        ],
      }),
      openDesign: vi.fn(),
      reorderSections,
      reorderEntries,
    })

    await workbench.load()
    await workbench.reorderSections(['section-second', 'section-first'])
    await workbench.reorderEntries(['/designs/second.canopi', '/designs/first.canopi'])

    expect(reorderSections).toHaveBeenCalledWith(['section-second', 'section-first'])
    expect(reorderEntries).toHaveBeenCalledWith(['/designs/second.canopi', '/designs/first.canopi'])
    expect(workbench.view.value.sections.map((section) => section.id)).toEqual([
      'section-second',
      'section-first',
    ])
    expect(workbench.view.value.entries.map((entry) => entry.path)).toEqual([
      '/designs/second.canopi',
      '/designs/first.canopi',
    ])
    expect(workbench.view.value.sections.map((section) => section.sort_order)).toEqual([0, 1])
    expect(workbench.view.value.entries.map((entry) => entry.sort_order)).toEqual([0, 1])
  })
})
