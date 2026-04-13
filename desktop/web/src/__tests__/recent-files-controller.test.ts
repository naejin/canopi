import { describe, expect, it, vi } from 'vitest'
import { createRecentFilesController } from '../app/recent-files'

describe('recent files controller', () => {
  it('loads and truncates the recent-files list', async () => {
    const loadRecentFiles = vi.fn().mockResolvedValue([
      { path: '/a', name: 'A', updated_at: '2026-04-01T00:00:00.000Z', plant_count: 1 },
      { path: '/b', name: 'B', updated_at: '2026-04-02T00:00:00.000Z', plant_count: 2 },
      { path: '/c', name: 'C', updated_at: '2026-04-03T00:00:00.000Z', plant_count: 3 },
      { path: '/d', name: 'D', updated_at: '2026-04-04T00:00:00.000Z', plant_count: 4 },
      { path: '/e', name: 'E', updated_at: '2026-04-05T00:00:00.000Z', plant_count: 5 },
      { path: '/f', name: 'F', updated_at: '2026-04-06T00:00:00.000Z', plant_count: 6 },
    ])
    const controller = createRecentFilesController({ loadRecentFiles, maxItems: 5 })

    await controller.load()

    expect(controller.recentFiles.value).toHaveLength(5)
    expect(controller.recentFiles.value[0]?.path).toBe('/a')
    expect(controller.recentFiles.value[4]?.path).toBe('/e')
  })

  it('treats recent-files load failures as a non-fatal empty state', async () => {
    const controller = createRecentFilesController({
      loadRecentFiles: vi.fn().mockRejectedValue(new Error('failed')),
    })

    await controller.load()

    expect(controller.recentFiles.value).toEqual([])
  })
})
