import { describe, expect, it } from 'vitest'
import type {
  SavedObjectStampPayload,
  SavedObjectStampPlant,
} from '../canvas/saved-object-stamp-payload'
import { createSavedObjectStampThumbnailSignature } from '../app/saved-object-stamps/thumbnail-renderer'

function payload(overrides: Partial<SavedObjectStampPayload> = {}): SavedObjectStampPayload {
  return {
    version: 1,
    anchor: { x: 0, y: 0 },
    plants: [],
    zones: [],
    annotations: [],
    groups: [],
    ...overrides,
  }
}

function plant(
  id: string,
  position: { x: number, y: number },
  color: string,
  canonicalName = 'Malus domestica',
): SavedObjectStampPlant {
  return {
    id,
    canonicalName,
    commonName: null,
    color,
    symbol: null,
    position,
    rotationDeg: null,
    scale: 1,
  }
}

describe('Saved Object Stamp thumbnail renderer', () => {
  it('renders sparse stamps as individual spatial marks', () => {
    const signature = createSavedObjectStampThumbnailSignature(JSON.stringify(payload({
      plants: [
        {
          id: 'plant-left',
          canonicalName: 'Malus domestica',
          commonName: 'Apple',
          color: '#7A8F3A',
          symbol: null,
          position: { x: 0, y: 0 },
          rotationDeg: null,
          scale: 1,
        },
        {
          id: 'plant-right',
          canonicalName: 'Allium porrum',
          commonName: 'Leek',
          color: '#C19A2E',
          symbol: null,
          position: { x: 20, y: 0 },
          rotationDeg: null,
          scale: 1,
        },
      ],
      zones: [{
        id: 'zone-1',
        name: 'Bed',
        zoneType: 'rect',
        points: [{ x: -2, y: -2 }, { x: 22, y: -2 }, { x: 22, y: 8 }, { x: -2, y: 8 }],
        rotationDeg: 0,
        fillColor: '#D6C49A',
      }],
      annotations: [{
        id: 'annotation-1',
        annotationType: 'text',
        position: { x: 10, y: -4 },
        text: 'Guild',
        fontSize: 12,
        rotationDeg: null,
      }],
    })))

    expect(signature.fallback).toBe(false)
    expect(signature.width).toBe(180)
    expect(signature.height).toBe(150)
    expect(signature.zones).toHaveLength(1)
    expect(signature.zones[0]?.points).toHaveLength(4)
    expect(signature.plants).toHaveLength(2)
    expect(signature.plants[0]?.x).toBeLessThan(signature.plants[1]?.x ?? 0)
    expect(signature.plants[0]?.color).toBe('#7A8F3A')
    expect(signature.plants[1]?.color).toBe('#C19A2E')
    expect(signature.annotations).toHaveLength(1)
  })

  it('clusters dense plant sets while preserving spread and dominant identity', () => {
    const clusteredPlants = [
      ...Array.from({ length: 7 }, (_, index) =>
        plant(`green-origin-${index}`, { x: 0.05 * index, y: 0.04 * index }, '#4E7A3A', 'Malus domestica')),
      ...Array.from({ length: 2 }, (_, index) =>
        plant(`red-origin-${index}`, { x: 0.03 * index, y: 0.05 * index }, '#B04732', 'Fragaria vesca')),
      ...Array.from({ length: 48 }, (_, index) =>
        plant(
          `grid-${index}`,
          { x: 2 + (index % 12), y: 1 + Math.floor(index / 12) },
          index % 2 === 0 ? '#C19A2E' : '#806D55',
          index % 2 === 0 ? 'Allium porrum' : 'Vicia faba',
        )),
    ]

    const signature = createSavedObjectStampThumbnailSignature(JSON.stringify(payload({
      plants: clusteredPlants,
    })))
    const xs = signature.plants.map((mark) => mark.x)
    const leftMost = signature.plants.reduce((left, mark) => mark.x < left.x ? mark : left)

    expect(signature.fallback).toBe(false)
    expect(signature.plants.length).toBeLessThanOrEqual(24)
    expect(signature.plants.some((mark) => mark.cluster)).toBe(true)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(110)
    expect(leftMost.color).toBe('#4E7A3A')
    expect(leftMost.count).toBeGreaterThan(1)
  })

  it('renders rotated zone geometry and keeps the largest zones', () => {
    const signature = createSavedObjectStampThumbnailSignature(JSON.stringify(payload({
      zones: [
        {
          id: 'tiny-zone',
          name: 'Tiny',
          zoneType: 'rect',
          points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          rotationDeg: 0,
          fillColor: '#111111',
        },
        {
          id: 'rotated-zone',
          name: 'Rotated',
          zoneType: 'rect',
          points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 13 }, { x: 10, y: 13 }],
          rotationDeg: 45,
          fillColor: '#D6C49A',
        },
        {
          id: 'largest-zone',
          name: 'Largest',
          zoneType: 'rect',
          points: [{ x: 25, y: 0 }, { x: 65, y: 0 }, { x: 65, y: 10 }, { x: 25, y: 10 }],
          rotationDeg: 0,
          fillColor: '#C19A2E',
        },
        {
          id: 'medium-zone',
          name: 'Medium',
          zoneType: 'rect',
          points: [{ x: 25, y: 15 }, { x: 45, y: 15 }, { x: 45, y: 20 }, { x: 25, y: 20 }],
          rotationDeg: 0,
          fillColor: '#806D55',
        },
      ],
    })))
    const renderedColors = signature.zones.map((zone) => zone.fillColor)
    const rotated = signature.zones.find((zone) => zone.fillColor === '#D6C49A')
    const rotatedEdgeStart = rotated?.points[0]
    const rotatedEdgeEnd = rotated?.points[1]
    const rotatedEdgeAngle = rotatedEdgeStart && rotatedEdgeEnd
      ? Math.abs(Math.atan2(
        rotatedEdgeEnd.y - rotatedEdgeStart.y,
        rotatedEdgeEnd.x - rotatedEdgeStart.x,
      ) * 180 / Math.PI)
      : 0

    expect(renderedColors).toEqual(['#C19A2E', '#806D55', '#D6C49A'])
    expect(rotated?.points).toHaveLength(4)
    expect(rotatedEdgeAngle).toBeGreaterThan(30)
    expect(rotatedEdgeAngle).toBeLessThan(60)
  })

  it('caps annotations as strokes instead of label text', () => {
    const signature = createSavedObjectStampThumbnailSignature(JSON.stringify(payload({
      annotations: Array.from({ length: 6 }, (_, index) => ({
        id: `annotation-${index}`,
        annotationType: 'text',
        position: { x: index * 2, y: index },
        text: `Label ${index}`,
        fontSize: 14,
        rotationDeg: index === 0 ? 30 : null,
      })),
    })))

    expect(signature.annotations).toHaveLength(4)
    expect('text' in signature.annotations[0]!).toBe(false)
    expect(signature.annotations[0]?.x1).not.toBe(signature.annotations[0]?.x2)
    expect(signature.annotations[0]?.y1).not.toBe(signature.annotations[0]?.y2)
  })

  it('falls back for invalid or empty payloads', () => {
    const invalid = createSavedObjectStampThumbnailSignature('{')
    const empty = createSavedObjectStampThumbnailSignature(JSON.stringify(payload()))

    expect(invalid.fallback).toBe(true)
    expect(invalid.plants).toHaveLength(0)
    expect(empty.fallback).toBe(true)
    expect(empty.zones).toHaveLength(0)
  })
})
