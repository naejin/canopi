import { describe, expect, it, vi } from 'vitest'
import {
  DesignMigrationError,
  isGeneratedZoneName,
  migrateToCurrent,
  placeAtSite,
} from '../app/contracts/design-migrations'
import {
  CanopiDesignIngestionError,
  CanopiDesignNeedsSiteError,
  describeDesignLoadError,
  designLoadFailureMessageKey,
  designLoadFailureOf,
} from '../app/contracts/canopi-design-errors'
import {
  decodeCanopiDesign,
  decodeCanopiDesignOutcome,
  placeCanopiDesignAtSite,
} from '../app/contracts/design-ingestion'
import {
  DesignSitePlacementCancelledError,
  registerDesignSiteResolver,
  resolveDesignLoadOutcome,
} from '../app/document-session/site-placement'
import { isCancelled } from '../app/document-session/state-machine'
import { createContinuousSave } from '../app/document-session/continuous-save'
import { createDesignSessionStoreTestFixture, createMemoryDesignSessionStore } from '../app/document-session/store'
import type { CanopiFile, DesignLoadOutcome, LoadedDesign, PendingDesignSite } from '../types/design'

function v5(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 5,
    name: 'Canopi 1.2 garden',
    plant_species_colors: {},
    layers: [
      { name: 'base', visible: false, locked: false, opacity: 1 },
      { name: 'plants', visible: true, locked: false, opacity: 1 },
    ],
    plants: [{ id: 'plant-1', canonical_name: 'Malus domestica', position: { x: 100, y: -50 }, rotation: 45 }],
    zones: [{ name: 'Orchard', zone_type: 'rect', points: [{ x: 0, y: 0 }, { x: 20, y: 10 }], rotation: 30 }],
    annotations: [{ id: 'note-1', annotation_type: 'text', position: { x: 5, y: 5 }, text: 'Well', font_size: 14 }],
    measurement_guides: [{ id: 'guide-1', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
    guides: [{ id: 'ruler-h', axis: 'h', position: 40 }, { id: 'ruler-v', axis: 'v', position: -30 }],
    timeline: [{
      id: 'action-1', action_type: 'plant', description: 'Plant',
      targets: [{ kind: 'zone', zone_name: 'Orchard' }], completed: false, order: 0,
    }],
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

function current(outcome: ReturnType<typeof migrateToCurrent>): Record<string, unknown> {
  if (outcome.kind !== 'current') throw new Error('expected a placed Design')
  return outcome.value
}

describe('Design migration ladder (Web mirror)', () => {
  it('refuses versions outside the ladder and non-objects', () => {
    expect(() => migrateToCurrent({ version: 4 }, 4)).toThrow(DesignMigrationError)
    expect(() => migrateToCurrent({ version: 10 }, 10)).toThrow('this build opens versions 5 to 9')
    expect(() => migrateToCurrent([], 9)).toThrow('$: expected a Canopi Design object')
    expect(migrateToCurrent({ version: 9 }, 9)).toEqual({ kind: 'current', value: { version: 9 }, migratedFrom: null })
  })

  it('places a v5 Design with a location and projects every position', () => {
    const value = current(migrateToCurrent(v5({ location: { lat: 48.8566, lon: 2.3522 }, north_bearing_deg: 0 }), 5))
    expect(value.version).toBe(9)
    expect(value).not.toHaveProperty('spatial_frame')
    expect(value).not.toHaveProperty('location')
    const plant = (value.plants as { position: { lon: number; lat: number }; rotation: number }[])[0]!
    expect(plant.position.lon).toBeCloseTo(2.3522 + 0.0013666, 5)
    expect(plant.position.lat).toBeGreaterThan(48.8566)
    expect(plant.rotation).toBe(45)
    const zone = (value.zones as Record<string, unknown>[])[0]!
    expect(zone).toMatchObject({ id: 'Orchard', name: 'Orchard', rotation: 30 })
    expect((zone.points as unknown[])[0]).toEqual({ lon: 2.3522, lat: 48.8566 })
    expect((value.guides as Record<string, unknown>[])[0]).toMatchObject({ axis: 'h', id: 'ruler-h' })
    expect((value.layers as { name: string }[]).map((layer) => layer.name)).toEqual(['plants'])
    expect((value.timeline as { targets: unknown[] }[])[0]!.targets[0]).toEqual({ kind: 'zone', zone_id: 'Orchard' })
    expect(value.views).toEqual([])
    expect(value.stories).toEqual([])
  })

  it('rotates the frame by the north bearing and keeps box zones axis aligned', () => {
    const value = current(migrateToCurrent(v5({ location: { lat: 0, lon: 0 }, north_bearing_deg: 90 }), 5))
    const plant = (value.plants as { position: { lon: number; lat: number }; rotation: number }[])[0]!
    expect(plant.position.lat).toBeGreaterThan(0)
    expect(Math.abs(plant.position.lon)).toBeLessThan(1e-3)
    expect(plant.rotation).toBe(315)
    const zone = (value.zones as { rotation: number; points: { lon: number; lat: number }[] }[])[0]!
    expect(zone.rotation).toBe(300)
    const metresPerDegree = 2 * Math.PI * 6371008.8 / 360
    expect(Math.abs(zone.points[1]!.lon - zone.points[0]!.lon) * metresPerDegree).toBeCloseTo(20, 1)
    expect(Math.abs(zone.points[1]!.lat - zone.points[0]!.lat) * metresPerDegree).toBeCloseTo(10, 1)
  })

  it('stops at needs_site for a Design without a location and finishes when placed', () => {
    const outcome = migrateToCurrent(v5(), 5)
    expect(outcome.kind).toBe('needs_site')
    if (outcome.kind !== 'needs_site') return
    expect(outcome.pending).toMatchObject({
      from_version: 5, name: 'Canopi 1.2 garden', plant_count: 1, zone_count: 1, object_count: 4, width_m: 100, height_m: 60,
    })

    const placed = current(placeAtSite(outcome.pending, { lon: 2.3522, lat: 48.8566 }))
    const plant = (placed.plants as { position: { lon: number; lat: number } }[])[0]!
    // The objects' centre (50, -20) lands on the site: the plant ends north-east of it.
    expect(plant.position.lon).toBeGreaterThan(2.3522)
    expect(plant.position.lat).toBeGreaterThan(48.8566)
    expect(placed.version).toBe(9)
    expect(() => placeAtSite(outcome.pending, { lon: 181, lat: 0 })).toThrow('$.site')
    expect(() => placeAtSite({ ...outcome.pending, document_json: 'nope' }, { lon: 0, lat: 0 })).toThrow('not JSON')
  })

  it('refuses a v6 Design without its frame', () => {
    expect(() => migrateToCurrent({ ...v5(), version: 6 }, 6)).toThrow('$.spatial_frame')
  })

  it('splits v8 zone names into ids and display names and renames targets and LiDAR kinds', () => {
    const value = current(migrateToCurrent({
      version: 8,
      zones: [
        { name: 'North bed', zone_type: 'rect', points: [] },
        { name: 'zone-12df7cef-c856-47a2-a4d0-63a5bfcff9d4 copy copy 2', zone_type: 'rect', points: [] },
        { name: 'North bed', zone_type: 'line', points: [] },
      ],
      timeline: [{ targets: [{ kind: 'zone', zone_name: 'North bed' }, { kind: 'species', canonical_name: 'Malus domestica' }] }],
      budget: [{ target: { kind: 'zone', zone_name: 'North bed' } }, {}],
      lidar: { schema_version: 1, entries: [{ kind: 'Analysis', id: 'slope-1' }, { kind: 'Source', id: 'dem-1' }] },
    }, 8))
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
  it('decodes a pending Design as needs_site and throws where it must open now', () => {
    const outcome = decodeCanopiDesignOutcome(v5())
    expect(outcome.kind).toBe('needs_site')
    expect(() => decodeCanopiDesign(v5())).toThrow(CanopiDesignNeedsSiteError)
    if (outcome.kind !== 'needs_site') return
    const file = placeCanopiDesignAtSite(outcome.pending, { lon: 2.3522, lat: 48.8566 })
    expect(file.version).toBe(9)
    expect(file.zones[0]).toMatchObject({ id: 'Orchard', name: 'Orchard' })
  })

  it('maps every load error to a kind and a Start-screen string, never "invalid" for an older file', () => {
    expect(designLoadFailureOf({ kind: 'older_version', message: 'too old' })).toEqual({ kind: 'older_version', message: 'too old' })
    expect(designLoadFailureOf({ kind: 'bogus', message: 'x' })).toBeNull()
    expect(designLoadFailureOf(new Error('Dialog cancelled'))).toBeNull()
    expect(designLoadFailureOf('Dialog cancelled')).toBeNull()
    const tooOld = (() => { try { decodeCanopiDesign({ version: 4 }) } catch (error) { return error } })()
    expect(designLoadFailureOf(tooOld)).toMatchObject({ kind: 'older_version' })
    const tooNew = (() => { try { decodeCanopiDesign({ version: 10 }) } catch (error) { return error } })()
    expect(designLoadFailureOf(tooNew)).toMatchObject({ kind: 'newer_version' })
    const pending = (() => { try { decodeCanopiDesign(v5()) } catch (error) { return error } })()
    expect(designLoadFailureOf(pending)).toMatchObject({ kind: 'older_version' })
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

describe('resolving a load outcome', () => {
  const file = { version: 9, name: 'Garden' } as CanopiFile
  const loaded: LoadedDesign = { file, fingerprint: 'f1', migrated_from: 8 }
  const pending: PendingDesignSite = {
    from_version: 5, name: 'Old', plant_count: 1, zone_count: 0, object_count: 1, width_m: 0, height_m: 0, document_json: '{}',
  }
  const placeAtSiteMock = vi.fn(async (): Promise<LoadedDesign> => ({ file, fingerprint: 'f2', migrated_from: 5 }))

  it('passes a loaded Design through with its migration marker', async () => {
    const outcome: DesignLoadOutcome = { kind: 'loaded', design: loaded }
    await expect(resolveDesignLoadOutcome(outcome, '/g.canopi', placeAtSiteMock)).resolves.toEqual({
      file, path: '/g.canopi', name: 'Garden', fingerprint: 'f1', migratedFrom: 8,
    })
    expect(placeAtSiteMock).not.toHaveBeenCalled()
  })

  it('fails a pending Design typed when nothing can ask for a site', async () => {
    registerDesignSiteResolver(null)
    const outcome: DesignLoadOutcome = { kind: 'needs_site', pending, fingerprint: 'f0' }
    await expect(resolveDesignLoadOutcome(outcome, '/old.canopi', placeAtSiteMock)).rejects.toBeInstanceOf(CanopiDesignNeedsSiteError)
  })

  it('places a pending Design at the resolved site, or cancels when the user declines', async () => {
    const outcome: DesignLoadOutcome = { kind: 'needs_site', pending, fingerprint: 'f0' }
    registerDesignSiteResolver(async () => ({ lon: 2.3522, lat: 48.8566 }))
    await expect(resolveDesignLoadOutcome(outcome, '/old.canopi', placeAtSiteMock)).resolves.toMatchObject({
      path: '/old.canopi', fingerprint: 'f2', migratedFrom: 5,
    })
    expect(placeAtSiteMock).toHaveBeenCalledWith(pending, { lon: 2.3522, lat: 48.8566 }, 'f0')

    registerDesignSiteResolver(async () => null)
    const declined = resolveDesignLoadOutcome(outcome, '/old.canopi', placeAtSiteMock)
    await expect(declined).rejects.toBeInstanceOf(DesignSitePlacementCancelledError)
    await declined.catch((error: unknown) => expect(isCancelled(error)).toBe(true))
    registerDesignSiteResolver(null)
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
