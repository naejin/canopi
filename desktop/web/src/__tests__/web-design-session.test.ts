import { describe, expect, it, vi } from 'vitest'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { createBrowserDesignSessionController, type BrowserDesignFileAdapter } from '../web/browser-design-session'
import type { CanopiFile } from '../types/design'

const NOW = new Date('2026-07-04T12:00:00.000Z')

describe('browser Design Session lifecycle', () => {
  it('creates a browser-local Design with valid empty unsupported sections', async () => {
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({
      store,
      fileAdapter: testFileAdapter(),
      now: () => NOW,
    })

    await controller.newDesign()

    const design = store.readCurrentDesign()
    expect(design).not.toBeNull()
    expect(store.readDesignPath()).toBeNull()
    expect(store.readDesignName()).toBe('Untitled')
    expect(store.isDesignDirty()).toBe(false)
    expect(design).toMatchObject({
      version: 5,
      name: 'Untitled',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      plant_species_symbols: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      measurement_guides: [],
      groups: [],
      consortiums: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      extra: {},
    })
  })

  it('opens a .canopi file as a detached browser Design and preserves future fields', async () => {
    const openedFile = makeCanopiFile({
      name: 'Loaded Garden',
      description: 'From disk',
      timeline: [{ id: 'future-action', action_type: 'other', description: 'Keep me', start_date: null, end_date: null, recurrence: null, targets: [], depends_on: null, completed: false, order: 0 }],
      extra: { preserved: true },
    }) as CanopiFile & { future_top_level: { keep: boolean } }
    openedFile.future_top_level = { keep: true }
    const adapter = testFileAdapter({
      openCanopiFile: vi.fn(async () => ({
        fileName: 'loaded-garden.canopi',
        text: JSON.stringify(openedFile),
      })),
    })
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, fileAdapter: adapter, now: () => NOW })

    await controller.openCanopi()

    const design = store.readCurrentDesign()
    expect(adapter.openCanopiFile).toHaveBeenCalledOnce()
    expect(store.readDesignPath()).toBeNull()
    expect(store.readDesignName()).toBe('Loaded Garden')
    expect(store.isDesignDirty()).toBe(false)
    expect(design?.timeline).toHaveLength(1)
    expect(design?.extra).toMatchObject({
      preserved: true,
      future_top_level: { keep: true },
    })
  })

  it('downloads the current Design as .canopi JSON after browser edits', async () => {
    const adapter = testFileAdapter()
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, fileAdapter: adapter, now: () => NOW })

    await controller.newDesign()
    store.mutateCurrentDesign((design) => ({
      ...design,
      name: 'Balcony Guild',
      description: 'Small browser edit',
    }))
    await controller.downloadCanopi()

    expect(adapter.downloadCanopiFile).toHaveBeenCalledOnce()
    const [download] = vi.mocked(adapter.downloadCanopiFile).mock.calls[0]!
    const parsed = JSON.parse(download.text) as CanopiFile
    expect(download.fileName).toBe('Balcony Guild.canopi')
    expect(parsed.name).toBe('Balcony Guild')
    expect(parsed.description).toBe('Small browser edit')
    expect(parsed.timeline).toEqual([])
    expect(parsed.budget).toEqual([])
    expect(parsed.consortiums).toEqual([])
    expect(store.isDesignDirty()).toBe(false)
    expect(store.readDesignPath()).toBeNull()
  })
})

function testFileAdapter(
  overrides: Partial<BrowserDesignFileAdapter> = {},
): BrowserDesignFileAdapter {
  return {
    openCanopiFile: vi.fn(async () => null),
    downloadCanopiFile: vi.fn(async () => undefined),
    ...overrides,
  }
}

function makeCanopiFile(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 5,
    name: 'Test Design',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
