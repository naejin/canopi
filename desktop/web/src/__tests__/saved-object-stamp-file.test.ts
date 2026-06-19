import { describe, expect, it } from 'vitest'
import type { SavedObjectStampPayload } from '../canvas/saved-object-stamp-payload'
import { composeSavedObjectStampCanopiFile } from '../app/saved-object-stamps/file'

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
      version: 3,
      name: 'Apple guild',
      description: null,
      location: null,
      north_bearing_deg: 0,
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
        { kind: 'zone', id: 'zone-source' },
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
})
