import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createToolHarness,
  useStubTools,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../__tests__/support/tool-harness'
import type { WorldPoint } from '../view/types'
import type { DraftShape } from './draft'
import { createMeasurementGuideTool } from './measurement-guide'
import { createPolygonTool } from './polygon'
import { createZoneDragTool } from './zone-drag'

vi.mock('./registry', () => ({ TOOL_REGISTRY: {} }))

const harnesses: ToolHarness[] = []

beforeEach(() => {
  // The shape tools; every other tool stays on the legacy bridge.
  useStubTools(
    createZoneDragTool('line'),
    createZoneDragTool('rectangle'),
    createZoneDragTool('ellipse'),
    createPolygonTool(),
    createMeasurementGuideTool(),
  )
})

function harness(options: ToolHarnessOptions = {}): ToolHarness {
  const created = createToolHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
  useStubTools()
})

function shapes(h: ToolHarness): readonly DraftShape[] {
  return h.renderer.lastDraft()?.shapes ?? []
}

function chips(h: ToolHarness): [string, string][] {
  return shapes(h).flatMap((shape) => shape.kind === 'label' ? [[shape.text, shape.tone] as [string, string]] : [])
}

function lockZones(h: ToolHarness): void {
  h.store.updatePersisted((draft) => {
    draft.layers = draft.layers.map((layer) => layer.name === 'zones' ? { ...layer, locked: true } : layer)
  })
}

function expectPoints(actual: readonly WorldPoint[], expected: readonly WorldPoint[]): void {
  expect(actual).toHaveLength(expected.length)
  for (const [index, point] of expected.entries()) {
    expect(actual[index]!.x).toBeCloseTo(point.x, 9)
    expect(actual[index]!.y).toBeCloseTo(point.y, 9)
  }
}

const DRAFT_STROKE = { token: 'draft', widthPx: 2 } as const
const ZONE_FILL = { token: 'draft-fill' } as const

