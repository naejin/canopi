import { describe, expect, it } from 'vitest'
import {
  createBrowserAppDataStore,
  type BrowserStorageAdapter,
} from '../web/browser-app-data'
import type { CanopiFile } from '../types/design'

const V1_KEY = 'canopi:web-app-data:v1'
const V2_KEYS = {
  drafts: 'canopi:web-app-data:v2:drafts',
  settings: 'canopi:web-app-data:v2:settings',
  species: 'canopi:web-app-data:v2:species',
  stamps: 'canopi:web-app-data:v2:saved-object-stamps',
} as const

describe('browser app data store', () => {
  it('persists Browser Drafts as local convenience state without notebook fields', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const file = makeDesign({ name: 'Terrace Draft' })

    const saved = store.saveDraft({ file, now: '2026-07-04T12:00:00.000Z' })

    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('draft should save')
    expect(saved.value).toEqual({
      id: 'draft-terrace-draft',
      name: 'Terrace Draft',
      updatedAt: '2026-07-04T12:00:00.000Z',
    })
    expect(store.listDrafts()).toEqual([saved.value])
    expect(store.loadDraft(saved.value.id)).toEqual({ ...file, extra: {} })
    expect(saved.value).not.toHaveProperty('path')
    expect(saved.value).not.toHaveProperty('sectionId')
    expect([...storage.values.keys()]).toEqual([V2_KEYS.drafts])
  })

  it('stores Draft files in .canopi wire form, keeping unknown fields at the root', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const file = { ...makeDesign({ name: 'Wire Draft' }), extra: { future_top_level: { keep: true } } }

    const saved = store.saveDraft({ file, now: '2026-07-04T12:00:00.000Z' })
    if (!saved.ok) throw new Error('draft should save')

    const stored = JSON.parse(storage.values.get(V2_KEYS.drafts)!) as { draftFiles: Record<string, Record<string, unknown>> }
    const wire = stored.draftFiles[saved.value.id]!
    expect(wire).not.toHaveProperty('extra')
    expect(wire.future_top_level).toEqual({ keep: true })
    expect(store.loadDraft(saved.value.id)?.extra).toEqual({ future_top_level: { keep: true } })
  })

  it('persists browser settings, Species app data, and Saved Object Stamps', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'fr', theme: 'dark' }).ok).toBe(true)
    expect(store.loadSettings()).toEqual({ locale: 'fr', theme: 'dark' })

    expect(store.setFavoriteSpecies(['Malus domestica', 'Quercus robur']).ok).toBe(true)
    expect(store.listFavoriteSpecies()).toEqual(['Malus domestica', 'Quercus robur'])

    expect(store.recordRecentlyViewedSpecies('Malus domestica', 3).ok).toBe(true)
    expect(store.recordRecentlyViewedSpecies('Prunus persica', 3).ok).toBe(true)
    expect(store.recordRecentlyViewedSpecies('Malus domestica', 3).ok).toBe(true)
    expect(store.listRecentlyViewedSpecies()).toEqual(['Malus domestica', 'Prunus persica'])

    expect(store.saveSavedObjectStamps([
      { id: 'stamp-1', name: 'Patio guild', payload: { objects: 2 } },
    ]).ok).toBe(true)
    expect(store.listSavedObjectStamps()).toEqual([
      { id: 'stamp-1', name: 'Patio guild', payload: { objects: 2 } },
    ])
    expect([...storage.values.keys()].sort()).toEqual([
      V2_KEYS.settings,
      V2_KEYS.species,
      V2_KEYS.stamps,
    ].sort())
  })

  it('ignores browser data written by an older Canopi', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { 'draft-1': makeDesign({ name: 'Draft' }) },
      settings: { locale: 'fr' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: ['Pyrus communis'],
      savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts()).toEqual([])
    expect(store.loadSettings()).toBeNull()
    expect(store.listFavoriteSpecies()).toEqual([])
    expect(store.listSavedObjectStamps()).toEqual([])
    expect(store.setFavoriteSpecies(['Quercus robur']).ok).toBe(true)
    expect(storage.reads).not.toContain(V1_KEY)
    expect(storage.values.has(V1_KEY)).toBe(true)
  })

  describe('data from before Canopi 2.0', () => {
    const NOW = '2026-10-02T12:00:00.000Z'
    const BACKUP = 'canopi:web-app-data:before-2.0-20261002T120000Z'

    function seedEarlierData(storage: MemoryStorage) {
      const v1 = JSON.stringify({
        drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
        draftFiles: { 'draft-1': { ...makeDesign({ name: 'Draft' }), version: 6 } },
        settings: { locale: 'fr' },
      })
      storage.values.set(V1_KEY, v1)
      // The released Web Edition stored Drafts at version 6 with a root
      // `extra`; a Canopi 2 preview stored version 8.
      const released = { ...makeDesign({ name: 'Orchard' }), version: 6, extra: {}, spatial_frame: null }
      const preview = { ...makeDesign({ name: 'Hedge' }), version: 8 }
      const damaged = { ...makeDesign({ name: 'Pond' }), plants: 'not-an-array' }
      const newer = { ...makeDesign({ name: 'Future' }), version: 10 }
      const current = makeDesign({ name: 'Terrace' })
      const summaries = {
        orchard: { id: 'orchard', name: 'Orchard', updatedAt: '2026-07-04T12:00:00.000Z' },
        hedge: { id: 'hedge', name: 'Hedge', updatedAt: '2026-09-20T12:00:00.000Z' },
        pond: { id: 'pond', name: 'Pond', updatedAt: '2026-07-04T11:00:00.000Z' },
        future: { id: 'future', name: 'Future', updatedAt: '2026-10-01T11:00:00.000Z' },
        terrace: { id: 'terrace', name: 'Terrace', updatedAt: '2026-10-01T12:00:00.000Z' },
      }
      storage.values.set(V2_KEYS.drafts, JSON.stringify({
        version: 2,
        drafts: Object.values(summaries),
        draftFiles: { orchard: released, hedge: preview, pond: damaged, future: newer, terrace: current },
      }))
      return { v1, released, preview, damaged, newer, current, summaries }
    }

    it('moves them to dated backup keys, byte for byte, and keeps the rest in place', () => {
      const storage = memoryStorage()
      seedV2Partitions(storage)
      const seeded = seedEarlierData(storage)
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toEqual({ movedAside: true, keptInPlace: false, error: null })

      expect(storage.values.has(V1_KEY)).toBe(false)
      expect(storage.values.get(`${BACKUP}:v1`)).toBe(seeded.v1)
      expect(JSON.parse(storage.values.get(`${BACKUP}:v2:drafts`)!)).toEqual({
        version: 2,
        drafts: [seeded.summaries.orchard, seeded.summaries.hedge],
        draftFiles: { orchard: seeded.released, hedge: seeded.preview },
      })
      const kept = JSON.parse(storage.values.get(V2_KEYS.drafts)!) as { drafts: unknown[]; draftFiles: Record<string, unknown> }
      expect(kept.drafts).toEqual([seeded.summaries.pond, seeded.summaries.future, seeded.summaries.terrace])
      expect(kept.draftFiles).toEqual({ pond: seeded.damaged, future: seeded.newer, terrace: seeded.current })
      expect(store.listDrafts().map((draft) => draft.id)).toEqual(['terrace'])
      expect(store.loadSettings()).toEqual({ locale: 'fr' })
    })

    it('moves nothing the second time, so the notice shows once', () => {
      const storage = memoryStorage()
      seedEarlierData(storage)
      const store = createBrowserAppDataStore({ storage })
      expect(store.setAsideDataFromBefore2_0(NOW)).toEqual({ movedAside: true, keptInPlace: false, error: null })
      const after = new Map(storage.values)
      storage.writes.length = 0

      expect(store.setAsideDataFromBefore2_0('2026-10-03T12:00:00.000Z')).toEqual({ movedAside: false, keptInPlace: false, error: null })
      expect(storage.writes).toEqual([])
      expect(storage.values).toEqual(after)
    })

    it('writes nothing in a browser without earlier data', () => {
      const storage = memoryStorage()
      seedV2Partitions(storage)
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toEqual({ movedAside: false, keptInPlace: false, error: null })
      expect(storage.writes).toEqual([])
    })

    it('never replaces an earlier backup with the same date', () => {
      const storage = memoryStorage()
      const seeded = seedEarlierData(storage)
      storage.values.set(`${BACKUP}:v1`, 'an earlier backup')
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toEqual({ movedAside: true, keptInPlace: false, error: null })
      expect(storage.values.get(`${BACKUP}:v1`)).toBe('an earlier backup')
      expect(storage.values.get(`${BACKUP}-1:v1`)).toBe(seeded.v1)
    })

    it('leaves the data where it is when its backup cannot be written', () => {
      const storage = memoryStorage()
      const seeded = seedEarlierData(storage)
      const draftsBefore = storage.values.get(V2_KEYS.drafts)
      storage.failWrites = true
      const store = createBrowserAppDataStore({ storage })

      // The notice marker cannot be written either, so the user is told again next time.
      expect(store.setAsideDataFromBefore2_0(NOW)).toMatchObject({ movedAside: false, keptInPlace: true, error: expect.any(Error) })
      expect(storage.values.get(V1_KEY)).toBe(seeded.v1)
      expect(storage.values.get(V2_KEYS.drafts)).toBe(draftsBefore)
      expect([...storage.values.keys()].filter((key) => key.includes('before-2.0'))).toEqual([])
    })

    it('keeps the earlier Drafts in place when their backup lands but the Drafts record cannot be rewritten', () => {
      const storage = memoryStorage()
      seedEarlierData(storage)
      const draftsBefore = storage.values.get(V2_KEYS.drafts)
      storage.failWriteKeys.add(V2_KEYS.drafts)
      const store = createBrowserAppDataStore({ storage })

      // The browser data of the released Web Edition still moves and is reported.
      expect(store.setAsideDataFromBefore2_0(NOW)).toMatchObject({ movedAside: true, keptInPlace: true, error: expect.any(Error) })
      expect(storage.values.has(V1_KEY)).toBe(false)
      expect(storage.values.get(V2_KEYS.drafts)).toBe(draftsBefore)
      expect(storage.values.has(`${BACKUP}:v2:drafts`)).toBe(false)
    })

    it('says once that earlier Drafts stay in place when the browser has no room for their copy', () => {
      const storage = memoryStorage()
      const older = { ...makeDesign({ name: 'x'.repeat(3_000) }), version: 8 }
      const draftsBefore = JSON.stringify({
        version: 2,
        drafts: [{ id: 'hedge', name: 'Hedge', updatedAt: '2026-09-20T12:00:00.000Z' }],
        draftFiles: { hedge: older },
      })
      storage.values.set(V2_KEYS.drafts, draftsBefore)
      storage.maxTotalLength = 5_000
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toMatchObject({ movedAside: false, keptInPlace: true, error: expect.any(Error) })
      expect(storage.values.get(V2_KEYS.drafts)).toBe(draftsBefore)
      expect(store.listDrafts()).toEqual([])

      // Told once: the next start, still without room, says nothing.
      expect(store.setAsideDataFromBefore2_0('2026-10-03T12:00:00.000Z')).toMatchObject({ movedAside: false, keptInPlace: false, error: expect.any(Error) })
      expect(storage.values.get(V2_KEYS.drafts)).toBe(draftsBefore)

      // Once there is room, the Drafts move aside and that is said too.
      storage.maxTotalLength = null
      expect(store.setAsideDataFromBefore2_0('2026-10-04T12:00:00.000Z')).toEqual({ movedAside: true, keptInPlace: false, error: null })
      expect(JSON.parse(storage.values.get('canopi:web-app-data:before-2.0-20261004T120000Z:v2:drafts')!).draftFiles).toEqual({ hedge: older })
      expect([...storage.values.keys()].sort()).toEqual([
        'canopi:web-app-data:before-2.0-20261004T120000Z:v2:drafts',
        V2_KEYS.drafts,
      ])
    })

    it('says once that the 1.x document stays in place when the browser has no room for its copy', () => {
      const storage = memoryStorage()
      const v1 = JSON.stringify({ settings: { locale: 'fr' }, padding: 'x'.repeat(3_000) })
      storage.values.set(V1_KEY, v1)
      storage.maxTotalLength = 5_000
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toMatchObject({ movedAside: false, keptInPlace: true, error: expect.any(Error) })
      expect(storage.values.get(V1_KEY)).toBe(v1)
      expect(store.setAsideDataFromBefore2_0('2026-10-03T12:00:00.000Z')).toMatchObject({ movedAside: false, keptInPlace: false })
      expect(storage.values.get(V1_KEY)).toBe(v1)
    })

    it('does not claim earlier data stays in place when browser storage cannot be read', () => {
      const storage = memoryStorage()
      storage.forbiddenReadKeys.add(V1_KEY)
      storage.forbiddenReadKeys.add(V2_KEYS.drafts)
      const store = createBrowserAppDataStore({ storage })

      expect(store.setAsideDataFromBefore2_0(NOW)).toMatchObject({ movedAside: false, keptInPlace: false, error: expect.any(Error) })
    })
  })

  it('saves Settings without reading or serializing the Draft partition', () => {
    const storage = memoryStorage()
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [{ id: 'large', name: 'Large', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { large: makeDesign({ name: 'x'.repeat(10_000) }) },
    }))
    storage.forbiddenReadKeys.add(V2_KEYS.drafts)
    storage.maxWriteLength = 200
    const store = createBrowserAppDataStore({ storage })

    const result = store.saveSettings({ locale: 'fr', theme: 'dark' })

    expect(result).toEqual({ ok: true, value: { locale: 'fr', theme: 'dark' } })
    expect(storage.reads).not.toContain(V2_KEYS.drafts)
    expect(storage.writes).toEqual([V2_KEYS.settings])
  })

  it('reopens app data without reparsing an already-published Draft partition', () => {
    const storage = memoryStorage()
    const firstStore = createBrowserAppDataStore({ storage })
    expect(firstStore.saveDraft({
      file: makeDesign({ name: 'x'.repeat(10_000) }),
      now: '2026-07-04T12:00:00.000Z',
    }).ok).toBe(true)
    storage.reads.length = 0
    storage.forbiddenReadKeys.add(V2_KEYS.drafts)
    const reopened = createBrowserAppDataStore({ storage })

    expect(reopened.loadSettings()).toBeNull()
    expect(reopened.saveSettings({ locale: 'fr' }).ok).toBe(true)
    expect(storage.reads).not.toContain(V2_KEYS.drafts)
  })

  it.each([
    ['drafts', V2_KEYS.drafts],
    ['settings', V2_KEYS.settings],
    ['species', V2_KEYS.species],
    ['stamps', V2_KEYS.stamps],
  ] as const)('isolates a corrupt %s partition', (_name, corruptKey) => {
    const storage = memoryStorage()
    seedV2Partitions(storage)
    storage.values.set(corruptKey, '{not-json')
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts().map((draft) => draft.id)).toEqual(
      corruptKey === V2_KEYS.drafts ? [] : ['draft-1'],
    )
    expect(store.loadSettings()).toEqual(
      corruptKey === V2_KEYS.settings ? null : { locale: 'fr' },
    )
    expect(store.listFavoriteSpecies()).toEqual(
      corruptKey === V2_KEYS.species ? [] : ['Malus domestica'],
    )
    expect(store.listRecentlyViewedSpecies()).toEqual(
      corruptKey === V2_KEYS.species ? [] : ['Pyrus communis'],
    )
    expect(store.listSavedObjectStamps()).toEqual(
      corruptKey === V2_KEYS.stamps
        ? []
        : [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    )
  })

  it('reports storage failures without replacing existing readable app data', () => {
    const storage = memoryStorage()
    const store = createBrowserAppDataStore({ storage })
    const saved = store.saveDraft({ file: makeDesign({ name: 'Safe Draft' }), now: '2026-07-04T12:00:00.000Z' })
    if (!saved.ok) throw new Error('initial save should pass')
    storage.failWrites = true

    const failed = store.saveDraft({ file: makeDesign({ name: 'Broken Draft' }), now: '2026-07-04T13:00:00.000Z' })

    expect(failed.ok).toBe(false)
    expect(store.listDrafts()).toEqual([saved.value])
    expect(store.loadDraft(saved.value.id)?.name).toBe('Safe Draft')
  })

  it('keeps the stored bytes of Drafts it cannot open when another Draft is saved or deleted', () => {
    const storage = memoryStorage()
    // The released Web Edition stored Drafts as in-memory files at version 6
    // with a root `extra`; this Canopi refuses them but must not erase them.
    const olderDraft = { ...makeDesign({ name: 'Orchard' }), version: 6, extra: {}, spatial_frame: null }
    const damagedDraft = { ...makeDesign({ name: 'Pond' }), plants: 'not-an-array' }
    const olderSummary = { id: 'orchard', name: 'Orchard', updatedAt: '2026-07-04T12:00:00.000Z' }
    const damagedSummary = { id: 'pond', name: 'Pond', updatedAt: '2026-07-04T11:00:00.000Z' }
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [olderSummary, damagedSummary],
      draftFiles: { orchard: olderDraft, pond: damagedDraft },
    }))
    const store = createBrowserAppDataStore({ storage })
    expect(store.listDrafts()).toEqual([])

    const saved = store.saveDraft({ id: 'new', file: makeDesign({ name: 'New' }), now: '2026-07-05T12:00:00.000Z' })
    expect(saved.ok).toBe(true)
    expect(store.deleteDraft('new').ok).toBe(true)
    expect(store.saveDraft({ id: 'next', file: makeDesign({ name: 'Next' }), now: '2026-07-05T13:00:00.000Z' }).ok).toBe(true)

    const stored = JSON.parse(storage.values.get(V2_KEYS.drafts)!) as {
      drafts: unknown[]
      draftFiles: Record<string, unknown>
    }
    expect(stored.draftFiles.orchard).toEqual(olderDraft)
    expect(stored.draftFiles.pond).toEqual(damagedDraft)
    expect(stored.draftFiles).not.toHaveProperty('new')
    expect(stored.drafts).toEqual(expect.arrayContaining([olderSummary, damagedSummary]))
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['next'])
  })

  it('isolates corrupted Drafts without discarding unrelated browser app data', () => {
    const storage = memoryStorage()
    seedV2Partitions(storage)
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: [
        { id: 'valid', name: 'Valid', updatedAt: '2026-07-04T12:00:00.000Z' },
        { id: 'corrupt', name: 'Corrupt', updatedAt: '2026-07-04T13:00:00.000Z' },
        { id: 'missing', name: 'Missing', updatedAt: '2026-07-04T14:00:00.000Z' },
      ],
      draftFiles: {
        valid: makeDesign({ name: 'Valid' }),
        corrupt: { ...makeDesign({ name: 'Corrupt' }), plants: 'not-an-array' },
      },
    }))
    storage.values.set(V2_KEYS.settings, JSON.stringify({
      version: 2,
      settings: { locale: 'fr', theme: 'dark' },
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['valid'])
    expect(store.loadDraft('valid')?.name).toBe('Valid')
    expect(store.loadDraft('corrupt')).toBeNull()
    expect(store.loadDraft('missing')).toBeNull()
    expect(store.loadSettings()).toEqual({ locale: 'fr', theme: 'dark' })
    expect(store.listFavoriteSpecies()).toEqual(['Malus domestica'])
    expect(store.listRecentlyViewedSpecies()).toEqual(['Pyrus communis'])
    expect(store.listSavedObjectStamps()).toEqual([
      { id: 'stamp-1', name: 'Guild', payload: { objects: 2 } },
    ])
  })
})

