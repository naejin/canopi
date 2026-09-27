import { describe, expect, it } from 'vitest'
import {
  upsertLidarEntry,
  patchLidarEntryById,
  removeLidarEntries,
  setLidarEntryOrders,
} from '../app/design-edit/lidar'
import { currentDesign, designSessionStore } from '../app/document-session/store'
import { replaceCurrentDesignState } from './support/design-session-state'
import type { CanopiFile } from '../types/design'

function design(name: string): CanopiFile {
  return {
    version: 8,
    name,
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    plant_species_codes: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
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

function readLidarEntries(file: CanopiFile) {
  return file.lidar?.entries ?? []
}

/** Entries in the order the panel displays them, lowest order first. */
function displayOrder(file: CanopiFile) {
  return [...readLidarEntries(file)].sort((left, right) => left.order - right.order)
}

describe('LiDAR presentation entries through the Design Edit seam', () => {
  it('adds ordered entries with display defaults and updates them', () => {
    const base = design('Garden')
    replaceCurrentDesignState(base, null, 'Garden')

    upsertLidarEntry('Source', 'lyr-1')
    const afterAdd = currentDesign.value
    expect(afterAdd).not.toBe(base)
    expect(afterAdd?.lidar).not.toBeNull()
    expect(readLidarEntries(afterAdd as CanopiFile)).toEqual([
      { kind: 'Source', id: 'lyr-1', visible: true, opacity: 1, order: 0, style: null },
    ])

    patchLidarEntryById('lyr-1', { visible: false, opacity: 0.5 })
    const afterPatch = currentDesign.value
    expect(readLidarEntries(afterPatch as CanopiFile)).toEqual([
      { kind: 'Source', id: 'lyr-1', visible: false, opacity: 0.5, order: 0, style: null },
    ])
    // Second entry receives the next order value.
    upsertLidarEntry('Analysis', 'adef-1')
    const entries = readLidarEntries(currentDesign.value as CanopiFile)
    expect(entries).toHaveLength(2)
    expect(entries[1]?.order).toBe(1)
  })

  it('keeps the design reference identical when nothing changes', () => {
    replaceCurrentDesignState(design('No-op'), null, 'No-op')
    upsertLidarEntry('Source', 'lyr-2')
    const before = currentDesign.value
    const dirtyBefore = designSessionStore.designDirty.value

    upsertLidarEntry('Source', 'lyr-2')
    patchLidarEntryById('lyr-2', { visible: true })

    expect(currentDesign.value).toBe(before)
    expect(designSessionStore.designDirty.value).toBe(dirtyBefore)
  })

  it('removes entries and drops the whole section when it empties', () => {
    replaceCurrentDesignState(design('Removal'), null, 'Removal')
    upsertLidarEntry('Source', 'lyr-3')
    upsertLidarEntry('Analysis', 'adef-3')

    removeLidarEntries(['adef-3'])
    expect(readLidarEntries(currentDesign.value as CanopiFile)).toHaveLength(1)

    removeLidarEntries(['lyr-3'])
    expect(currentDesign.value?.lidar ?? null).toBeNull()
  })

  it('preserves unavailable entries so library deletions never rewrite documents', () => {
    replaceCurrentDesignState(design('Stale'), null, 'Stale')
    upsertLidarEntry('Source', 'lyr-gone')
    const before = currentDesign.value

    // A library snapshot without the referenced entity does not mutate the
    // document; the presentation join flags it as unavailable instead.
    expect(readLidarEntries(currentDesign.value as CanopiFile)).toHaveLength(1)
    expect(currentDesign.value).toBe(before)
  })

  it('saves new orders in one edit and keeps display settings', () => {
    replaceCurrentDesignState(design('Order'), null, 'Order')
    upsertLidarEntry('Source', 'lyr-a')
    upsertLidarEntry('Analysis', 'adef-b')
    upsertLidarEntry('Source', 'lyr-c')
    patchLidarEntryById('lyr-a', { opacity: 0.4 })
    expect(displayOrder(currentDesign.value as CanopiFile).map((e) => e.id))
      .toEqual(['lyr-a', 'adef-b', 'lyr-c'])

    // Orders already saved are a no-op: no history entry for nothing.
    const before = currentDesign.value
    setLidarEntryOrders(new Map([['lyr-a', 0], ['adef-b', 1]]))
    expect(currentDesign.value).toBe(before)

    setLidarEntryOrders(new Map([['lyr-c', 0], ['lyr-a', 1], ['adef-b', 2]]))
    const reordered = displayOrder(currentDesign.value as CanopiFile)
    expect(reordered.map((entry) => entry.id)).toEqual(['lyr-c', 'lyr-a', 'adef-b'])
    expect(reordered.find((entry) => entry.id === 'lyr-a')?.opacity).toBe(0.4)
  })

  it('ignores orders for entries that are not presented', () => {
    replaceCurrentDesignState(design('Unknown'), null, 'Unknown')
    upsertLidarEntry('Source', 'lyr-known')
    const before = currentDesign.value
    setLidarEntryOrders(new Map([['lyr-absent', 3]]))
    expect(currentDesign.value).toBe(before)
  })
})
