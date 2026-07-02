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
      loadEntries: vi.fn().mockResolvedValue([
        {
          path: '/designs/terrace.canopi',
          name: 'Terrace Guild',
          updated_at: '2026-06-20T08:00:00.000Z',
          plant_count: 12,
        },
        {
          path: '/designs/forest-edge.canopi',
          name: 'Forest Edge',
          updated_at: '2026-06-22T08:00:00.000Z',
          plant_count: 7,
        },
      ]),
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
      loadEntries: vi.fn().mockRejectedValue(new Error('unavailable')),
      openDesign: vi.fn(),
    })

    await workbench.load()

    expect(workbench.view.value.entries).toEqual([])
    expect(workbench.view.value.loadError).toBe(true)
  })
})