interface MemoryStorage extends BrowserStorageAdapter {
  failRemoveKeys: Set<string>
  failWrites: boolean
  failWriteKeys: Set<string>
  forbiddenReadKeys: Set<string>
  maxWriteLength: number | null
  maxTotalLength: number | null
  onRejectedWrite: ((key: string, value: string) => void) | null
  reads: string[]
  writes: string[]
  values: Map<string, string>
}

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  return {
    failWrites: false,
    failRemoveKeys: new Set(),
    failWriteKeys: new Set(),
    forbiddenReadKeys: new Set(),
    maxWriteLength: null,
    maxTotalLength: null,
    onRejectedWrite: null,
    reads: [],
    writes: [],
    values,
    getItem(key) {
      this.reads.push(key)
      if (this.forbiddenReadKeys.has(key)) throw new Error(`forbidden read: ${key}`)
      return values.get(key) ?? null
    },
    setItem(key, value) {
      this.writes.push(key)
      const nextTotalLength = totalStoredLength(this) - (values.get(key)?.length ?? 0) + value.length
      const rejected = (
        this.failWrites
        || this.failWriteKeys.has(key)
        || (this.maxWriteLength !== null && value.length > this.maxWriteLength)
        || (this.maxTotalLength !== null && nextTotalLength > this.maxTotalLength)
      )
      if (rejected) {
        this.onRejectedWrite?.(key, value)
        throw new Error('storage unavailable')
      }
      values.set(key, value)
    },
    removeItem(key) {
      if (this.failRemoveKeys.has(key)) throw new Error('storage unavailable')
      values.delete(key)
    },
  }
}

function totalStoredLength(storage: Pick<MemoryStorage, 'values'>): number {
  return [...storage.values.values()].reduce((total, value) => total + value.length, 0)
}

function seedV2Partitions(storage: MemoryStorage): void {
  storage.values.set(V2_KEYS.drafts, JSON.stringify({
    version: 2,
    drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
    draftFiles: { 'draft-1': makeDesign({ name: 'Draft' }) },
  }))
  storage.values.set(V2_KEYS.settings, JSON.stringify({
    version: 2,
    settings: { locale: 'fr' },
  }))
  storage.values.set(V2_KEYS.species, JSON.stringify({
    version: 2,
    favoriteSpecies: ['Malus domestica'],
    recentlyViewedSpecies: ['Pyrus communis'],
  }))
  storage.values.set(V2_KEYS.stamps, JSON.stringify({
    version: 2,
    savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
  }))
}

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 9,
    name: 'Draft',
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
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
    views: [],
    stories: [],
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}
