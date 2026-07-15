import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginConsortiumDrag,
  commitConsortiumDrag,
  previewConsortiumDrag,
} from '../app/consortium/interaction'
import { buildConsortiumBars } from '../app/planning-projection'
import {
  computeRowHeights,
  computeRowYOffsets,
  LABEL_WIDTH,
  phaseToX,
} from '../canvas/consortium-renderer'
import { stratumToRow } from '../app/consortium/time-model'
import { designSessionStore } from '../app/document-session/store'
import { consortiumTarget } from '../target'
import {
  designSessionFixture,
  currentDesign,
  nonCanvasRevision,
} from './support/design-session-state'
import type { CanopiFile, Consortium, PlacedPlant } from '../types/design'

const CANVAS_WIDTH = 800
const CONTENT_WIDTH = CANVAS_WIDTH - LABEL_WIDTH

function makeRect(): DOMRect {
  return {
    left: 0,
    top: 0,
    right: CANVAS_WIDTH,
    bottom: 220,
    width: CANVAS_WIDTH,
    height: 220,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

function makeConsortium(
  canonicalName: string,
  overrides: Partial<Omit<Consortium, 'target'>> = {},
): Consortium {
  return {
    target: consortiumTarget(canonicalName),
    stratum: 'high',
    start_phase: 0,
    end_phase: 2,
    ...overrides,
  }
}

function makePlant(canonicalName: string, commonName: string): PlacedPlant {
  return {
    id: `plant-${canonicalName}`,
    canonical_name: canonicalName,
    common_name: commonName,
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: 1,
    locked: false,
  }
}

function makeDesign(consortiums: Consortium[]): CanopiFile {
  return {
    version: 2,
    name: 'Consortium interaction test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [
      makePlant('Malus domestica', 'Apple'),
      makePlant('Acer campestre', 'Field maple'),
    ],
    zones: [],
    annotations: [],
    consortiums,
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
  }
}

function rowCenterY(rowName: string, rowHeights: readonly number[], rowOffsets: readonly number[]): number {
  const rowIndex = stratumToRow(rowName)
  return rowOffsets[rowIndex]! + (rowHeights[rowIndex] ?? 36) / 2
}

function buildSnapshot() {
  const design = currentDesign.value!
  const bars = buildConsortiumBars(design.consortiums, design.plants, {})
  const rowHeights = computeRowHeights(bars)
  const rowOffsets = computeRowYOffsets(rowHeights)
  return {
    bars,
    consortiums: design.consortiums,
    rowHeights,
    rowOffsets,
    canvasWidth: CANVAS_WIDTH,
  }
}

describe('Consortium interaction', () => {
  beforeEach(() => {
    const initial = makeDesign([
      makeConsortium('Malus domestica'),
      makeConsortium('Acer campestre', {
        stratum: 'medium',
        start_phase: 3,
        end_phase: 5,
      }),
    ])
    designSessionStore.replaceCurrentDesignState(initial, null, initial.name)
    designSessionStore.resetDirtyBaselines()
  })

  it('previews and commits Consortium move drags through one module interface', () => {
    const snapshot = buildSnapshot()
    const bar = snapshot.bars.find((candidate) => candidate.canonicalName === 'Malus domestica')!
    const drag = beginConsortiumDrag({
      hit: { canonicalName: bar.canonicalName, edge: 'body' },
      bar,
      startMouseX: phaseToX(0, CONTENT_WIDTH),
      cachedRect: makeRect(),
    })

    previewConsortiumDrag(drag, snapshot, {
      mouseX: phaseToX(1, CONTENT_WIDTH),
      mouseY: rowCenterY('medium', snapshot.rowHeights, snapshot.rowOffsets),
    })

    expect(currentDesign.value!.consortiums[0]).toMatchObject({
      stratum: 'medium',
      start_phase: 1,
      end_phase: 3,
    })
    expect(nonCanvasRevision.value).toBe(0)

    commitConsortiumDrag(drag)
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('previews right-edge resizes without caller-owned edit transactions', () => {
    const snapshot = buildSnapshot()
    const bar = snapshot.bars.find((candidate) => candidate.canonicalName === 'Malus domestica')!
    const drag = beginConsortiumDrag({
      hit: { canonicalName: bar.canonicalName, edge: 'right' },
      bar,
      startMouseX: phaseToX(3, CONTENT_WIDTH),
      cachedRect: makeRect(),
    })

    previewConsortiumDrag(drag, snapshot, {
      mouseX: phaseToX(7, CONTENT_WIDTH),
      mouseY: rowCenterY('high', snapshot.rowHeights, snapshot.rowOffsets),
    })
    commitConsortiumDrag(drag)

    expect(currentDesign.value!.consortiums[0]).toMatchObject({
      stratum: 'high',
      start_phase: 0,
      end_phase: 6,
    })
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('does not treat vertical movement within a Stratum as manual Consortium Lane reordering', () => {
    designSessionFixture.file = makeDesign([
      makeConsortium('Malus domestica', { stratum: 'high', start_phase: 0, end_phase: 2 }),
      makeConsortium('Acer campestre', { stratum: 'high', start_phase: 0, end_phase: 2 }),
    ])
    const originalOrder = currentDesign.value!.consortiums
    const snapshot = buildSnapshot()
    const bar = snapshot.bars.find((candidate) => candidate.canonicalName === 'Malus domestica')!
    const highRowIndex = stratumToRow('high')
    const highRowY = snapshot.rowOffsets[highRowIndex]!
    const highRowHeight = snapshot.rowHeights[highRowIndex]!
    const drag = beginConsortiumDrag({
      hit: { canonicalName: bar.canonicalName, edge: 'body' },
      bar,
      startMouseX: phaseToX(0, CONTENT_WIDTH),
      cachedRect: makeRect(),
    })

    previewConsortiumDrag(drag, snapshot, {
      mouseX: phaseToX(0, CONTENT_WIDTH),
      mouseY: highRowY + highRowHeight * 0.75,
    })

    expect(currentDesign.value!.consortiums).toBe(originalOrder)
    drag.edit.abort()
  })

  it('recomputes derived Consortium Lanes after a move preview changes phase overlap', () => {
    designSessionFixture.file = makeDesign([
      makeConsortium('Malus domestica', { stratum: 'high', start_phase: 0, end_phase: 0 }),
      makeConsortium('Acer campestre', { stratum: 'high', start_phase: 1, end_phase: 1 }),
    ])
    const initialSnapshot = buildSnapshot()
    expect(initialSnapshot.bars.map((bar) => bar.subLane)).toEqual([0, 0])
    const bar = initialSnapshot.bars.find((candidate) => candidate.canonicalName === 'Malus domestica')!
    const drag = beginConsortiumDrag({
      hit: { canonicalName: bar.canonicalName, edge: 'body' },
      bar,
      startMouseX: phaseToX(0, CONTENT_WIDTH),
      cachedRect: makeRect(),
    })

    previewConsortiumDrag(drag, initialSnapshot, {
      mouseX: phaseToX(1, CONTENT_WIDTH),
      mouseY: rowCenterY('high', initialSnapshot.rowHeights, initialSnapshot.rowOffsets),
    })

    const nextSnapshot = buildSnapshot()
    expect(currentDesign.value!.consortiums[0]).toMatchObject({
      stratum: 'high',
      start_phase: 1,
      end_phase: 1,
    })
    expect(nextSnapshot.bars.map((bar) => bar.subLane)).toEqual([0, 1])
    expect(nextSnapshot.bars.map((bar) => bar.totalSubLanes)).toEqual([2, 2])
    drag.edit.abort()
  })

  it('recomputes derived Consortium Lanes after a resize preview changes phase overlap', () => {
    designSessionFixture.file = makeDesign([
      makeConsortium('Malus domestica', { stratum: 'high', start_phase: 0, end_phase: 0 }),
      makeConsortium('Acer campestre', { stratum: 'high', start_phase: 1, end_phase: 1 }),
    ])
    const initialSnapshot = buildSnapshot()
    expect(initialSnapshot.bars.map((bar) => bar.subLane)).toEqual([0, 0])
    const bar = initialSnapshot.bars.find((candidate) => candidate.canonicalName === 'Malus domestica')!
    const drag = beginConsortiumDrag({
      hit: { canonicalName: bar.canonicalName, edge: 'right' },
      bar,
      startMouseX: phaseToX(1, CONTENT_WIDTH),
      cachedRect: makeRect(),
    })

    previewConsortiumDrag(drag, initialSnapshot, {
      mouseX: phaseToX(2, CONTENT_WIDTH),
      mouseY: rowCenterY('high', initialSnapshot.rowHeights, initialSnapshot.rowOffsets),
    })

    const nextSnapshot = buildSnapshot()
    expect(currentDesign.value!.consortiums[0]).toMatchObject({
      stratum: 'high',
      start_phase: 0,
      end_phase: 1,
    })
    expect(nextSnapshot.bars.map((bar) => bar.subLane)).toEqual([0, 1])
    expect(nextSnapshot.bars.map((bar) => bar.totalSubLanes)).toEqual([2, 2])
    drag.edit.abort()
  })
})
