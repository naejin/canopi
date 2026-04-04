import { describe, expect, it } from 'vitest'
import type { ScenePlantEntity, SceneViewportState } from '../canvas/runtime/scene'
import { computeSelectionLabels } from '../canvas/runtime/selection-labels'

function createViewport(overrides: Partial<SceneViewportState> = {}): SceneViewportState {
  return { x: 0, y: 0, scale: 8, ...overrides }
}

function createPlant(overrides: Partial<ScenePlantEntity> = {}): ScenePlantEntity {
  return {
    kind: 'plant' as const,
    id: 'plant-1',
    canonicalName: 'Malus domestica',
    commonName: 'Apple',
    color: null,
    stratum: null,
    canopySpreadM: null,
    position: { x: 10, y: 20 },
    rotationDeg: null,
    scale: null,
    notes: null,
    plantedDate: null,
    quantity: null,
    ...overrides,
  }
}

describe('selection labels', () => {
  it('returns empty array when no plants are selected', () => {
    const result = computeSelectionLabels(
      [createPlant()],
      new Set(),
      createViewport(),
      new Map(),
    )
    expect(result).toEqual([])
  })

  it('computes one label per species at the centroid of selected plants', () => {
    const plants = [
      createPlant({ id: 'a', position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', position: { x: 10, y: 0 } }),
    ]
    const result = computeSelectionLabels(
      plants,
      new Set(['a', 'b']),
      createViewport({ scale: 1 }),
      new Map(),
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.canonicalName).toBe('Malus domestica')
    expect(result[0]!.screenPoint.x).toBe(5) // centroid x = (0+10)/2
  })

  it('produces separate labels for different species', () => {
    const plants = [
      createPlant({ id: 'a', canonicalName: 'Malus domestica', position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', canonicalName: 'Pyrus communis', position: { x: 10, y: 0 } }),
    ]
    const result = computeSelectionLabels(
      plants,
      new Set(['a', 'b']),
      createViewport({ scale: 1 }),
      new Map(),
    )
    expect(result).toHaveLength(2)
  })

  it('uses localized common name when available', () => {
    const result = computeSelectionLabels(
      [createPlant({ id: 'a' })],
      new Set(['a']),
      createViewport(),
      new Map([['Malus domestica', 'Pommier']]),
    )
    expect(result[0]!.text).toBe('Pommier')
    expect(result[0]!.fontStyle).toBe('normal')
  })

  it('falls back to abbreviated canonical name when no common name exists', () => {
    const plant = createPlant({ id: 'a', commonName: null, canonicalName: 'Lavandula angustifolia' })
    const result = computeSelectionLabels(
      [plant],
      new Set(['a']),
      createViewport(),
      new Map(),
    )
    expect(result[0]!.text).toBe('L. ang.')
    expect(result[0]!.fontStyle).toBe('italic')
  })

  it('nudges overlapping labels apart', () => {
    const plants = [
      createPlant({ id: 'a', canonicalName: 'Malus domestica', position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', canonicalName: 'Pyrus communis', position: { x: 0, y: 0.5 } }),
    ]
    const result = computeSelectionLabels(
      plants,
      new Set(['a', 'b']),
      createViewport({ scale: 8 }),
      new Map(),
    )
    expect(result).toHaveLength(2)
    // Labels should be nudged apart (second one pushed down)
    expect(result[1]!.screenPoint.y).toBeGreaterThan(result[0]!.screenPoint.y)
    expect(result[1]!.screenPoint.y - result[0]!.screenPoint.y).toBeGreaterThanOrEqual(16)
  })
})
