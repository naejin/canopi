import { describe, expect, it } from 'vitest'
import type { ScenePlantEntity, SceneViewportState } from '../canvas/runtime/scene'
import { computePinnedPlantNameLabels, computeSelectionLabels } from '../canvas/runtime/selection-labels'

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
    locked: overrides.locked ?? false,
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

  it('computes one label for a single selected unpinned plant', () => {
    const plants = [createPlant({ id: 'a', position: { x: 10, y: 20 } })]
    const result = computeSelectionLabels(
      plants,
      new Set(['a']),
      createViewport({ scale: 1 }),
      new Map(),
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.canonicalName).toBe('Malus domestica')
    expect(result[0]!.screenPoint.x).toBe(10)
  })

  it('places a selected plant label below the glyph at low zoom', () => {
    const result = computeSelectionLabels(
      [createPlant({ id: 'a', position: { x: 10, y: 20 } })],
      new Set(['a']),
      createViewport({ scale: 1 }),
      new Map(),
    )

    expect(result[0]!.screenPoint.x).toBe(10)
    expect(result[0]!.screenPoint.y).toBeCloseTo(25, 2)
  })

  it('keeps the selected plant label offset balanced at high zoom', () => {
    const result = computeSelectionLabels(
      [createPlant({ id: 'a', position: { x: 10, y: 20 } })],
      new Set(['a']),
      createViewport({ scale: 1000 }),
      new Map(),
    )

    expect(result[0]!.screenPoint.x).toBe(10000)
    expect(result[0]!.screenPoint.y).toBeCloseTo(20008, 2)
  })

  it('returns empty array when multiple plants are selected', () => {
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
    expect(result).toEqual([])
  })

  it('returns empty array when one plant is selected with another design object', () => {
    const result = computeSelectionLabels(
      [createPlant({ id: 'a' })],
      new Set(['a', 'zone-1']),
      createViewport(),
      new Map(),
    )
    expect(result).toEqual([])
  })

  it('returns empty array when the single selected plant already has a pinned name', () => {
    const result = computeSelectionLabels(
      [createPlant({ id: 'a', pinnedName: true })],
      new Set(['a']),
      createViewport(),
      new Map(),
    )
    expect(result).toEqual([])
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

  it('fades pinned names smoothly on zoom reversal without changing saved pinning', () => {
    const plants = [createPlant({ pinnedName: true })]
    const before = structuredClone(plants)
    const visible = [20, 14, 8, 14, 20].map((scale) =>
      computePinnedPlantNameLabels(plants, createViewport({ scale }), new Map()),
    )
    expect(visible.map((labels) => labels[0]?.opacity ?? 0)).toEqual([1, 0.5, 0, 0.5, 1])
    expect(visible[2]).toEqual([])
    expect(plants).toEqual(before)
  })

  it('reveals only a singleton selected pinned name at overview scale', () => {
    const plants = [createPlant({ id: 'a', pinnedName: true }), createPlant({ id: 'b', pinnedName: true })]
    const labels = computePinnedPlantNameLabels(plants, createViewport(), new Map(), {
      selectionLabelPlantIds: new Set(['a']),
    })
    expect(labels.map(({ plantId, opacity }) => ({ plantId, opacity }))).toEqual([{ plantId: 'a', opacity: 1 }])
    expect(computePinnedPlantNameLabels(plants, createViewport(), new Map(), {
      selectionLabelPlantIds: new Set(['a', 'b']),
    })).toEqual([])
  })

  it('does not nudge overlapping pinned plant names', () => {
    const plants = [
      createPlant({ id: 'a', pinnedName: true, position: { x: 0, y: 0 } }),
      createPlant({ id: 'b', pinnedName: true, position: { x: 0, y: 0 } }),
    ]
    const result = computePinnedPlantNameLabels(
      plants,
      createViewport({ scale: 20 }),
      new Map(),
    )
    expect(result).toHaveLength(2)
    expect(result[1]!.screenPoint).toEqual(result[0]!.screenPoint)
  })
})
