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
const V2_AUTHORITY_KEY = 'canopi:web-app-data:v2:authority'
const V2_PROGRESS_KEY = 'canopi:web-app-data:v2:migration-progress'
const V2_RESERVATION_KEY = 'canopi:web-app-data:v2:authority-reservation'

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
    expect(store.loadDraft(saved.value.id)).toEqual(file)
    expect(saved.value).not.toHaveProperty('path')
    expect(saved.value).not.toHaveProperty('sectionId')
    expect([...storage.values.keys()]).toEqual([
      V2_PROGRESS_KEY,
      V2_RESERVATION_KEY,
      V2_KEYS.drafts,
    ])
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
      V2_PROGRESS_KEY,
      V2_RESERVATION_KEY,
    ].sort())
  })

  it('migrates v1 one written resource at a time and commits v2 only after every partition exists', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-1', name: 'Migrated', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { 'draft-1': makeDesign({ name: 'Migrated' }) },
      settings: { locale: 'fr', theme: 'dark' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: ['Pyrus communis'],
      savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.loadSettings()).toEqual({ locale: 'fr', theme: 'dark' })
    expect(storage.writes).toEqual([])
    expect(storage.values.has(V1_KEY)).toBe(true)

    expect(store.saveSettings({ locale: 'fr', theme: 'dark' }).ok).toBe(true)
    expect(store.setFavoriteSpecies(['Malus domestica']).ok).toBe(true)
    expect(store.saveSavedObjectStamps([
      { id: 'stamp-1', name: 'Guild', payload: { objects: 2 } },
    ]).ok).toBe(true)
    expect(storage.values.has(V1_KEY)).toBe(true)

    expect(store.saveDraft({
      id: 'draft-1',
      file: makeDesign({ name: 'Migrated' }),
      now: '2026-07-04T12:00:00.000Z',
    }).ok).toBe(true)

    expect(storage.values.has(V1_KEY)).toBe(false)
    expect([...storage.values.keys()].sort()).toEqual([
      ...Object.values(V2_KEYS),
      V2_AUTHORITY_KEY,
    ].sort())
    expect(JSON.parse(storage.values.get(V2_AUTHORITY_KEY) ?? 'null')).toEqual({
      version: 2,
      authority: 'v2',
    })
    expect(JSON.parse(storage.values.get(V2_KEYS.drafts) ?? 'null')).toMatchObject({ version: 2 })
    expect(JSON.parse(storage.values.get(V2_KEYS.settings) ?? 'null')).toEqual({
      version: 2,
      settings: { locale: 'fr', theme: 'dark' },
    })
    expect(JSON.parse(storage.values.get(V2_KEYS.species) ?? 'null')).toEqual({
      version: 2,
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: ['Pyrus communis'],
    })
    expect(JSON.parse(storage.values.get(V2_KEYS.stamps) ?? 'null')).toEqual({
      version: 2,
      savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
    })
    expect(store.listDrafts()).toEqual([
      { id: 'draft-1', name: 'Migrated', updatedAt: '2026-07-04T12:00:00.000Z' },
    ])
    expect(store.loadDraft('draft-1')?.name).toBe('Migrated')

    storage.writes.length = 0
    const reopened = createBrowserAppDataStore({ storage })
    expect(reopened.listFavoriteSpecies()).toEqual(['Malus domestica'])
    expect(storage.writes).toEqual([])
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
    expect(storage.writes).toEqual([
      V2_PROGRESS_KEY,
      V2_RESERVATION_KEY,
      V2_KEYS.settings,
      V2_PROGRESS_KEY,
    ])
  })

  it('reopens a partial migration without reparsing an already-published Draft partition', () => {
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

  it('keeps writes live on v1 when a partition cannot publish and retries on a later write', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-1', name: 'Safe', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { 'draft-1': makeDesign({ name: 'Safe' }) },
      settings: { locale: 'fr' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: [],
      savedObjectStamps: [],
    }))
    storage.failWriteKeys.add(V2_KEYS.settings)
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(storage.values.has(V1_KEY)).toBe(true)
    expect(storage.values.has(V2_KEYS.settings)).toBe(false)
    expect(store.loadSettings()).toEqual({ locale: 'de' })
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['draft-1'])

    storage.failWriteKeys.clear()
    expect(store.saveSettings({ locale: 'it' })).toEqual({
      ok: true,
      value: { locale: 'it' },
    })
    expect(storage.values.has(V2_KEYS.settings)).toBe(true)
    expect(storage.values.has(V1_KEY)).toBe(true)
    expect(store.loadSettings()).toEqual({ locale: 'it' })
  })

  it('does not retry a quota-blocked full-store copy on reads and keeps Settings writable through v1', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'large', name: 'Large', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { large: makeDesign({ name: 'x'.repeat(10_000) }) },
      settings: { locale: 'fr' },
      favoriteSpecies: [],
      recentlyViewedSpecies: [],
      savedObjectStamps: [],
    }))
    storage.maxTotalLength = totalStoredLength(storage) + 8
    const store = createBrowserAppDataStore({ storage })

    expect(store.loadSettings()).toEqual({ locale: 'fr' })
    expect(store.loadSettings()).toEqual({ locale: 'fr' })
    expect(storage.writes).toEqual([])

    expect(store.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(storage.values.has(V2_KEYS.settings)).toBe(false)
    expect(store.loadSettings()).toEqual({ locale: 'de' })
  })

  it('releases admitted progress when reservation quota rejects before falling back to v1', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    replaceLegacySettings(storage, { locale: 'f' })
    const progressLength = JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '0000',
    }).length
    storage.maxTotalLength = totalStoredLength(storage) + progressLength
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(store.loadSettings()).toEqual({ locale: 'de' })
    expect(storage.values.has(V2_PROGRESS_KEY)).toBe(false)
    expect(storage.values.has(V2_RESERVATION_KEY)).toBe(false)
  })

  it('releases all migration metadata when target publication rejects before v1 fallback', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    replaceLegacySettings(storage, { locale: 'f' })
    const progressLength = JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '0000',
    }).length
    const reservationLength = JSON.stringify({
      version: 2,
      reserves: 'v2-authority-tombstone',
    }).length
    storage.maxTotalLength = totalStoredLength(storage) + progressLength + reservationLength
    storage.failWriteKeys.add(V2_KEYS.settings)
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(store.loadSettings()).toEqual({ locale: 'de' })
    expect(storage.values.has(V2_PROGRESS_KEY)).toBe(false)
    expect(storage.values.has(V2_RESERVATION_KEY)).toBe(false)
  })

  it('keeps published v2 resources authoritative across stale legacy rewrites and recreation', () => {
    const storage = memoryStorage()
    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-old', name: 'Old', updatedAt: '2026-07-04T12:00:00.000Z' }],
      draftFiles: { 'draft-old': makeDesign({ name: 'Old' }) },
      settings: { locale: 'fr' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: [],
      savedObjectStamps: [],
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'de' }).ok).toBe(true)

    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [{ id: 'draft-new', name: 'New', updatedAt: '2026-07-04T13:00:00.000Z' }],
      draftFiles: { 'draft-new': makeDesign({ name: 'New' }) },
      settings: { locale: 'es' },
      favoriteSpecies: ['Pyrus communis'],
      recentlyViewedSpecies: [],
      savedObjectStamps: [],
    }))

    expect(store.loadSettings()).toEqual({ locale: 'de' })
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['draft-new'])

    expect(store.setFavoriteSpecies(['Pyrus communis']).ok).toBe(true)
    expect(store.saveSavedObjectStamps([]).ok).toBe(true)
    expect(store.saveDraft({
      id: 'draft-new',
      file: makeDesign({ name: 'New' }),
      now: '2026-07-04T13:00:00.000Z',
    }).ok).toBe(true)
    expect(storage.values.has(V2_AUTHORITY_KEY)).toBe(true)

    storage.values.set(V1_KEY, JSON.stringify({
      drafts: [],
      draftFiles: {},
      settings: { locale: 'it' },
      favoriteSpecies: [],
      recentlyViewedSpecies: [],
      savedObjectStamps: [],
    }))
    storage.values.set(V2_PROGRESS_KEY, JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '0000',
    }))
    const reopened = createBrowserAppDataStore({ storage })

    expect(reopened.loadSettings()).toEqual({ locale: 'de' })
    expect(reopened.listDrafts().map((draft) => draft.id)).toEqual(['draft-new'])
    expect(storage.values.has(V2_PROGRESS_KEY)).toBe(false)
    expect(storage.values.has(V2_RESERVATION_KEY)).toBe(false)
  })

  it('requires the exact committed tombstone before suppressing v1 fallback', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    storage.values.set(V2_AUTHORITY_KEY, JSON.stringify({
      version: 2,
      authority: 'v2',
      extra: 'foreign',
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.loadSettings()).toEqual({ locale: 'fr' })
    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['draft-1'])
    expect(storage.values.has(V1_KEY)).toBe(true)
  })

  it('reserves at least the committed tombstone footprint before publishing partitions', () => {
    const reservation = JSON.stringify({
      version: 2,
      reserves: 'v2-authority-tombstone',
    })
    const authority = JSON.stringify({ version: 2, authority: 'v2' })

    expect(V2_RESERVATION_KEY.length + reservation.length).toBeGreaterThanOrEqual(
      V2_AUTHORITY_KEY.length + authority.length,
    )
  })

  it('does not commit an invalid partition over recoverable v1 data', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    seedV2Partitions(storage)
    storage.values.set(V2_KEYS.drafts, JSON.stringify({
      version: 2,
      drafts: 'not-an-array',
      draftFiles: {},
    }))
    storage.values.set(V2_PROGRESS_KEY, JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '1111',
    }))
    const store = createBrowserAppDataStore({ storage })

    expect(store.listDrafts().map((draft) => draft.id)).toEqual(['draft-1'])
    expect(storage.values.has(V1_KEY)).toBe(true)
    expect(JSON.parse(storage.values.get(V2_PROGRESS_KEY) ?? 'null')).toMatchObject({
      state: 'migrating',
    })

    expect(store.saveDraft({
      id: 'draft-1',
      file: makeDesign({ name: 'Draft' }),
      now: '2026-07-04T12:00:00.000Z',
    }).ok).toBe(true)
    expect(storage.values.has(V1_KEY)).toBe(false)
    expect(JSON.parse(storage.values.get(V2_AUTHORITY_KEY) ?? 'null')).toMatchObject({
      authority: 'v2',
    })
  })

  it('recovers a crash after the fourth partition write and before marker finalization', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    seedV2Partitions(storage)
    storage.values.set(V2_PROGRESS_KEY, JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '1110',
    }))

    const reopened = createBrowserAppDataStore({ storage })

    expect(reopened.loadSettings()).toEqual({ locale: 'fr' })
    expect(storage.values.has(V1_KEY)).toBe(false)
    expect(JSON.parse(storage.values.get(V2_AUTHORITY_KEY) ?? 'null')).toEqual({
      version: 2,
      authority: 'v2',
    })
  })

  it('recovers the reservation-to-tombstone crash gap', () => {
    const storage = memoryStorage()
    seedV2Partitions(storage)
    storage.values.set(V2_PROGRESS_KEY, JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '1111',
    }))

    const reopened = createBrowserAppDataStore({ storage })

    expect(reopened.loadSettings()).toEqual({ locale: 'fr' })
    expect(storage.values.has(V1_KEY)).toBe(false)
    expect(JSON.parse(storage.values.get(V2_AUTHORITY_KEY) ?? 'null')).toEqual({
      version: 2,
      authority: 'v2',
    })
  })

  it('keeps a committed write successful when legacy removal fails and retries cleanup later', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    storage.failRemoveKeys.add(V1_KEY)
    const store = createBrowserAppDataStore({ storage })

    expect(store.saveSettings({ locale: 'fr' }).ok).toBe(true)
    expect(store.setFavoriteSpecies(['Malus domestica']).ok).toBe(true)
    expect(store.saveSavedObjectStamps([]).ok).toBe(true)
    const finalWrite = store.saveDraft({
      id: 'draft-1',
      file: makeDesign({ name: 'Draft' }),
      now: '2026-07-04T12:00:00.000Z',
    })

    expect(finalWrite.ok).toBe(true)
    expect(storage.values.has(V1_KEY)).toBe(true)
    expect(JSON.parse(storage.values.get(V2_AUTHORITY_KEY) ?? 'null')).toMatchObject({
      authority: 'v2',
    })

    storage.failRemoveKeys.clear()
    const reopened = createBrowserAppDataStore({ storage })
    expect(reopened.loadSettings()).toEqual({ locale: 'fr' })
    expect(storage.values.has(V1_KEY)).toBe(false)
  })

  it('rebases a quota fallback when another tab establishes v2 authority', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    seedV2Partitions(storage)
    storage.values.delete(V2_KEYS.settings)
    storage.values.set(V2_PROGRESS_KEY, JSON.stringify({
      version: 2,
      state: 'migrating',
      partitions: '1011',
    }))
    storage.failWriteKeys.add(V2_KEYS.settings)
    const firstTab = createBrowserAppDataStore({ storage })
    const secondTab = createBrowserAppDataStore({ storage })
    storage.onRejectedWrite = (key) => {
      if (key !== V2_KEYS.settings) return
      storage.onRejectedWrite = null
      storage.failWriteKeys.delete(V2_KEYS.settings)
      expect(secondTab.saveSettings({ locale: 'es' }).ok).toBe(true)
    }

    expect(firstTab.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(firstTab.loadSettings()).toEqual({ locale: 'de' })
    expect(storage.values.has(V1_KEY)).toBe(false)
  })

  it('revalidates authority when marker reservation fails during a competing migration', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    seedV2Partitions(storage)
    storage.values.delete(V2_KEYS.settings)
    storage.failWriteKeys.add(V2_PROGRESS_KEY)
    const firstTab = createBrowserAppDataStore({ storage })
    const secondTab = createBrowserAppDataStore({ storage })
    storage.onRejectedWrite = (key) => {
      if (key !== V2_PROGRESS_KEY) return
      storage.onRejectedWrite = null
      storage.failWriteKeys.delete(V2_PROGRESS_KEY)
      expect(secondTab.saveSettings({ locale: 'es' }).ok).toBe(true)
    }

    expect(firstTab.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })
    expect(firstTab.loadSettings()).toEqual({ locale: 'de' })

    const reopened = createBrowserAppDataStore({ storage })
    expect(reopened.loadSettings()).toEqual({ locale: 'de' })
    expect(storage.values.has(V1_KEY)).toBe(false)
  })

  it('rebases a v1 fallback over another tab update to a different legacy resource', () => {
    const storage = memoryStorage()
    seedLegacy(storage)
    storage.failWriteKeys.add(V2_KEYS.settings)
    const firstTab = createBrowserAppDataStore({ storage })
    const secondTab = createBrowserAppDataStore({ storage })
    storage.onRejectedWrite = (key) => {
      if (key !== V2_KEYS.settings) return
      storage.onRejectedWrite = null
      storage.failWriteKeys.add(V2_KEYS.species)
      expect(secondTab.setFavoriteSpecies(['Pyrus communis'])).toEqual({
        ok: true,
        value: ['Pyrus communis'],
      })
      storage.failWriteKeys.delete(V2_KEYS.species)
    }

    expect(firstTab.saveSettings({ locale: 'de' })).toEqual({
      ok: true,
      value: { locale: 'de' },
    })

    const reopened = createBrowserAppDataStore({ storage })
    expect(reopened.loadSettings()).toEqual({ locale: 'de' })
    expect(reopened.listFavoriteSpecies()).toEqual(['Pyrus communis'])
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

  it('isolates corrupted Drafts without discarding unrelated browser app data', () => {
    const storage = memoryStorage()
    storage.setItem(V1_KEY, JSON.stringify({
      drafts: [
        { id: 'valid', name: 'Valid', updatedAt: '2026-07-04T12:00:00.000Z' },
        { id: 'corrupt', name: 'Corrupt', updatedAt: '2026-07-04T13:00:00.000Z' },
        { id: 'missing', name: 'Missing', updatedAt: '2026-07-04T14:00:00.000Z' },
      ],
      draftFiles: {
        valid: makeDesign({ name: 'Valid' }),
        corrupt: { ...makeDesign({ name: 'Corrupt' }), plants: 'not-an-array' },
      },
      settings: { locale: 'fr', theme: 'dark' },
      favoriteSpecies: ['Malus domestica'],
      recentlyViewedSpecies: ['Pyrus communis'],
      savedObjectStamps: [{ id: 'stamp-1', name: 'Guild', payload: { objects: 2 } }],
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

function seedLegacy(storage: MemoryStorage): void {
  storage.values.set(V1_KEY, JSON.stringify({
    drafts: [{ id: 'draft-1', name: 'Draft', updatedAt: '2026-07-04T12:00:00.000Z' }],
    draftFiles: { 'draft-1': makeDesign({ name: 'Draft' }) },
    settings: { locale: 'fr' },
    favoriteSpecies: ['Malus domestica'],
    recentlyViewedSpecies: ['Pyrus communis'],
    savedObjectStamps: [],
  }))
}

function replaceLegacySettings(
  storage: MemoryStorage,
  settings: Record<string, unknown>,
): void {
  const legacy = JSON.parse(storage.values.get(V1_KEY) ?? 'null') as Record<string, unknown>
  storage.values.set(V1_KEY, JSON.stringify({ ...legacy, settings }))
}

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 5,
    name: 'Draft',
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
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
