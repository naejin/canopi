import { describe, expect, it } from 'vitest'
import type { SavedObjectStampPayload } from '../canvas/saved-object-stamp-payload'
import {
  composeSavedObjectStampCanopiFile,
  importedSavedObjectStampName,
  savedObjectStampPayloadFromCanopiFile,
} from '../app/saved-object-stamps/file'
import type { CanopiFile } from '../types/design'

function canopiFile(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 3,
    name: 'Imported guild',
    description: 'Do not import this as stamp metadata',
    location: { lat: 45, lon: 3, altitude_m: 20 },
    north_bearing_deg: 15,
    plant_species_colors: { 'Malus domestica': '#112233' },
    plant_species_symbols: { 'Malus domestica': 'tree' },
    layers: [
      { name: 'plants', visible: true, locked: true, opacity: 0.5 },
      { name: 'zones', visible: false, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'USD',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    extra: { guides: [{ axis: 'h', position: 10 }] },
    ...overrides,
  }
}

describe('Saved Object Stamp file composition', () => {
  it('exports a minimal Canopi file with only visible stamp geometry', () => {
    const payload: SavedObjectStampPayload = {
      version: 1,
      anchor: { x: 10, y: 20 },
      plants: [{
        id: 'plant-source',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'tree',
        position: { x: 10, y: 20 },
        rotationDeg: 15,
        scale: 2,
      }],
      zones: [{
        id: 'zone-source',
        name: 'Kitchen bed',
        zoneType: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
        rotationDeg: 5,
        fillColor: '#D8B35A',
      }],
      annotations: [{
        id: 'annotation-source',
        annotationType: 'text',
        position: { x: 12, y: 18 },
        text: 'Guild edge',
        fontSize: 14,
        rotationDeg: 10,
      }],
      groups: [{
        id: 'group-source',
        name: 'Guild',
        members: [
          { kind: 'plant', id: 'plant-source' },
          { kind: 'zone', id: 'zone-source' },
          { kind: 'annotation', id: 'annotation-source' },
        ],
      }],
    }

    const file = composeSavedObjectStampCanopiFile({
      name: 'Apple guild',
      payload,
      now: new Date('2026-06-19T12:00:00.000Z'),
    })

    expect(file).toMatchObject({
      version: 4,
      name: 'Apple guild',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      plant_species_symbols: {},
      consortiums: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '2026-06-19T12:00:00.000Z',
      updated_at: '2026-06-19T12:00:00.000Z',
      extra: {},
    })
    expect(file.layers).toEqual([
      { name: 'plants', visible: true, locked: false, opacity: 1 },
      { name: 'zones', visible: true, locked: false, opacity: 1 },
      { name: 'annotations', visible: true, locked: false, opacity: 1 },
    ])
    expect(file.plants).toEqual([{
      id: 'plant-source',
      locked: false,
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: '#C44230',
      symbol: 'tree',
      pinned_name: false,
      position: { x: 10, y: 20 },
      rotation: 15,
      scale: 2,
      notes: null,
      planted_date: null,
      quantity: null,
    }])
    expect(file.zones).toEqual([{
      name: 'Kitchen bed',
      locked: false,
      zone_type: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
      rotation: 5,
      fill_color: '#D8B35A',
      notes: null,
    }])
    expect(file.annotations).toEqual([{
      id: 'annotation-source',
      locked: false,
      annotation_type: 'text',
      position: { x: 12, y: 18 },
      text: 'Guild edge',
      font_size: 14,
      rotation: 10,
    }])
    expect(file.groups).toEqual([{
      id: 'group-source',
      locked: false,
      name: 'Guild',
      members: [
        { kind: 'plant', id: 'plant-source' },
        { kind: 'zone', id: 'Kitchen bed' },
        { kind: 'annotation', id: 'annotation-source' },
      ],
    }])
  })

  it('drops invalid captured groups during export', () => {
    const file = composeSavedObjectStampCanopiFile({
      name: 'Ungrouped stamp',
      payload: {
        version: 1,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-1',
          canonicalName: 'Malus domestica',
          commonName: null,
          color: null,
          symbol: null,
          position: { x: 0, y: 0 },
          rotationDeg: null,
          scale: null,
        }],
        zones: [],
        annotations: [],
        groups: [{
          id: 'group-1',
          name: null,
          members: [
            { kind: 'plant', id: 'plant-1' },
            { kind: 'zone', id: 'missing-zone' },
          ],
        }],
      },
      now: new Date('2026-06-19T12:00:00.000Z'),
    })

    expect(file.groups).toEqual([])
  })

  it('imports only visible geometry from a Canopi file and strips non-visual metadata', () => {
    const payload = savedObjectStampPayloadFromCanopiFile(canopiFile({
      plants: [{
        id: 'source-plant',
        locked: true,
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: '#C44230',
        symbol: 'tree',
        position: { x: 10, y: 20 },
        rotation: 30,
        scale: 2,
        notes: 'nursery note',
        planted_date: '2026-04-01',
        quantity: 5,
      }],
      zones: [{
        name: 'Hidden bed',
        locked: false,
        zone_type: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }],
        rotation: 0,
        fill_color: '#D8B35A',
        notes: 'hidden zone note',
      }],
      annotations: [{
        id: 'note-1',
        locked: true,
        annotation_type: 'text',
        position: { x: 14, y: 16 },
        text: 'Guild edge',
        font_size: 14,
        rotation: 10,
      }],
      groups: [{
        id: 'group-1',
        locked: true,
        name: 'Visible pair',
        members: [
          { kind: 'plant', id: 'source-plant' },
          { kind: 'zone', id: 'Hidden bed' },
          { kind: 'annotation', id: 'note-1' },
        ],
      }],
    }))

    expect(payload).toEqual({
      version: 1,
      anchor: { x: 12, y: 18 },
      plants: [{
        id: 'source-plant',
        canonicalName: 'Malus domestica',
        commonName: 'Apple',
        color: '#C44230',
        symbol: 'tree',
        position: { x: 10, y: 20 },
        rotationDeg: 30,
        scale: 2,
      }],
      zones: [],
      annotations: [{
        id: 'note-1',
        annotationType: 'text',
        position: { x: 14, y: 16 },
        text: 'Guild edge',
        fontSize: 14,
        rotationDeg: 10,
      }],
      groups: [{
        id: 'group-1',
        name: 'Visible pair',
        members: [
          { kind: 'plant', id: 'source-plant' },
          { kind: 'annotation', id: 'note-1' },
        ],
      }],
    })
  })

  it('imports Plant Symbols inherited from species defaults as explicit stamp symbols', () => {
    const payload = savedObjectStampPayloadFromCanopiFile(canopiFile({
      plant_species_symbols: { 'Malus domestica': 'tree' },
      plants: [{
        id: 'source-plant',
        locked: false,
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        color: null,
        symbol: null,
        position: { x: 10, y: 20 },
        rotation: null,
        scale: null,
        notes: null,
        planted_date: null,
        quantity: null,
      }],
    }))

    expect(payload?.plants[0]?.symbol).toBe('tree')
  })

  it('round-trips exported Zone group membership through a stamp import', () => {
    const file = composeSavedObjectStampCanopiFile({
      name: 'Zone pair',
      payload: {
        version: 1,
        anchor: { x: 0, y: 0 },
        plants: [{
          id: 'plant-source',
          canonicalName: 'Malus domestica',
          commonName: null,
          color: null,
          symbol: null,
          position: { x: 0, y: 0 },
          rotationDeg: null,
          scale: null,
        }],
        zones: [{
          id: 'zone-source',
          name: 'Kitchen bed',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 4, y: 4 }],
          rotationDeg: 0,
          fillColor: null,
        }],
        annotations: [],
        groups: [{
          id: 'group-source',
          name: 'Plant and zone',
          members: [
            { kind: 'plant', id: 'plant-source' },
            { kind: 'zone', id: 'zone-source' },
          ],
        }],
      },
      now: new Date('2026-06-19T12:00:00.000Z'),
    })

    const payload = savedObjectStampPayloadFromCanopiFile(file)

    expect(file.groups[0]?.members).toEqual([
      { kind: 'plant', id: 'plant-source' },
      { kind: 'zone', id: 'Kitchen bed' },
    ])
    expect(payload?.groups).toEqual([{
      id: 'group-source',
      name: 'Plant and zone',
      members: [
        { kind: 'plant', id: 'plant-source' },
        { kind: 'zone', id: 'zone-1' },
      ],
    }])
  })

  it('imports Elliptical Zone anchors from visible bounds instead of radii coordinates', () => {
    const payload = savedObjectStampPayloadFromCanopiFile(canopiFile({
      layers: [{ name: 'zones', visible: true, locked: false, opacity: 1 }],
      zones: [{
        name: 'Pond edge',
        locked: false,
        zone_type: 'ellipse',
        points: [{ x: 100, y: 100 }, { x: 10, y: 6 }],
        rotation: 0,
        fill_color: null,
        notes: null,
      }],
    }))

    expect(payload?.anchor).toEqual({ x: 100, y: 100 })
  })

  it('rejects empty imports and falls back to a composition name when the file name is blank', () => {
    const emptyPayload = savedObjectStampPayloadFromCanopiFile(canopiFile({
      name: '',
      plants: [],
      zones: [],
      annotations: [],
      groups: [],
    }))
    const visibleZonePayload = savedObjectStampPayloadFromCanopiFile(canopiFile({
      name: '  ',
      layers: [{ name: 'zones', visible: true, locked: false, opacity: 1 }],
      zones: [{
        name: 'Bed',
        locked: true,
        zone_type: 'rect',
        points: [{ x: 0, y: 0 }, { x: 4, y: 4 }],
        rotation: 0,
        fill_color: null,
        notes: null,
      }],
    }))

    expect(emptyPayload).toBeNull()
    expect(importedSavedObjectStampName(canopiFile({ name: '  ' }), visibleZonePayload!))
      .toBe('1 zone, 0 annotations')
  })
})