describe('Zone drag tools', () => {
  it('a rectangle drag commits one zone', () => {
    const h = harness({ tool: 'rectangle' })

    h.drag({ x: 10, y: 20 }, { x: 40, y: 60 })

    expect(h.store.persisted.zones).toHaveLength(1)
    const zone = h.store.persisted.zones[0]!
    expect(zone).toMatchObject({
      zoneType: 'rect',
      rotationDeg: 0,
      points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }],
    })
    expect(h.store.session.selectedTargets).toEqual([{ kind: 'zone', id: zone.id }])
    // The draft goes with the release; the new zone's own chips show.
    expect(shapes(h).every((shape) => shape.kind === 'label')).toBe(true)
    expect(h.undo()).toBe(true)
    expect(h.store.persisted.zones).toEqual([])
    expect(h.undo()).toBe(false)
  })

  it('a rectangle draft is the dragged box, filled as a zone, with its edge and area chips', () => {
    const h = harness({ tool: 'rectangle' })

    h.press({ x: 10, y: 20 })
    // The press draws the zero-size shape without chips.
    expect(shapes(h)).toEqual([{
      kind: 'polygon',
      points: [{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }],
      style: DRAFT_STROKE,
      fill: ZONE_FILL,
    }])
    expect(h.record.guidance.at(-1)).toMatchObject({ gesture: true })

    h.move({ x: 70, y: 100 })
    expect(shapes(h)[0]).toEqual({
      kind: 'polygon',
      points: [{ x: 10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 100 }, { x: 10, y: 100 }],
      style: DRAFT_STROKE,
      fill: ZONE_FILL,
    })
    expect(chips(h)).toEqual([
      ['60 m', 'measure-quiet'],
      ['80 m', 'measure-quiet'],
      ['60 m', 'measure-quiet'],
      ['80 m', 'measure-quiet'],
      ['4800 m²', 'measure'],
    ])
    expect(h.store.persisted.zones).toEqual([])
  })

  it('an ellipse draft is a world ellipse filled as a zone, with its size and area chips', () => {
    const h = harness({ tool: 'ellipse' })

    h.press({ x: 10, y: 20 })
    h.move({ x: 70, y: 100 })

    expect(shapes(h)[0]).toEqual({
      kind: 'ellipse',
      center: { x: 40, y: 60 },
      radiusX: 30,
      radiusY: 40,
      rotationDeg: 0,
      style: DRAFT_STROKE,
      fill: ZONE_FILL,
    })
    expect(chips(h)).toEqual([['W 60 m', 'measure-quiet'], ['H 80 m', 'measure-quiet'], ['3770 m²', 'measure']])

    h.release({ x: 70, y: 100 })
    expect(h.store.persisted.zones[0]).toMatchObject({
      zoneType: 'ellipse',
      points: [{ x: 40, y: 60 }, { x: 30, y: 40 }],
    })
  })

  it('a line draft is a stroke with its length chip', () => {
    const h = harness({ tool: 'line' })

    h.press({ x: 10, y: 20 })
    h.move({ x: 70, y: 20 })

    expect(shapes(h)).toEqual([
      { kind: 'polyline', points: [{ x: 10, y: 20 }, { x: 70, y: 20 }], style: DRAFT_STROKE },
      { kind: 'label', anchor: { x: 40, y: 20 }, offsetPx: { x: 0, y: 0 }, text: '60 m', tone: 'measure-quiet' },
    ])

    h.release({ x: 70, y: 20 })
    expect(h.store.persisted.zones[0]).toMatchObject({ zoneType: 'line', points: [{ x: 10, y: 20 }, { x: 70, y: 20 }] })
  })

  it('the draft and the zone come from the snapped points', () => {
    const h = harness({ tool: 'rectangle', viewport: { x: 0, y: 0, scale: 4 }, snapping: { grid: true, guides: false } })

    // At 4 px/m the grid is 5 m.
    h.press({ x: 43, y: 87 })
    h.move({ x: 148, y: 254 })
    expect(shapes(h)[0]).toMatchObject({ points: [{ x: 10, y: 20 }, { x: 35, y: 20 }, { x: 35, y: 65 }, { x: 10, y: 65 }] })
    h.release({ x: 148, y: 254 })

    expect(h.store.persisted.zones[0]!.points).toEqual([{ x: 10, y: 20 }, { x: 35, y: 20 }, { x: 35, y: 65 }, { x: 10, y: 65 }])
  })

  it('the draft\'s start stays on the ground through a wheel zoom', () => {
    const h = harness({ tool: 'rectangle' })
    const start = h.world({ x: 100, y: 100 })

    h.press({ x: 100, y: 100 })
    h.move({ x: 160, y: 140 })
    h.wheelZoom({ x: 300, y: 200 }, 2)

    // The drag is re-emitted under the still pointer, from the same ground point.
    const end = h.world({ x: 160, y: 140 })
    const box = [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }]
    const draft = shapes(h)[0]
    expectPoints(draft?.kind === 'polygon' ? draft.points : [], box)
    h.release({ x: 160, y: 140 })
    expectPoints(h.store.persisted.zones[0]!.points, box)
  })

  it('a cancel aborts the drag and clears the draft', () => {
    const h = harness({ tool: 'rectangle' })

    h.press({ x: 10, y: 20 })
    h.move({ x: 40, y: 60 })
    h.cancel('pointercancel')

    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.store.persisted.zones).toEqual([])
    expect(h.record.guidance.at(-1)).toMatchObject({ gesture: false })
    // The scene is free again: the next drag commits.
    h.drag({ x: 10, y: 20 }, { x: 40, y: 60 })
    expect(h.store.persisted.zones).toHaveLength(1)
  })

  it('a rectangle or an ellipse under half a metre, and a click, commit nothing', () => {
    const h = harness({ tool: 'rectangle' })

    h.drag({ x: 10, y: 10 }, { x: 10.2, y: 40 })
    h.click({ x: 50, y: 50 })
    h.arm('ellipse')
    h.drag({ x: 10, y: 10 }, { x: 40, y: 10.4 })

    expect(h.store.persisted.zones).toEqual([])
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.history.canUndo.peek()).toBe(false)
  })

  it('a drag on a closed Zones layer draws and commits nothing', () => {
    const h = harness({ tool: 'line' })
    lockZones(h)

    h.press({ x: 10, y: 20 })
    h.move({ x: 40, y: 60 })
    expect(h.renderer.lastDraft()).toBeNull()
    h.release({ x: 40, y: 60 })

    expect(h.store.persisted.zones).toEqual([])
  })

  it('a tool change aborts a live drag', () => {
    const h = harness({ tool: 'ellipse' })

    h.press({ x: 10, y: 20 })
    h.move({ x: 40, y: 60 })
    h.arm('select')

    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.store.persisted.zones).toEqual([])
    expect(h.host.hasLiveGesture()).toBe(false)
  })
})
