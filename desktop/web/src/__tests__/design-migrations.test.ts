import { describe, expect, it, vi } from 'vitest'
import {
  DesignMigrationError,
  isGeneratedZoneName,
  migrateToCurrent,
} from '../app/contracts/design-migrations'
import {
  CanopiDesignIngestionError,
  describeDesignLoadError,
  designLoadFailureMessageKey,
  designLoadFailureOf,
} from '../app/contracts/canopi-design-errors'
import { decodeCanopiDesign, decodeCanopiDesignOutcome } from '../app/contracts/design-ingestion'
import { loadResultOf } from '../app/document-session/state-machine'
import { createContinuousSave } from '../app/document-session/continuous-save'
import { createDesignSessionStoreTestFixture, createMemoryDesignSessionStore } from '../app/document-session/store'
import type { CanopiFile, LoadedDesign } from '../types/design'

/** A Design from the first Canopi 2 preview: geolocated, no views or stories, zones named only. */
function v7(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 7,
    name: 'Canopi 2 preview garden',
    plant_species_colors: {},
    layers: [{ name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants: [{ id: 'plant-1', canonical_name: 'Malus domestica', position: { lon: 2.3522, lat: 48.8566 }, rotation: 45 }],
    zones: [{
      name: 'Orchard', zone_type: 'rect', rotation: 30,
      points: [{ lon: 2.3522, lat: 48.8566 }, { lon: 2.3525, lat: 48.8565 }],
    }],
    timeline: [{
      id: 'action-1', action_type: 'plant', description: 'Plant',
      targets: [{ kind: 'zone', zone_name: 'Orchard' }], completed: false, order: 0,
    }],
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

/** A Canopi 1.2 Design: local metres under a spatial frame, below the floor. */
function canopi12(): Record<string, unknown> {
  return {
    version: 6,
    spatial_frame: { anchor_longitude_deg: 2.3522, anchor_latitude_deg: 48.8566, north_bearing_deg: 0, placement_status: 'confirmed' },
    name: 'Canopi 1.2 garden',
    plant_species_colors: {},
    layers: [],
    plants: [{ id: 'plant-1', canonical_name: 'Malus domestica', position: { x: 100, y: -50 } }],
    zones: [],
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
  }
}

describe('Design migration ladder (Web mirror)', () => {
  it('refuses versions outside the ladder and non-objects', () => {
    expect(() => migrateToCurrent(canopi12(), 6)).toThrow(DesignMigrationError)
    expect(() => migrateToCurrent(canopi12(), 6)).toThrow('unsupported Canopi Design version 6; this build opens versions 7 to 9')
    expect(() => migrateToCurrent({ version: 5 }, 5)).toThrow('this build opens versions 7 to 9')
    expect(() => migrateToCurrent({ version: 10 }, 10)).toThrow('this build opens versions 7 to 9')
    expect(() => migrateToCurrent([], 9)).toThrow('$: expected a Canopi Design object')
    expect(migrateToCurrent({ version: 9 }, 9)).toEqual({ value: { version: 9 }, migratedFrom: null })
  })

  it('runs the whole ladder from v7 and leaves the input untouched', () => {
    const input = v7()
    const { value, migratedFrom } = migrateToCurrent(input, 7)
    expect(migratedFrom).toBe(7)
    expect(input.version).toBe(7)
    expect(value.version).toBe(9)
    expect(value.views).toEqual([])
    expect(value.stories).toEqual([])
    const plant = (value.plants as { position: { lon: number; lat: number }; rotation: number }[])[0]!
    expect(plant.position).toEqual({ lon: 2.3522, lat: 48.8566 })
    expect(plant.rotation).toBe(45)
    expect((value.zones as Record<string, unknown>[])[0]).toMatchObject({ id: 'Orchard', name: 'Orchard', rotation: 30 })
    expect((value.timeline as { targets: unknown[] }[])[0]!.targets[0]).toEqual({ kind: 'zone', zone_id: 'Orchard' })
  })

  it('keeps v7 views a file already carries and adds the missing stories', () => {
    const { value } = migrateToCurrent({ version: 7, views: [{ id: 'kept' }] }, 7)
    expect(value.views).toEqual([{ id: 'kept' }])
    expect(value.stories).toEqual([])
  })

  it('splits v8 zone names into ids and display names and renames targets and LiDAR kinds', () => {
    const { value } = migrateToCurrent({
      version: 8,
      zones: [
        { name: 'North bed', zone_type: 'rect', points: [] },
        { name: 'zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2', zone_type: 'rect', points: [] },
        { name: 'North bed', zone_type: 'line', points: [] },
      ],
      timeline: [{ targets: [{ kind: 'zone', zone_name: 'North bed' }, { kind: 'species', canonical_name: 'Malus domestica' }] }],
      budget: [{ target: { kind: 'zone', zone_name: 'North bed' } }, {}],
      lidar: { schema_version: 1, entries: [{ kind: 'Analysis', id: 'slope-1' }, { kind: 'Source', id: 'dem-1' }] },
    }, 8)
    expect(value.zones).toEqual([
      { id: 'North bed', name: 'North bed', zone_type: 'rect', points: [] },
      { id: 'zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2', name: null, zone_type: 'rect', points: [] },
      { id: 'North bed (2)', name: 'North bed', zone_type: 'line', points: [] },
    ])
    expect((value.timeline as { targets: unknown[] }[])[0]!.targets).toEqual([
      { kind: 'zone', zone_id: 'North bed' },
      { kind: 'species', canonical_name: 'Malus domestica' },
    ])
    expect((value.budget as { target?: unknown }[])[0]!.target).toEqual({ kind: 'zone', zone_id: 'North bed' })
    expect((value.lidar as { entries: { kind: string }[] }).entries.map((entry) => entry.kind)).toEqual(['Derived', 'Source'])
    expect(value.version).toBe(9)
  })

  it('recognises generated zone names', () => {
    expect(isGeneratedZoneName('zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy copy 4 copy 3 copy')).toBe(true)
    expect(isGeneratedZoneName('12df7cef-c856-47a2-a4d0-63a5bfcff9d4')).toBe(true)
    expect(isGeneratedZoneName('Z01')).toBe(false)
    expect(isGeneratedZoneName('zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 (2)')).toBe(false)
  })
})

describe('Design ingestion outcomes and typed load failures', () => {
  it('admits a v7 Design through the ladder and reports the version it came from', () => {
    const outcome = decodeCanopiDesignOutcome(v7())
    expect(outcome.migratedFrom).toBe(7)
    expect(outcome.file.version).toBe(9)
    expect(outcome.file.zones[0]).toMatchObject({ id: 'Orchard', name: 'Orchard' })
    expect(outcome.file.views).toEqual([])
  })

  it('maps every load error to a kind and a Start-screen string, never "invalid" for an older file', () => {
    expect(designLoadFailureOf({ kind: 'older_version', message: 'too old' })).toEqual({ kind: 'older_version', message: 'too old' })
    expect(designLoadFailureOf({ kind: 'bogus', message: 'x' })).toBeNull()
    expect(designLoadFailureOf(new Error('Dialog cancelled'))).toBeNull()
    expect(designLoadFailureOf('Dialog cancelled')).toBeNull()
    const tooOld = (() => { try { decodeCanopiDesign(canopi12()) } catch (error) { return error } })()
    expect(tooOld).toBeInstanceOf(CanopiDesignIngestionError)
    expect(designLoadFailureOf(tooOld)).toMatchObject({ kind: 'older_version' })
    const tooNew = (() => { try { decodeCanopiDesign({ version: 10 }) } catch (error) { return error } })()
    expect(designLoadFailureOf(tooNew)).toMatchObject({ kind: 'newer_version' })
    expect(designLoadFailureOf(new CanopiDesignIngestionError('invalid_document', '$.plants'))).toMatchObject({ kind: 'invalid_document' })

    expect(designLoadFailureMessageKey('older_version')).toBe('start.cantReadOlderVersion')
    expect(designLoadFailureMessageKey('newer_version')).toBe('start.cantReadNewerVersion')
    expect(designLoadFailureMessageKey('missing')).toBe('start.cantReadMissing')
    expect(designLoadFailureMessageKey('invalid_json')).toBe('start.cantReadDamaged')
    expect(designLoadFailureMessageKey('invalid_document')).toBe('start.cantReadDamaged')
    expect(designLoadFailureMessageKey('too_large')).toBe('start.cantRead')
    expect(designLoadFailureMessageKey('internal')).toBe('start.cantRead')
    expect(describeDesignLoadError({ kind: 'missing', message: 'gone' })).toBe('gone')
    expect(describeDesignLoadError(new Error('boom'))).toBe('boom')
  })
})

describe('a loaded Design as a transition document', () => {
  it('carries the file, its fingerprint and its migration marker', () => {
    const file = { version: 9, name: 'Garden' } as CanopiFile
    const loaded: LoadedDesign = { file, fingerprint: 'f1', migrated_from: 8 }
    expect(loadResultOf(loaded, '/g.canopi')).toEqual({
      file, path: '/g.canopi', name: 'Garden', fingerprint: 'f1', migratedFrom: 8,
    })
    expect(loadResultOf({ file, fingerprint: 'f2', migrated_from: null }, '/g.canopi').migratedFrom).toBeNull()
  })
})

describe('a migrated Design and continuous save', () => {
  it('is not rewritten on open, and says so once the first write lands in the current format', async () => {
    const store = createMemoryDesignSessionStore()
    const fixture = createDesignSessionStoreTestFixture(store)
    const file = { version: 9, name: 'Migrated' } as CanopiFile
    store.replaceCurrentDesignState(file, '/m.canopi', 'Migrated')
    const writeHome = vi.fn(() => {
      fixture.markSaved()
      return { kind: 'written' as const }
    })
    const save = createContinuousSave({ store, writeHome, delayMs: 0 })

    save.beginSession({ draftId: null, fingerprint: 'f1', writePending: false, migratedFrom: 7 })
    expect(save.migratedFrom.value).toBe(7)
    expect(save.upgradedFormatWritten.value).toBe(false)
    expect(await save.flush()).toBe(true)
    expect(writeHome).not.toHaveBeenCalled()

    fixture.setState({ nonCanvasRevision: 1 })
    expect(await save.flush()).toBe(true)
    expect(writeHome).toHaveBeenCalledTimes(1)
    expect(save.upgradedFormatWritten.value).toBe(true)

    save.endSession()
    expect(save.migratedFrom.value).toBeNull()
    expect(save.upgradedFormatWritten.value).toBe(false)
    save.dispose()
  })
})
