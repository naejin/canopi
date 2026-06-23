import { afterEach, describe, expect, it, vi } from 'vitest'
import { setCurrentCanvasSession } from '../canvas/session'
import type { CanopiFile } from '../types/design'
import {
  buildDesignReportInput,
  exportCurrentDesignReportPdf,
} from '../app/design-report/actions'
import { createTestCanvasDocumentSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import {
  canvasClean,
  currentDesign,
  designDirty,
  nonCanvasRevision,
  nonCanvasSavedRevision,
  replaceCurrentDesignState,
} from './support/design-session-state'
import * as reportIpc from '../ipc/design-report'

vi.mock('../ipc/design-report', () => ({
  exportDesignReportPdf: vi.fn(async () => '/tmp/report.pdf'),
}))

const BASE_DESIGN: CanopiFile = {
  version: 2,
  name: 'Report design',
  description: null,
  location: null,
  north_bearing_deg: null,
  plant_species_colors: {},
  layers: [],
  plants: [],
  zones: [],
  annotations: [],
  consortiums: [],
  groups: [],
  timeline: [],
  budget: [],
  budget_currency: 'EUR',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  extra: {},
}

describe('Design Report export input', () => {
  afterEach(() => {
    vi.clearAllMocks()
    setCurrentCanvasSession(null)
    currentDesign.value = null
    nonCanvasRevision.value = 0
    nonCanvasSavedRevision.value = 0
    canvasClean.value = true
  })

  it('omits empty metadata and fits the canvas page to visible layers', () => {
    const input = buildDesignReportInput({
      ...BASE_DESIGN,
      description: '   ',
      layers: [
        { name: 'plants', visible: true, locked: false, opacity: 1 },
        { name: 'zones', visible: false, locked: false, opacity: 1 },
      ],
      plants: [
        {
          id: 'plant-1',
          canonical_name: 'Malus domestica',
          common_name: 'Apple',
          color: '#AA0000',
          position: { x: 0, y: 0 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
        {
          id: 'plant-2',
          canonical_name: 'Pyrus communis',
          common_name: 'Pear',
          color: '#00AA00',
          position: { x: 160, y: 40 },
          rotation: null,
          scale: null,
          notes: null,
          planted_date: null,
          quantity: 1,
          locked: false,
        },
      ],
      zones: [{
        name: 'hidden-zone',
        zone_type: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 0, y: 400 }, { x: 20, y: 400 }],
        rotation: 0,
        fill_color: null,
        notes: null,
        locked: false,
      }],
    })

    expect(input.metadata).toEqual({})
    expect(input.canvas.page.background).toBe('#FFFFFF')
    expect(input.canvas.page.orientation).toBe('landscape')
    expect(input.canvas.visible_layer_names).toEqual(['plants'])
    expect(input.canvas.plants.map((plant) => plant.id)).toEqual(['plant-1', 'plant-2'])
    expect(input.canvas.zones).toEqual([])
    expect(input.canvas.bounds).toEqual({ min_x: 0, min_y: 0, max_x: 160, max_y: 40 })
  })

  it('exports current serialized Design Session state without clearing dirty state', async () => {
    replaceCurrentDesignState(
      {
        ...BASE_DESIGN,
        name: 'Saved snapshot',
        plants: [],
      },
      null,
      'Saved snapshot',
    )
    nonCanvasRevision.value = 1
    nonCanvasSavedRevision.value = 0
    canvasClean.value = false
    const livePlant = {
      id: 'live-plant',
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      color: null,
      position: { x: 12, y: 8 },
      rotation: null,
      scale: null,
      notes: null,
      planted_date: null,
      quantity: 1,
      locked: false,
    }
    const serializeDocument = vi.fn((metadata: { name: string }, doc: CanopiFile): CanopiFile => ({
      ...doc,
      name: metadata.name,
      plants: [livePlant],
    }))
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      documents: createTestCanvasDocumentSurface({ serializeDocument }),
    }))

    await exportCurrentDesignReportPdf()

    expect(serializeDocument).toHaveBeenCalledTimes(1)
    expect(reportIpc.exportDesignReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Saved snapshot',
        canvas: expect.objectContaining({
          plants: [expect.objectContaining({ id: 'live-plant' })],
        }),
      }),
      'Saved snapshot Design Report.pdf',
    )
    expect(designDirty.value).toBe(true)
    expect(nonCanvasRevision.value).toBe(1)
    expect(canvasClean.value).toBe(false)
  })
})
